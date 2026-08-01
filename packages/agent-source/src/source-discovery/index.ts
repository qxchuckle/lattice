import { readdir, access, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import type { ISource } from '@qcqx/lattice-agent-protocol';

const DEFAULT_SOURCES_DIR = join(homedir(), '.lattice', 'agent', 'sources');
const DEFAULT_CONFIG_PATH = join(homedir(), '.lattice', 'agent', 'config.json');

/** 扫描指定目录，加载每个子目录中的源包 */
export async function scanSources(dir: string): Promise<{
  loaded: Array<{ id: string; source: ISource }>;
  failed: Array<{ dir: string; error: string }>;
}> {
  const loaded: Array<{ id: string; source: ISource }> = [];
  const failed: Array<{ dir: string; error: string }> = [];

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err: unknown) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      // 目录不存在 = 无自定义源
      return { loaded, failed };
    }
    throw err;
  }

  for (const entry of entries) {
    const entryPath = resolve(dir, entry);
    const pkgPath = join(entryPath, 'package.json');

    // 跳过没有 package.json 的子目录
    try {
      await access(pkgPath);
    } catch {
      console.warn(`[source-discovery] Skipping ${entry}: no package.json`);
      continue;
    }

    try {
      // 动态 import，Node.js 会读 package.json 的 exports/main 找到入口
      const mod = await import(entryPath);
      const createSource = mod.default;

      if (typeof createSource !== 'function') {
        failed.push({ dir: entryPath, error: 'default export is not a function' });
        console.warn(`[source-discovery] Skipping ${entry}: default export is not a function`);
        continue;
      }

      const source: ISource = createSource();

      // 基本校验：ISource 应该有 id 和 describe 方法
      if (!source || typeof source.id !== 'string' || typeof source.describe !== 'function') {
        failed.push({ dir: entryPath, error: 'default export did not return a valid ISource' });
        console.warn(`[source-discovery] Skipping ${entry}: not a valid ISource`);
        continue;
      }

      loaded.push({ id: source.id, source });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({ dir: entryPath, error: message });
      console.warn(`[source-discovery] Failed to load ${entry}: ${message}`);
    }
  }

  return { loaded, failed };
}

/** 读取 agent 配置 */
export async function readAgentConfig(
  configPath: string = DEFAULT_CONFIG_PATH,
): Promise<{ sources: { disabled: string[] } }> {
  try {
    const raw = await readFile(configPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    const disabled =
      typeof parsed === 'object' &&
      parsed !== null &&
      'sources' in parsed &&
      typeof (parsed as { sources?: unknown }).sources === 'object' &&
      (parsed as { sources?: unknown }).sources !== null &&
      Array.isArray((parsed as { sources: { disabled?: unknown[] } }).sources?.disabled)
        ? (parsed as { sources: { disabled: string[] } }).sources.disabled
        : [];
    return { sources: { disabled } };
  } catch (err: unknown) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { sources: { disabled: [] } };
    }
    console.warn(`[source-discovery] Failed to parse config, using defaults`);
    return { sources: { disabled: [] } };
  }
}

/** 完整发现流程：扫描 + 配置过滤 + 注册 */
export async function discoverAndRegister(
  registry: { register: (source: ISource) => void; unregister: (id: string) => void },
  options?: { sourcesDir?: string; configPath?: string },
): Promise<{
  loaded: Array<{ id: string; source: ISource }>;
  failed: Array<{ dir: string; error: string }>;
  disabled: string[];
}> {
  const sourcesDir = options?.sourcesDir ?? DEFAULT_SOURCES_DIR;
  const configPath = options?.configPath ?? DEFAULT_CONFIG_PATH;

  const config = await readAgentConfig(configPath);
  const disabled = config.sources.disabled;

  const { loaded, failed } = await scanSources(sourcesDir);

  const active = loaded.filter(({ id }) => !disabled.includes(id));

  for (const { id, source } of active) {
    try {
      try {
        registry.unregister(id);
      } catch {
        /* not found is ok */
      }
      registry.register(source);
    } catch (err: unknown) {
      failed.push({
        dir: `registry:${id}`,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { loaded: active, failed, disabled };
}
