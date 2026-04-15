import { join } from 'node:path';
import type { GlobalConfig, LocalConfig, ResolvedConfig } from '../types';
import {
  getGlobalConfigPath,
  getLocalConfigPath,
  getLatticeRoot,
  getCacheDir,
  readJSON,
  writeJSON,
  fileExists,
} from '../paths';

const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  version: '0.1.0',
  rag: {
    embedding: {
      modelId: 'Xenova/all-MiniLM-L6-v2',
      remoteHost: 'https://huggingface.co/',
      remotePathTemplate: '{model}/resolve/{revision}/',
      localModelPath: join(getLatticeRoot(), 'models'),
      cacheDir: join(getCacheDir(), 'huggingface'),
      allowRemoteModels: true,
      allowLocalModels: true,
      proxy: '',
    },
  },
};

export function getDefaultGlobalConfig(): GlobalConfig {
  return mergeGlobalConfig(null);
}

export function getDefaultLocalConfig(): Partial<LocalConfig> {
  return {};
}

function mergeGlobalConfig(config?: GlobalConfig | null): GlobalConfig {
  const legacySpecTemplates = Array.isArray(config?.specTemplates)
    ? (config.specTemplates as string[])
    : undefined;

  return {
    ...DEFAULT_GLOBAL_CONFIG,
    ...config,
    registryTemplates: config?.registryTemplates ?? legacySpecTemplates,
    rag: {
      ...DEFAULT_GLOBAL_CONFIG.rag,
      ...config?.rag,
      embedding: {
        ...DEFAULT_GLOBAL_CONFIG.rag?.embedding,
        ...config?.rag?.embedding,
      },
    },
  };
}

function stripDefaultsForPersist(
  current: Record<string, unknown>,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(current)) {
    const currentValue = current[key];
    const defaultValue = defaults[key];

    if (
      currentValue &&
      defaultValue &&
      typeof currentValue === 'object' &&
      typeof defaultValue === 'object' &&
      !Array.isArray(currentValue) &&
      !Array.isArray(defaultValue)
    ) {
      const nested = stripDefaultsForPersist(
        currentValue as Record<string, unknown>,
        defaultValue as Record<string, unknown>,
      );
      if (Object.keys(nested).length > 0) {
        result[key] = nested;
      }
      continue;
    }

    if (JSON.stringify(currentValue) !== JSON.stringify(defaultValue)) {
      result[key] = currentValue;
    }
  }

  return result;
}

function mergeResolvedConfig(
  globalConfig: GlobalConfig,
  localConfig?: LocalConfig | null,
): ResolvedConfig {
  return {
    ...globalConfig,
    ...localConfig,
    rag: {
      ...globalConfig.rag,
      ...(localConfig?.rag as Record<string, unknown> | undefined),
      embedding: {
        ...globalConfig.rag?.embedding,
        ...((localConfig?.rag as { embedding?: Record<string, unknown> } | undefined)?.embedding ??
          {}),
      },
    },
  };
}

// ─── 全局配置 ───

export async function readGlobalConfig(): Promise<GlobalConfig> {
  return mergeGlobalConfig(await readJSON<GlobalConfig>(getGlobalConfigPath()));
}

export async function writeGlobalConfig(config: GlobalConfig): Promise<void> {
  const merged = mergeGlobalConfig(config) as GlobalConfig & { specTemplates?: unknown };
  delete merged.specTemplates;
  const persisted = {
    version: merged.version,
    ...stripDefaultsForPersist(
      merged as Record<string, unknown>,
      DEFAULT_GLOBAL_CONFIG as Record<string, unknown>,
    ),
  };
  await writeJSON(getGlobalConfigPath(), persisted);
}

// ─── 本机配置 ───

export async function readLocalConfig(): Promise<LocalConfig | null> {
  return readJSON<LocalConfig>(getLocalConfigPath());
}

export async function writeLocalConfig(config: LocalConfig): Promise<void> {
  await writeJSON(getLocalConfigPath(), config);
}

export async function readResolvedConfig(): Promise<ResolvedConfig> {
  const [globalConfig, localConfig] = await Promise.all([readGlobalConfig(), readLocalConfig()]);
  return mergeResolvedConfig(globalConfig, localConfig);
}

// ─── 便捷函数 ───

export async function getUsername(): Promise<string> {
  const config = await readLocalConfig();
  if (!config?.username) {
    throw new Error('Lattice 未初始化，请先运行 lattice init');
  }
  return config.username;
}

export async function isInitialized(): Promise<boolean> {
  const rootExists = await fileExists(getLatticeRoot());
  if (!rootExists) return false;
  const config = await readLocalConfig();
  return !!config?.username;
}
