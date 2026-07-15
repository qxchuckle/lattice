import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { getGlobalDispatcher, ProxyAgent, setGlobalDispatcher } from 'undici';
import { dirExists, ensureDir, fileExists, listDir, removeDir } from '../paths';
import { readExplicitEmbeddingConfig, readResolvedConfig } from '../config';
import type { RAGEmbeddingConfig } from '../types';

let pipeline: ((text: string | string[]) => Promise<{ tolist: () => number[][] }>) | null = null;
let loadingPromise: Promise<void> | null = null;
let modelLoadError: Error | null = null;
const defaultDispatcher = getGlobalDispatcher();
let activeProxy: string | null = null;

/** 判断错误是否为网络问题 */
function isNetworkError(err: unknown): boolean {
  const msg = (err as Error)?.message?.toLowerCase() ?? '';
  return [
    'fetch failed',
    'network',
    'econnrefused',
    'etimedout',
    'enotfound',
    'econnreset',
    'getaddrinfo',
    'timeout',
    'could not download',
    'unable to connect',
    'socket hang up',
    'tunneling socket',
  ].some((keyword) => msg.includes(keyword));
}

/** 生成网络问题时的代理/镜像配置提示 */
export function formatModelNetworkHint(): string {
  return [
    '模型下载失败，可能是网络问题。请尝试以下方案：',
    '',
    '方案一：配置终端代理（在 shell 配置中设置后重启终端）',
    '  export HTTPS_PROXY=http://127.0.0.1:7890',
    '  export HTTP_PROXY=http://127.0.0.1:7890',
    '',
    '方案二：在 lattice 配置文件设置 HF 镜像',
    '  ltc config set rag.embedding.remoteHost https://hf-mirror.com/',
    '  或设置环境变量：export HF_ENDPOINT=https://hf-mirror.com',
    '',
    '方案三：在 lattice 配置文件直接设置代理',
    '  ltc config set rag.embedding.proxy http://127.0.0.1:7890',
    '',
    '配置后重新执行命令即可。',
  ].join('\n');
}

/** 已知模型的输出维度（未显式配置 dimension 时自动推断） */
const KNOWN_MODEL_DIMENSIONS: Record<string, number> = {
  'Xenova/all-MiniLM-L6-v2': 384,
  'Xenova/bge-small-zh-v1.5': 512,
  'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2': 384,
  'Xenova/paraphrase-multilingual-MiniLM-L12-v2': 384,
  'Xenova/multilingual-e5-small': 384,
  'BAAI/bge-small-zh-v1.5': 512,
  'BAAI/bge-base-zh-v1.5': 768,
};

const DEFAULT_EMBEDDING_CONFIG: Required<RAGEmbeddingConfig> = {
  modelId: 'Xenova/bge-small-zh-v1.5',
  remoteHost: 'https://huggingface.co/',
  remotePathTemplate: '{model}/resolve/{revision}/',
  localModelPath: '',
  cacheDir: '',
  allowRemoteModels: true,
  allowLocalModels: true,
  proxy: '',
  dimension: 512,
  dtype: 'q8',
  pooling: 'mean',
  queryPrefix: '为这个句子生成表示以用于检索相关文章：',
  documentPrefix: '',
  distanceThreshold: 1.2,
  excerptLength: 1200,
  batchSize: 64,
  minChunkSize: 100,
};

function normalizeHost(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function normalizeProxy(url: string): string {
  return url.trim();
}

export function resolveEmbeddingProxy(config?: RAGEmbeddingConfig): string | null {
  const explicitProxy = config?.proxy?.trim();
  if (explicitProxy) return normalizeProxy(explicitProxy);

  const envProxy =
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy ??
    process.env.ALL_PROXY ??
    process.env.all_proxy;

  return envProxy?.trim() ? normalizeProxy(envProxy) : null;
}

function applyEmbeddingProxy(proxy: string | null): void {
  if (proxy === activeProxy) return;

  if (proxy) {
    setGlobalDispatcher(new ProxyAgent(proxy));
    process.env.HTTPS_PROXY = proxy;
    process.env.HTTP_PROXY = proxy;
    process.env.https_proxy = proxy;
    process.env.http_proxy = proxy;
  } else {
    setGlobalDispatcher(defaultDispatcher);
  }

  activeProxy = proxy;
}

export async function getEmbeddingConfig(): Promise<Required<RAGEmbeddingConfig>> {
  const config = await readResolvedConfig();
  const embedding = config.rag?.embedding ?? {};
  const explicit = await readExplicitEmbeddingConfig();

  const merged = {
    ...DEFAULT_EMBEDDING_CONFIG,
    ...embedding,
    // 优先级：lattice config 显式配置 > HF_ENDPOINT 环境变量 > 默认值
    remoteHost: normalizeHost(
      explicit.remoteHost ?? process.env.HF_ENDPOINT ?? DEFAULT_EMBEDDING_CONFIG.remoteHost,
    ),
  };

  // dimension 自动推断：显式配置 > 已知模型映射 > 默认值
  if (!embedding.dimension && explicit.dimension === undefined) {
    const modelId = merged.modelId;
    const knownDim = KNOWN_MODEL_DIMENSIONS[modelId];
    if (knownDim) {
      merged.dimension = knownDim;
    }
  }

  return merged;
}

/** 加载 embedding 模型（懒加载，首次调用时加载） */
async function ensureModel(): Promise<void> {
  if (pipeline) return;
  if (loadingPromise) {
    await loadingPromise;
    return;
  }

  loadingPromise = (async () => {
    modelLoadError = null;
    try {
      const config = await getEmbeddingConfig();
      const { pipeline: createPipeline, env } = await import('@huggingface/transformers');

      if (config.cacheDir) {
        await ensureDir(config.cacheDir);
        env.cacheDir = config.cacheDir;
      }
      if (config.localModelPath) {
        await ensureDir(config.localModelPath);
        env.localModelPath = config.localModelPath;
      }

      applyEmbeddingProxy(resolveEmbeddingProxy(config));
      env.allowRemoteModels = config.allowRemoteModels;
      env.allowLocalModels = config.allowLocalModels;
      env.remoteHost = config.remoteHost;
      env.remotePathTemplate = config.remotePathTemplate;

      const extractor = await createPipeline('feature-extraction', config.modelId, {
        dtype: config.dtype,
      });
      const poolingStrategy = config.pooling;
      pipeline = async (text: string | string[]) => {
        const result = await extractor(text, { pooling: poolingStrategy, normalize: true });
        return result;
      };
    } catch (err) {
      modelLoadError = err as Error;
      console.warn('Embedding 模型加载失败：', (err as Error).message);
      if (isNetworkError(err)) {
        console.warn(formatModelNetworkHint());
      }
      pipeline = null;
    }
  })();

  await loadingPromise;
}

/** 生成文本的 embedding 向量 */
export async function generateEmbedding(text: string): Promise<Float32Array | null> {
  await ensureModel();
  if (!pipeline) return null;

  try {
    const result = await pipeline(text);
    const vectors = result.tolist();
    return new Float32Array(vectors[0]);
  } catch {
    return null;
  }
}

/** 批量生成 embedding（使用 pipeline 批量输入，加速索引）
 *  自适应降级：batch 推理失败时自动拆小重试，直到成功或降为 1，避免静默丢向量
 */
const MIN_BATCH_SIZE = 1;

/** 对单个 batch 尝试推理，失败时自适应拆半重试 */
async function embedBatchWithFallback(texts: string[]): Promise<(Float32Array | null)[]> {
  if (texts.length === 0) return [];
  if (!pipeline) return texts.map(() => null);

  try {
    const result = await pipeline(texts);
    const vectors = result.tolist();
    return vectors.map((v) => new Float32Array(v));
  } catch {
    // batch 大小为 1 仍失败 → 真正无法生成，返回 null
    if (texts.length <= MIN_BATCH_SIZE) {
      return texts.map(() => null);
    }
    // 拆半重试
    const mid = Math.floor(texts.length / 2);
    const left = await embedBatchWithFallback(texts.slice(0, mid));
    const right = await embedBatchWithFallback(texts.slice(mid));
    return [...left, ...right];
  }
}

export async function generateEmbeddings(
  texts: string[],
  onBatchProgress?: (processed: number, total: number) => void,
  batchSize: number = DEFAULT_EMBEDDING_CONFIG.batchSize,
): Promise<(Float32Array | null)[]> {
  await ensureModel();
  if (!pipeline) return texts.map(() => null);

  const results: (Float32Array | null)[] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchResults = await embedBatchWithFallback(batch);
    results.push(...batchResults);
    if (onBatchProgress) {
      onBatchProgress(Math.min(i + batchSize, texts.length), texts.length);
    }
  }
  return results;
}

function getModelPathCandidates(baseDir: string, modelId: string): string[] {
  const normalizedModelId = modelId.replace(/\//g, '--');
  return [
    join(baseDir, modelId),
    join(baseDir, ...modelId.split('/')),
    join(baseDir, normalizedModelId),
    join(baseDir, `models--${normalizedModelId}`),
  ];
}

async function hasModelArtifacts(baseDir: string, modelId: string): Promise<boolean> {
  if (!(await dirExists(baseDir))) return false;

  for (const candidate of getModelPathCandidates(baseDir, modelId)) {
    if (await fileExists(candidate)) {
      return true;
    }
  }

  const entries = await listDir(baseDir);
  const normalizedModelId = modelId.replace(/[\\/]/g, '--').toLowerCase();
  const modelLeaf = modelId.split('/').at(-1)?.toLowerCase() ?? modelId.toLowerCase();
  const modelOwner = modelId.split('/').at(0)?.toLowerCase() ?? '';

  for (const entry of entries) {
    const lowerEntry = entry.toLowerCase();
    if (
      lowerEntry.includes(normalizedModelId) ||
      lowerEntry.includes(modelLeaf) ||
      (modelOwner && lowerEntry.includes(modelOwner))
    ) {
      return true;
    }
  }

  return false;
}

function resetModelState(): void {
  pipeline = null;
  loadingPromise = null;
  modelLoadError = null;
}

async function removeModelArtifacts(baseDir: string, modelId: string): Promise<boolean> {
  if (!(await dirExists(baseDir))) return false;

  const targets = new Set<string>();
  for (const candidate of getModelPathCandidates(baseDir, modelId)) {
    if (await fileExists(candidate)) {
      targets.add(candidate);
    }
  }

  const normalizedModelId = modelId.replace(/[\\/]/g, '--').toLowerCase();
  const cacheDirName = `models--${normalizedModelId}`;
  const entries = await listDir(baseDir);
  for (const entry of entries) {
    const lowerEntry = entry.toLowerCase();
    if (lowerEntry === cacheDirName || lowerEntry.includes(normalizedModelId)) {
      targets.add(join(baseDir, entry));
    }
  }

  await Promise.all(Array.from(targets, (target) => removeDir(target)));
  return targets.size > 0;
}

/** 计算内容的 hash，用于判断内容是否变更 */
export function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/** 检查模型是否已加载 */
export function isModelLoaded(): boolean {
  return pipeline !== null;
}

/** 获取模型加载失败的原因（加载成功时返回 null） */
export function getModelLoadError(): Error | null {
  return modelLoadError;
}

/** 判断模型加载失败是否由网络问题引起 */
export function isModelLoadNetworkError(): boolean {
  return modelLoadError !== null && isNetworkError(modelLoadError);
}

/** 检查模型是否已落盘（已安装/已缓存） */
export async function isModelInstalled(): Promise<boolean> {
  const config = await getEmbeddingConfig();

  if (config.localModelPath && (await hasModelArtifacts(config.localModelPath, config.modelId))) {
    return true;
  }

  if (config.cacheDir && (await hasModelArtifacts(config.cacheDir, config.modelId))) {
    return true;
  }

  return false;
}

/** 删除已安装的 embedding 模型缓存，供重新下载使用 */
export async function removeInstalledModel(): Promise<boolean> {
  const config = await getEmbeddingConfig();
  resetModelState();

  const removed = await Promise.all([
    config.localModelPath ? removeModelArtifacts(config.localModelPath, config.modelId) : false,
    config.cacheDir ? removeModelArtifacts(config.cacheDir, config.modelId) : false,
  ]);

  return removed.some(Boolean);
}
