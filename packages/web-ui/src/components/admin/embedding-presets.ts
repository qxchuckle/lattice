/**
 * Web UI 侧的 embedding 预设。
 *
 * Web UI 运行在浏览器/VSCode Webview，不能直接依赖 Node 侧的 core 包；
 * 这里与 `packages/core/src/rag/model-presets.ts` 保持同步。调整模型或参数时请同时更新两处。
 */
export interface EmbeddingModelPreset {
  id: string;
  label: string;
  description: string;
  dimension: number;
  dtype: string;
  pooling: string;
  queryPrefix: string;
  documentPrefix: string;
}

export const EMBEDDING_MODEL_PRESETS: readonly EmbeddingModelPreset[] = [
  {
    id: 'Xenova/bge-small-zh-v1.5',
    label: 'BGE Small 中文',
    description: '中文优先，体积小，默认推荐',
    dimension: 512,
    dtype: 'q8',
    pooling: 'mean',
    queryPrefix: '为这个句子生成表示以用于检索相关文章：',
    documentPrefix: '',
  },
  {
    id: 'Xenova/all-MiniLM-L6-v2',
    label: 'MiniLM 英文轻量',
    description: '英文优先，体积最小',
    dimension: 384,
    dtype: 'q8',
    pooling: 'mean',
    queryPrefix: '',
    documentPrefix: '',
  },
  {
    id: 'Xenova/multilingual-e5-small',
    label: 'Multilingual E5 Small',
    description: '多语言，适合中英混合',
    dimension: 384,
    dtype: 'q8',
    pooling: 'mean',
    queryPrefix: 'query: ',
    documentPrefix: 'passage: ',
  },
  {
    id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    label: 'Paraphrase Multilingual MiniLM',
    description: '多语言，兼容性较好',
    dimension: 384,
    dtype: 'q8',
    pooling: 'mean',
    queryPrefix: '',
    documentPrefix: '',
  },
  {
    id: 'BAAI/bge-base-zh-v1.5',
    label: 'BGE Base 中文',
    description: '中文效果更好，体积更大',
    dimension: 768,
    dtype: 'q8',
    pooling: 'mean',
    queryPrefix: '为这个句子生成表示以用于检索相关文章：',
    documentPrefix: '',
  },
];

export function getEmbeddingModelPreset(modelId: string): EmbeddingModelPreset | undefined {
  const normalized = modelId.trim();
  return EMBEDDING_MODEL_PRESETS.find((preset) => preset.id === normalized);
}

function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts.at(-1)!] = value;
}

/** 将模型预设写入配置表单值；未知模型只写 modelId */
export function applyEmbeddingPresetToValues(
  values: Record<string, unknown>,
  modelId: string,
): EmbeddingModelPreset | undefined {
  const preset = getEmbeddingModelPreset(modelId);
  if (!preset) {
    setByPath(values, 'rag.embedding.modelId', modelId.trim());
    return undefined;
  }

  for (const [field, value] of Object.entries({
    modelId: preset.id,
    dimension: preset.dimension,
    dtype: preset.dtype,
    pooling: preset.pooling,
    queryPrefix: preset.queryPrefix,
    documentPrefix: preset.documentPrefix,
  })) {
    setByPath(values, `rag.embedding.${field}`, value);
  }
  return preset;
}
