import { stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * 向上查找 Git 根。
 *
 * 同时接受 `.git` 目录（普通仓库）与 `.git` 文件（worktree / submodule）；
 * 不执行 git 命令，避免每次刷新面板都付进程启动成本。
 */
export async function findGitRoot(start: string): Promise<string | null> {
  let current = resolve(start);
  for (;;) {
    if (await exists(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
