/**
 * Init 元数据 — 记录上次 `ltc init` 注入的版本与平台
 *
 * 读写 ~/.lattice/.cache/init-meta.json
 * 用于 postinstall / preAction / doctor 检测 agent 文档是否过期
 */

import { getCacheDir, readJSON, writeJSON, fileExists, join } from '../paths';
import { nowISO } from '../utils/time';
import type { DocLanguage } from '../i18n/language';

const INIT_META_FILE = 'init-meta.json';

export function getInitMetaPath(): string {
  return join(getCacheDir(), INIT_META_FILE);
}

export interface InitMeta {
  /** 执行 init 时的 CLI 版本号 */
  version: string;
  /** 注入完成时间（ISO 8601） */
  injectedAt: string;
  /** 本次注入的平台 ID 列表（如 ['claude-code', 'cursor', 'qoder']） */
  platforms: string[];
  /** 本次注入使用的文档语言；老版本记录可能缺失 */
  language?: DocLanguage;
}

/**
 * 读取 init 元数据。文件不存在返回 null（说明是老版本，从未写入过）。
 */
export async function readInitMeta(): Promise<InitMeta | null> {
  const path = getInitMetaPath();
  if (!(await fileExists(path))) return null;
  return readJSON<InitMeta>(path);
}

/**
 * 写入 init 元数据（在 `ltc init` 注入完成后调用）。
 */
export async function writeInitMeta(
  version: string,
  platforms: string[],
  language?: DocLanguage,
): Promise<void> {
  const meta: InitMeta = {
    version,
    injectedAt: nowISO(),
    platforms,
    ...(language ? { language } : {}),
  };
  await writeJSON(getInitMetaPath(), meta);
}
