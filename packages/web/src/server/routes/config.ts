import type { FastifyInstance } from 'fastify';
import {
  readGlobalConfig,
  readLocalConfig,
  writeGlobalConfig,
  writeLocalConfig,
  getDefaultGlobalConfig,
  getDefaultLocalConfig,
  getEmbeddingConfig,
  applyEmbeddingModelPreset,
  clearEmbeddingModelPresetFields,
  getByPath,
  setByPath,
  deleteByPath,
  diffConfig,
  type GlobalConfig,
  type LocalConfig,
} from '@qcqx/lattice-core';

/** 拒绝原型链污染路径 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isSafeKey(key: string): boolean {
  return key.split('.').every((k) => !FORBIDDEN_KEYS.has(k));
}

/** Web 配置面板展示实际生效的 embedding 默认值，而不是只展示显式写入的字段 */
async function withEffectiveEmbedding(
  config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const embedding = await getEmbeddingConfig();
  const rag = (config.rag ?? {}) as Record<string, unknown>;
  const configuredEmbedding = (rag.embedding ?? {}) as Record<string, unknown>;
  return {
    ...config,
    rag: {
      ...rag,
      embedding: {
        ...embedding,
        ...configuredEmbedding,
      },
    },
  };
}

/** 与 CLI 的 config set 保持一致：切换模型时成组更新依赖参数 */
async function applyConfigValue(
  config: Record<string, unknown>,
  key: string,
  value: unknown,
  scope: string,
): Promise<void> {
  if (key !== 'rag.embedding.modelId' || typeof value !== 'string') {
    setByPath(config, key, value);
    return;
  }

  const modelId = value.trim();
  const storedModelId = getByPath(config, key);
  const previousModelId =
    typeof storedModelId === 'string' && storedModelId.trim()
      ? storedModelId.trim()
      : (await getEmbeddingConfig()).modelId;

  applyEmbeddingModelPreset(config, modelId, {
    scope: scope === 'global' ? 'global' : 'local',
    previousModelId,
  });
}

export function registerConfigRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { scope?: string; diffDefaults?: string } }>(
    '/api/config',
    async (req) => {
      const scope = req.query.scope ?? 'global';
      if (scope === 'global') {
        const config = await readGlobalConfig();
        if (req.query.diffDefaults === 'true') {
          return diffConfig(config, getDefaultGlobalConfig() as Record<string, unknown>);
        }
        return withEffectiveEmbedding(config as Record<string, unknown>);
      }
      const config = await readLocalConfig();
      if (req.query.diffDefaults === 'true') {
        return diffConfig(
          (config ?? {}) as Record<string, unknown>,
          getDefaultLocalConfig() as Record<string, unknown>,
        );
      }
      return config;
    },
  );

  app.post<{ Body: { key: string; value: unknown; scope: string } }>(
    '/api/config/set',
    async (req) => {
      const { key, value, scope } = req.body;
      if (!key || !isSafeKey(key)) {
        return { error: 'bad_request', message: '无效的配置路径' };
      }
      if (key === 'rag.embedding.modelId' && (typeof value !== 'string' || !value.trim())) {
        return { error: 'bad_request', message: '模型 ID 不能为空' };
      }
      if (scope === 'global') {
        const config = (await readGlobalConfig()) as Record<string, unknown>;
        await applyConfigValue(config, key, value, scope);
        await writeGlobalConfig(config as GlobalConfig);
        return { success: true };
      }
      const config = ((await readLocalConfig()) ?? { username: '' }) as Record<string, unknown>;
      await applyConfigValue(config, key, value, scope);
      await writeLocalConfig(config as LocalConfig);
      return { success: true };
    },
  );

  app.post<{ Body: { key: string; scope: string } }>('/api/config/unset', async (req) => {
    const { key, scope } = req.body;
    if (!key || !isSafeKey(key)) {
      return { error: 'bad_request', message: '无效的配置路径' };
    }
    if (scope === 'global') {
      const config = (await readGlobalConfig()) as Record<string, unknown>;
      if (key === 'rag.embedding.modelId') {
        clearEmbeddingModelPresetFields(config);
      }
      deleteByPath(config, key);
      await writeGlobalConfig(config as GlobalConfig);
      return { success: true };
    }
    const config = ((await readLocalConfig()) ?? { username: '' }) as Record<string, unknown>;
    if (key === 'rag.embedding.modelId') {
      clearEmbeddingModelPresetFields(config);
    }
    deleteByPath(config, key);
    await writeLocalConfig(config as LocalConfig);
    return { success: true };
  });
}
