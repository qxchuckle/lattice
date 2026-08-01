import { join } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type {
  GlobalConfig,
  LocalConfig,
  RAGEmbeddingConfig,
  ResolvedConfig,
  WebAuthConfig,
} from '../types';
import {
  getGlobalConfigPath,
  getLocalConfigPath,
  getLatticeRoot,
  getCacheDir,
  readJSON,
  writeJSON,
  fileExists,
} from '../paths';

/**
 * 全局配置默认值——仅路径/网络字段。
 * model 相关默认值（modelId, dimension, dtype, pooling 等）由 rag/embeddings.ts 的
 * DEFAULT_EMBEDDING_CONFIG 统一管理，避免两套默认值不一致。
 */
const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  version: '0.1.0',
  rag: {
    embedding: {
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

/**
 * 读取用户显式配置的 embedding 字段（未经默认值填充）。
 *
 * 用于判断某个字段是否被用户在 config.json / config-local.json 中显式设置，
 * 而非来自 DEFAULT_GLOBAL_CONFIG 的填充值。典型场景：remoteHost 的环境变量
 * fallback 判定——只有用户未显式配置 remoteHost 时，才回退到 HF_ENDPOINT。
 */
export async function readExplicitEmbeddingConfig(): Promise<Partial<RAGEmbeddingConfig>> {
  const [globalRaw, localRaw] = await Promise.all([
    readJSON<GlobalConfig>(getGlobalConfigPath()),
    readJSON<LocalConfig>(getLocalConfigPath()),
  ]);
  const localRag = localRaw?.rag as { embedding?: Partial<RAGEmbeddingConfig> } | undefined;
  return {
    ...globalRaw?.rag?.embedding,
    ...localRag?.embedding,
  };
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

// ─── Web 面板鉴权 ───

/** scrypt 输出长度 */
const SCRYPT_KEYLEN = 64;
/** scrypt 随机 salt 长度 */
const SCRYPT_SALT_LEN = 16;

/** 用 scrypt 哈希密码，返回 { passwordHash, salt }（base64），与 WebAuthConfig 字段对齐 */
export function hashPassword(password: string): { passwordHash: string; salt: string } {
  const salt = randomBytes(SCRYPT_SALT_LEN);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return { passwordHash: hash.toString('base64'), salt: salt.toString('base64') };
}

/** 校验密码（常量时间比较防时序攻击） */
export function verifyPassword(
  password: string,
  stored: { passwordHash: string; salt: string },
): boolean {
  const salt = Buffer.from(stored.salt, 'base64');
  const expectedHash = Buffer.from(stored.passwordHash, 'base64');
  const actualHash = scryptSync(password, salt, SCRYPT_KEYLEN);
  if (actualHash.length !== expectedHash.length) return false;
  return timingSafeEqual(actualHash, expectedHash);
}

/** 生成随机 JWT HS256 签名密钥（base64） */
export function generateJwtSecret(): string {
  return randomBytes(32).toString('base64');
}

/** 读取 web 鉴权配置，未配置返回 null */
export async function readWebAuth(): Promise<WebAuthConfig | null> {
  const config = await readLocalConfig();
  return config?.webAuth ?? null;
}

/** 写入 web 鉴权配置（合并到 config-local.json） */
export async function writeWebAuth(webAuth: WebAuthConfig): Promise<void> {
  const config = (await readLocalConfig()) ?? { username: '' };
  config.webAuth = webAuth;
  await writeLocalConfig(config);
}

/** 清除 web 鉴权配置（恢复无鉴权） */
export async function clearWebAuth(): Promise<void> {
  const config = await readLocalConfig();
  if (config) {
    delete config.webAuth;
    await writeLocalConfig(config);
  }
}

/** 是否启用了 web 鉴权（配置了密码） */
export async function isAuthEnabled(): Promise<boolean> {
  const webAuth = await readWebAuth();
  return !!webAuth?.passwordHash;
}
