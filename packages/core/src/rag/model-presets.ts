import { deleteByPath, getByPath, setByPath } from '../config/utils';
import type { RAGEmbeddingConfig } from '../types';

/**
 * 内置 embedding 模型预设。
 *
 * 模型 ID、向量维度、池化策略和 query/document 前缀必须成组切换：
 * 只改 modelId 会导致旧维度/旧前缀继续生效，出现向量维度不匹配或检索效果下降。
 */
export interface EmbeddingModelPreset {
  id: string;
  label: string;
  description: string;
  dimension: number;
  dtype: NonNullable<RAGEmbeddingConfig['dtype']>;
  pooling: NonNullable<RAGEmbeddingConfig['pooling']>;
  queryPrefix: string;
  documentPrefix: string;
}

export const DEFAULT_EMBEDDING_MODEL_ID = 'Xenova/bge-small-zh-v1.5';

export const EMBEDDING_MODEL_PRESETS: readonly EmbeddingModelPreset[] = [
  {
    id: DEFAULT_EMBEDDING_MODEL_ID,
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

/** 按模型 ID 查找预设（未知模型返回 undefined） */
export function getEmbeddingModelPreset(modelId: string): EmbeddingModelPreset | undefined {
  const normalized = modelId.trim();
  return EMBEDDING_MODEL_PRESETS.find((preset) => preset.id === normalized);
}

/** 生成某个模型对应的完整 embedding 配置；未知模型只返回 modelId */
export function getEmbeddingModelConfig(modelId: string): Partial<RAGEmbeddingConfig> {
  const normalized = modelId.trim();
  const preset = getEmbeddingModelPreset(normalized);
  if (!preset) {
    return { modelId: normalized };
  }

  return {
    modelId: preset.id,
    dimension: preset.dimension,
    dtype: preset.dtype,
    pooling: preset.pooling,
    queryPrefix: preset.queryPrefix,
    documentPrefix: preset.documentPrefix,
  };
}

/** 切换模型时需要同步的预设字段（不含 modelId 本身） */
export const EMBEDDING_MODEL_RELATED_KEYS = [
  'dimension',
  'dtype',
  'pooling',
  'queryPrefix',
  'documentPrefix',
] as const;

export interface ApplyEmbeddingModelPresetOptions {
  scope: 'global' | 'local';
  /** 切换前的实际生效模型，用于判断是全量同步还是只补齐缺失字段 */
  previousModelId: string;
}

export interface ApplyEmbeddingModelPresetResult {
  modelId: string;
  modelChanged: boolean;
  preset?: EmbeddingModelPreset;
  appliedFields: string[];
}

/**
 * 将模型选择写入配置对象（不会落盘）。
 *
 * - 切换模型：成组写入预设字段，避免旧维度/旧前缀残留；
 * - 同一模型：global 只补齐缺失字段，local 不覆盖继承自 global 的参数；
 * - 未知模型：写 modelId；切换模型时清空旧前缀，调用方提示用户确认维度/前缀。
 */
export function applyEmbeddingModelPreset(
  config: Record<string, unknown>,
  modelId: string,
  options: ApplyEmbeddingModelPresetOptions,
): ApplyEmbeddingModelPresetResult {
  const normalized = modelId.trim();
  if (!normalized) {
    throw new Error('模型 ID 不能为空');
  }
  const modelChanged = options.previousModelId !== normalized;
  const preset = getEmbeddingModelPreset(normalized);
  const appliedFields: string[] = [];

  if (!preset) {
    setByPath(config, 'rag.embedding.modelId', normalized);
    appliedFields.push('modelId');
    // 未知模型无法推断前缀；切换模型时清空旧模型前缀，避免继续使用 BGE/E5 的错误前缀。
    if (modelChanged) {
      setByPath(config, 'rag.embedding.queryPrefix', '');
      setByPath(config, 'rag.embedding.documentPrefix', '');
      appliedFields.push('queryPrefix', 'documentPrefix');
    }
    return { modelId: normalized, modelChanged, appliedFields };
  }

  for (const [field, value] of Object.entries(getEmbeddingModelConfig(normalized))) {
    const fieldPath = `rag.embedding.${field}`;
    if (
      modelChanged ||
      (options.scope === 'global' && getByPath(config, fieldPath) === undefined)
    ) {
      setByPath(config, fieldPath, value);
      appliedFields.push(field);
    }
  }

  // 同一模型且参数完整时循环可能不写入；仍确保 modelId 本身已设置
  setByPath(config, 'rag.embedding.modelId', normalized);
  return { modelId: normalized, modelChanged, preset, appliedFields };
}

/** 移除模型时清理关联参数；返回被删除的字段名 */
export function clearEmbeddingModelPresetFields(config: Record<string, unknown>): string[] {
  const removed: string[] = [];
  for (const field of EMBEDDING_MODEL_RELATED_KEYS) {
    if (deleteByPath(config, `rag.embedding.${field}`)) {
      removed.push(field);
    }
  }
  return removed;
}
