import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  generateEmbedding,
  generateEmbeddings,
  getModelLoadError,
  isModelInstalled,
  isModelLoadNetworkError,
  isModelLoaded,
  removeInstalledModel,
} from '../src/rag/embeddings';
import { createTempLatticeHome, putFile } from './helpers';

const hf = vi.hoisted(() => ({
  createPipeline: vi.fn(),
  env: {} as Record<string, unknown>,
}));

vi.mock('@huggingface/transformers', () => ({
  pipeline: hf.createPipeline,
  env: hf.env,
}));

let env: Awaited<ReturnType<typeof createTempLatticeHome>>;
const originalProxyEnv = {
  HTTPS_PROXY: process.env.HTTPS_PROXY,
  https_proxy: process.env.https_proxy,
  HTTP_PROXY: process.env.HTTP_PROXY,
  http_proxy: process.env.http_proxy,
};

beforeEach(async () => {
  env = await createTempLatticeHome();
  // 本文件用 mock 模型显式验证加载/推理路径，不受全局离线开关影响
  delete process.env.LATTICE_DISABLE_SEMANTIC;
  hf.createPipeline.mockReset();
  for (const key of Object.keys(hf.env)) delete hf.env[key];
  hf.createPipeline.mockImplementation(async () => {
    return async (text: string | string[]) => {
      const list = Array.isArray(text) ? text : [text];
      if (list.length > 1) throw new Error('batch failed');
      if (list[0] === 'bad') throw new Error('single failed');
      return { tolist: () => list.map(() => [1, 2, 3]) };
    };
  });
  await writeEmbeddingConfig({});
  // 重置模块级模型状态（前一个用例可能已加载 mock pipeline）
  await removeInstalledModel();
});

afterEach(async () => {
  try {
    // 复位全局 dispatcher 与模块级模型状态，避免影响同 worker 的其他文件
    await writeEmbeddingConfig({ proxy: '' });
    await removeInstalledModel();
    await generateEmbedding('cleanup');
  } catch {
    // ignore
  }
  for (const [key, value] of Object.entries(originalProxyEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await env.cleanup();
  process.env.LATTICE_DISABLE_SEMANTIC = '1';
});

async function writeEmbeddingConfig(embedding: Record<string, unknown>) {
  await putFile(
    join(env.latticeHome, 'config', 'config-local.json'),
    JSON.stringify({
      username: 'u1',
      version: 1,
      rag: {
        embedding: {
          modelId: 'test/model',
          batchSize: 3,
          dimension: 3,
          minChunkSize: 10,
          ...embedding,
        },
      },
    }),
  );
}

test('模型加载成功：cacheDir/localModelPath/代理/并发加载/单条与批量推理', async () => {
  const cacheDir = join(env.tmpRoot, 'cache');
  const localModelPath = join(env.tmpRoot, 'local');
  await writeEmbeddingConfig({
    cacheDir,
    localModelPath,
    proxy: 'http://proxy.example:7890',
    allowRemoteModels: false,
    allowLocalModels: true,
  });

  const [a, b] = await Promise.all([generateEmbedding('hello'), generateEmbedding('world')]);
  assert.deepEqual(Array.from(a ?? []), [1, 2, 3]);
  assert.deepEqual(Array.from(b ?? []), [1, 2, 3]);
  assert.equal(isModelLoaded(), true);
  assert.equal(getModelLoadError(), null);
  assert.equal(hf.createPipeline.mock.calls.length, 1, '并发只加载一次');
  assert.equal(hf.createPipeline.mock.calls[0][0], 'feature-extraction');
  assert.equal(hf.createPipeline.mock.calls[0][1], 'test/model');
  assert.equal(hf.env.cacheDir, cacheDir);
  assert.equal(hf.env.localModelPath, localModelPath);
  assert.equal(hf.env.allowRemoteModels, false);
  assert.equal(hf.env.allowLocalModels, true);

  // 已加载后直接复用
  assert.ok(await generateEmbedding('again'));
  assert.equal(hf.createPipeline.mock.calls.length, 1);

  // 单条推理异常 → null
  assert.equal(await generateEmbedding('bad'), null);

  // 批量失败 → 自动拆半重试，最终全部成功
  const progress: number[] = [];
  const batch = await generateEmbeddings(['a', 'b', 'c'], (p, total) => {
    assert.equal(total, 3);
    progress.push(p);
  });
  assert.equal(batch.length, 3);
  assert.ok(batch.every((v) => v !== null));
  assert.deepEqual(progress, [3]);

  assert.deepEqual(await generateEmbeddings([]), []);
});

test('模型加载失败：网络错误、错误状态、批量降级与再次加载', async () => {
  await writeEmbeddingConfig({ proxy: 'http://proxy.example:7890', allowRemoteModels: true });
  hf.createPipeline.mockRejectedValueOnce(new Error('fetch failed: network'));
  assert.equal(await generateEmbedding('x'), null);
  assert.equal(isModelLoaded(), false);
  assert.match(getModelLoadError()?.message ?? '', /fetch failed/);
  assert.equal(isModelLoadNetworkError(), true);
  assert.deepEqual(await generateEmbeddings(['x', 'y']), [null, null]);

  // 重试成功：removeInstalledModel 重置状态；代理相同 → apply 早退分支
  hf.createPipeline.mockImplementation(async () => {
    return async (text: string | string[]) => {
      const list = Array.isArray(text) ? text : [text];
      return { tolist: () => list.map(() => [4, 5, 6]) };
    };
  });
  await removeInstalledModel();
  assert.equal(isModelLoadNetworkError(), false);
  assert.deepEqual(Array.from((await generateEmbedding('ok')) ?? []), [4, 5, 6]);

  // 关闭代理 → 恢复默认 dispatcher
  await writeEmbeddingConfig({ proxy: '' });
  await removeInstalledModel();
  assert.ok(await generateEmbedding('no proxy'));
});

test('isModelInstalled/removeInstalledModel：缓存与本地模型目录探测', async () => {
  assert.equal(await isModelInstalled(), false);

  const cacheDir = join(env.tmpRoot, 'cache-artifacts');
  const localModelPath = join(env.tmpRoot, 'local-artifacts');
  await writeEmbeddingConfig({ cacheDir, localModelPath });
  await mkdir(join(cacheDir, 'models--test--model'), { recursive: true });
  await putFile(join(cacheDir, 'models--test--model', 'config.json'), '{}');
  assert.equal(await isModelInstalled(), true);

  assert.equal(await removeInstalledModel(), true);
  assert.equal(await isModelInstalled(), false);
  assert.equal(await removeInstalledModel(), false);

  // 本地模型目录的 models-- 命名
  await mkdir(join(localModelPath, 'models--test--model'), { recursive: true });
  await putFile(join(localModelPath, 'models--test--model', 'config.json'), '{}');
  assert.equal(await isModelInstalled(), true);
  assert.equal(await removeInstalledModel(), true);
  assert.equal(await isModelInstalled(), false);
});
