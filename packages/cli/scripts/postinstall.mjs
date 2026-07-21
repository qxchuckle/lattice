/**
 * postinstall — 安装后自动检测 agent 文档注入状态
 *
 * 纯 Node ESM 脚本，不依赖构建产物（安装时 dist 可能尚未存在）。
 * 逻辑：
 *   1. ~/.lattice 不存在 → 静默跳过（用户尚未 init）
 *   2. ~/.lattice/.cache/init-meta.json 不存在 → 老版本，提示 init
 *   3. version 不匹配 → 提示 init
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

try {
  const latticeRoot = process.env.LATTICE_HOME || join(homedir(), '.lattice');

  // 未初始化 → 静默退出
  if (!existsSync(latticeRoot)) process.exit(0);

  // 读取当前安装的 CLI 版本
  const pkgPath = resolve(__dirname, '../package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const currentVersion = pkg.version;

  // 读取 init-meta
  const metaPath = join(latticeRoot, '.cache', 'init-meta.json');
  if (!existsSync(metaPath)) {
    console.log(`\x1b[33m⚠ lattice 注入已过期，运行 ltc init 更新\x1b[0m`);
    process.exit(0);
  }

  const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
  if (meta.version !== currentVersion) {
    console.log(`\x1b[33m⚠ lattice 注入已过期，运行 ltc init 更新\x1b[0m`);
  }
} catch {
  // postinstall 失败不阻断安装
  process.exit(0);
}
