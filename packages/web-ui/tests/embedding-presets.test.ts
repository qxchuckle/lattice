import { describe, expect, it } from 'vitest';
import {
  EMBEDDING_MODEL_PRESETS,
  applyEmbeddingPresetToValues,
  getEmbeddingModelPreset,
} from '../src/components/admin/embedding-presets';

describe('Web UI embedding presets', () => {
  it('包含与 CLI 对齐的内置模型', () => {
    expect(EMBEDDING_MODEL_PRESETS.map((preset) => preset.id)).toEqual([
      'Xenova/bge-small-zh-v1.5',
      'Xenova/all-MiniLM-L6-v2',
      'Xenova/multilingual-e5-small',
      'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
      'BAAI/bge-base-zh-v1.5',
    ]);
  });

  it('切换模型时同步维度、精度、池化和前缀', () => {
    const values: Record<string, unknown> = {};
    const preset = applyEmbeddingPresetToValues(values, 'Xenova/all-MiniLM-L6-v2');

    expect(preset?.dimension).toBe(384);
    expect(values).toEqual({
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
  });

  it('自定义模型只更新 modelId', () => {
    const values: Record<string, unknown> = {};
    const preset = applyEmbeddingPresetToValues(values, 'custom/model');

    expect(preset).toBeUndefined();
    expect(values).toEqual({ rag: { embedding: { modelId: 'custom/model' } } });
    expect(getEmbeddingModelPreset('custom/model')).toBeUndefined();
  });
});
