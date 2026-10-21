/**
 * 配置域：全局 / 本机配置的读取、默认值、补丁写入与模型预设联动。
 *
 * 写入统一走「读取当前配置 → 在内存应用补丁 → 一次落盘」，避免半保存；
 * 模型字段复用 core 的 applyEmbeddingModelPreset，保证 CLI / Web / VSCode 语义一致。
 */
import {
  applyEmbeddingModelPreset,
  clearEmbeddingModelPresetFields,
  deleteByPath,
  getByPath,
  getDefaultGlobalConfig,
  getDefaultLocalConfig,
  getEmbeddingConfig,
  readGlobalConfig,
  readLocalConfig,
  setByPath,
  writeGlobalConfig,
  writeLocalConfig,
} from '@qcqx/lattice-core';
import type { GlobalConfig, LocalConfig } from '@qcqx/lattice-core';

export type ConfigScope = 'global' | 'local';

export interface ConfigPatch {
  set?: Record<string, unknown>;
  unset?: string[];
}

export interface ConfigApplyResult {
  scope: ConfigScope;
  changedKeys: string[];
  warnings: string[];
  requiresRagRebuild: boolean;
}

/** 拒绝原型链污染路径。 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isSafeConfigKey(key: string): boolean {
  return key.split('.').every((part) => part.length > 0 && !FORBIDDEN_KEYS.has(part));
}

export async function readConfig(scope: ConfigScope): Promise<Record<string, unknown>> {
  if (scope === 'local') {
    return ((await readLocalConfig()) ?? {}) as Record<string, unknown>;
  }
  return (await readGlobalConfig()) as unknown as Record<string, unknown>;
}

export function readConfigDefaults(scope: ConfigScope): Record<string, unknown> {
  return scope === 'local'
    ? (getDefaultLocalConfig() as Record<string, unknown>)
    : (getDefaultGlobalConfig() as unknown as Record<string, unknown>);
}

/**
 * 应用配置补丁并落盘。
 *
 * 注意：local 配置必须已存在（含 username），否则拒绝写入，避免把本机配置写成空壳。
 */
export async function applyConfigPatch(
  scope: ConfigScope,
  patch: ConfigPatch,
): Promise<ConfigApplyResult> {
  const set = patch.set ?? {};
  const unset = patch.unset ?? [];
  const changedKeys: string[] = [];
  const warnings: string[] = [];
  let requiresRagRebuild = false;

  for (const key of [...Object.keys(set), ...unset]) {
    if (!isSafeConfigKey(key)) throw new Error(`非法配置项路径：${key}`);
  }

  if (scope === 'local') {
    const current = await readLocalConfig();
    if (!current) throw new Error('Lattice 尚未初始化，无法写入本机配置');
    if (set.username !== undefined || unset.includes('username')) {
      throw new Error('用户名请使用「切换用户 / 重命名用户」操作');
    }
  }

  const current = (await readConfig(scope)) as Record<string, unknown>;

  // 模型预设：modelId 变化时成组同步 dimension/dtype/pooling/prefix。
  const modelId = set['rag.embedding.modelId'];
  if (modelId !== undefined) {
    if (typeof modelId !== 'string' || !modelId.trim()) {
      throw new Error('模型 ID 不能为空');
    }
    const effective = await getEmbeddingConfig();
    const result = applyEmbeddingModelPreset(current, modelId, {
      scope,
      previousModelId: effective.modelId,
    });
    for (const field of result.appliedFields) changedKeys.push(`rag.embedding.${field}`);
    if (result.modelChanged || result.appliedFields.length > 0) {
      requiresRagRebuild = true;
      if (!result.preset) {
        warnings.push(
          '未识别的模型：已更新 modelId 并清空旧前缀，请确认 dimension 与前缀配置后重建索引',
        );
      } else if (result.modelChanged) {
        warnings.push(
          `已同步模型预设（${result.preset.dimension} 维 / ${result.preset.dtype} / ${result.preset.pooling}），需要重建索引`,
        );
      }
    }
    delete set['rag.embedding.modelId'];
  }

  for (const [key, value] of Object.entries(set)) {
    setByPath(current, key, value);
    changedKeys.push(key);
  }

  for (const key of unset) {
    if (key === 'rag.embedding.modelId') {
      const removed = clearEmbeddingModelPresetFields(current);
      if (deleteByPath(current, key)) changedKeys.push(key);
      for (const field of removed) changedKeys.push(`rag.embedding.${field}`);
      requiresRagRebuild = true;
      warnings.push('模型已移除，将回落到默认模型参数；需要重建索引');
    } else if (deleteByPath(current, key)) {
      changedKeys.push(key);
    }
  }

  if (scope === 'local') {
    await writeLocalConfig(current as LocalConfig);
  } else {
    await writeGlobalConfig(current as GlobalConfig);
  }

  return {
    scope,
    changedKeys: [...new Set(changedKeys)],
    warnings,
    requiresRagRebuild,
  };
}

/** 读取某个生效值（global 用于展示合并默认值后的 embedding 字段）。 */
export async function readEffectiveConfigValue(key: string): Promise<unknown> {
  const config = await readConfig('global');
  return getByPath(config, key);
}
