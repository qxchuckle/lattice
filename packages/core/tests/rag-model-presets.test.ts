import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  DEFAULT_EMBEDDING_MODEL_ID,
  EMBEDDING_MODEL_PRESETS,
  applyEmbeddingModelPreset,
  clearEmbeddingModelPresetFields,
  getEmbeddingModelConfig,
  getEmbeddingModelPreset,
} from '../src/rag/model-presets';

test('默认模型为 bge-small-zh，预设字段保持一致', () => {
  assert.equal(DEFAULT_EMBEDDING_MODEL_ID, 'Xenova/bge-small-zh-v1.5');

  const preset = getEmbeddingModelPreset(DEFAULT_EMBEDDING_MODEL_ID);
  assert.ok(preset);
  assert.equal(preset.dimension, 512);
  assert.equal(preset.dtype, 'q8');
  assert.equal(preset.pooling, 'mean');
  assert.match(preset.queryPrefix, /^为这个句子/);
  assert.equal(preset.documentPrefix, '');

  // 容忍前后空白
  assert.equal(
    getEmbeddingModelPreset(`  ${DEFAULT_EMBEDDING_MODEL_ID}  `)?.id,
    DEFAULT_EMBEDDING_MODEL_ID,
  );
});

test('getEmbeddingModelConfig：预设返回完整配置，未知模型只返回 modelId', () => {
  assert.deepEqual(getEmbeddingModelConfig('Xenova/all-MiniLM-L6-v2'), {
    modelId: 'Xenova/all-MiniLM-L6-v2',
    dimension: 384,
    dtype: 'q8',
    pooling: 'mean',
    queryPrefix: '',
    documentPrefix: '',
  });

  assert.deepEqual(getEmbeddingModelConfig('custom/model'), { modelId: 'custom/model' });
  assert.ok(EMBEDDING_MODEL_PRESETS.length >= 4);
});

test('applyEmbeddingModelPreset：切换全量同步，同模型只补齐缺失字段', () => {
  const changed: Record<string, unknown> = {};
  const changedResult = applyEmbeddingModelPreset(changed, 'Xenova/all-MiniLM-L6-v2', {
    scope: 'global',
    previousModelId: DEFAULT_EMBEDDING_MODEL_ID,
  });
  assert.equal(changedResult.modelChanged, true);
  assert.equal(changedResult.preset?.dimension, 384);
  assert.deepEqual(changed, {
    rag: {
      embedding: {
        modelId: 'Xenova/all-MiniLM-L6-v2',
        dimension: 384,
        dtype: 'q8',
        pooling: 'mean',
        queryPrefix: '',
        documentPrefix: '',
      },
    },
  });

  const same: Record<string, unknown> = {
    rag: {
      embedding: {
        modelId: 'Xenova/all-MiniLM-L6-v2',
        dtype: 'fp32',
      },
    },
  };
  const sameResult = applyEmbeddingModelPreset(same, 'Xenova/all-MiniLM-L6-v2', {
    scope: 'global',
    previousModelId: 'Xenova/all-MiniLM-L6-v2',
  });
  assert.equal(sameResult.modelChanged, false);
  assert.deepEqual(sameResult.appliedFields.sort(), [
    'dimension',
    'documentPrefix',
    'pooling',
    'queryPrefix',
  ]);
  assert.equal(
    ((same.rag as Record<string, unknown>).embedding as Record<string, unknown>).dtype,
    'fp32',
  );
});

test('applyEmbeddingModelPreset：拒绝空模型 ID', () => {
  assert.throws(
    () =>
      applyEmbeddingModelPreset({}, '   ', {
        scope: 'global',
        previousModelId: DEFAULT_EMBEDDING_MODEL_ID,
      }),
    /模型 ID 不能为空/,
  );
});

test('applyEmbeddingModelPreset：local 同模型不覆盖继承值，未知模型只写 modelId', () => {
  const local: Record<string, unknown> = {};
  const localResult = applyEmbeddingModelPreset(local, 'Xenova/all-MiniLM-L6-v2', {
    scope: 'local',
    previousModelId: 'Xenova/all-MiniLM-L6-v2',
  });
  assert.deepEqual(localResult.appliedFields, []);
  assert.deepEqual(local, { rag: { embedding: { modelId: 'Xenova/all-MiniLM-L6-v2' } } });

  const custom: Record<string, unknown> = {
    rag: {
      embedding: {
        modelId: DEFAULT_EMBEDDING_MODEL_ID,
        dimension: 512,
        queryPrefix: 'old-query: ',
        documentPrefix: 'old-document: ',
      },
    },
  };
  const customResult = applyEmbeddingModelPreset(custom, ' custom/model ', {
    scope: 'global',
    previousModelId: DEFAULT_EMBEDDING_MODEL_ID,
  });
  assert.equal(customResult.preset, undefined);
  assert.equal(customResult.modelChanged, true);
  assert.deepEqual(custom, {
    rag: {
      embedding: {
        modelId: 'custom/model',
        dimension: 512,
        queryPrefix: '',
        documentPrefix: '',
      },
    },
  });
});

test('clearEmbeddingModelPresetFields：清理模型关联参数并保留其他配置', () => {
  const config: Record<string, unknown> = {
    rag: {
      embedding: {
        modelId: 'Xenova/all-MiniLM-L6-v2',
        dimension: 384,
        dtype: 'q8',
        pooling: 'mean',
        queryPrefix: '',
        documentPrefix: '',
        batchSize: 32,
      },
    },
  };
  const removed = clearEmbeddingModelPresetFields(config);
  assert.deepEqual(removed.sort(), [
    'dimension',
    'documentPrefix',
    'dtype',
    'pooling',
    'queryPrefix',
  ]);
  assert.deepEqual(config, {
    rag: {
      embedding: {
        modelId: 'Xenova/all-MiniLM-L6-v2',
        batchSize: 32,
      },
    },
  });
});
