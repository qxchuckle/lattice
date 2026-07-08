import { resolve as pathResolve, sep } from 'node:path';
import simpleGit from 'simple-git';
import { glob } from 'glob';
import { fileExists, readJSON, dirExists, join } from '../paths';
import { normalizeGitRemote } from './identity';
import type { FingerprintDerived } from './identity';

// normalizeGitRemote 和 FingerprintDerived 已迁移到 identity.ts（纯函数模块）
export { normalizeGitRemote, type FingerprintDerived } from './identity';

/** 把本地路径标准化（去尾部斜杠） */
export function normalizeLocalPath(p: string): string {
  return pathResolve(p).replace(/\/+$/, '');
}

/** 路径前缀匹配（按路径段边界） */
export function isPathPrefixOf(prefix: string, target: string): boolean {
  const a = normalizeLocalPath(prefix);
  const b = normalizeLocalPath(target);
  if (a === b) return true;
  return b.startsWith(a + sep);
}

/**
 * 收集项目的多源指纹（derived 数据）
 *
 * 新机制：不再生成 entries 数组（旧评分机制已废弃）。
 * 只采集 derived 数据用于计算项目 IDs（git:first_commit, remote:hash）。
 */
export async function collectFingerprint(projectPath: string): Promise<{
  derived: FingerprintDerived;
}> {
  const derived: FingerprintDerived = {
    gitRemotes: [],
    packageNames: [],
    monorepoPackages: [],
  };

  // git first commit — 使用 simple-git
  try {
    const git = simpleGit(projectPath);
    const rootCommits = await git.raw(['rev-list', '--max-parents=0', 'HEAD']);
    const rootSha = rootCommits.trim().split('\n')[0]?.trim();
    if (rootSha && /^[0-9a-f]{7,}$/i.test(rootSha)) {
      derived.gitFirstCommit = rootSha;
    }
  } catch {
    // 无 git 或非首次 commit 历史
  }

  // git remotes — 使用 simple-git
  try {
    const git = simpleGit(projectPath);
    const remotes = await git.getRemotes(true);
    for (const remote of remotes) {
      const url = remote.refs?.fetch || remote.refs?.push;
      if (url) {
        const normalized = normalizeGitRemote(url);
        if (normalized && !derived.gitRemotes.includes(normalized)) {
          derived.gitRemotes.push(normalized);
        }
      }
    }
  } catch {
    // 不是 git 仓库
  }

  // git default branch — 使用 simple-git
  try {
    const git = simpleGit(projectPath);
    try {
      const headRef = await git.raw(['symbolic-ref', 'refs/remotes/origin/HEAD']);
      const m = headRef.trim().match(/refs\/remotes\/origin\/(.+)$/);
      if (m?.[1]) derived.gitDefaultBranch = m[1];
    } catch {
      // 没有 origin/HEAD
    }
    if (!derived.gitDefaultBranch) {
      const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
      const trimmed = branch.trim();
      if (trimmed && trimmed !== 'HEAD') derived.gitDefaultBranch = trimmed;
    }
  } catch {
    // 忽略
  }

  // package.json 名 + monorepo workspaces 扫描
  const pkgPath = join(projectPath, 'package.json');
  if (await fileExists(pkgPath)) {
    const pkg = await readJSON<{
      name?: string;
      workspaces?: string[] | { packages?: string[] };
    }>(pkgPath);
    if (pkg?.name) {
      derived.packageNames.push(pkg.name);
    }

    // monorepo workspaces
    const wsPatterns: string[] = [];
    if (Array.isArray(pkg?.workspaces)) {
      wsPatterns.push(...(pkg.workspaces as string[]));
    } else if (
      pkg?.workspaces &&
      typeof pkg.workspaces === 'object' &&
      Array.isArray((pkg.workspaces as { packages?: string[] }).packages)
    ) {
      wsPatterns.push(...(pkg.workspaces as { packages: string[] }).packages);
    }
    // pnpm-workspace.yaml
    const pnpmWsPath = join(projectPath, 'pnpm-workspace.yaml');
    if (await fileExists(pnpmWsPath)) {
      try {
        const { readText } = await import('../paths');
        const content = (await readText(pnpmWsPath)) ?? '';
        const matches = content.match(/^\s*-\s*['"]?([^'"\n]+)['"]?\s*$/gm) ?? [];
        for (const m of matches) {
          const pat = m
            .replace(/^\s*-\s*['"]?/, '')
            .replace(/['"]?\s*$/, '')
            .trim();
          if (pat) wsPatterns.push(pat);
        }
      } catch {
        // ignore
      }
    }

    if (wsPatterns.length > 0) {
      const wsPackages = await collectWorkspacePackageNames(projectPath, wsPatterns);
      for (const name of wsPackages) {
        if (!derived.monorepoPackages.includes(name)) derived.monorepoPackages.push(name);
      }
    }
  }

  return { derived };
}

/** 扫描 workspace 包名 */
async function collectWorkspacePackageNames(
  rootPath: string,
  patterns: string[],
): Promise<string[]> {
  const names = new Set<string>();
  for (const pattern of patterns) {
    // 使用 glob 库展开 workspace 模式（如 packages/*）
    const matched = await glob(pattern, { cwd: rootPath, absolute: true, nodir: false });
    for (const dir of matched) {
      if (!(await dirExists(dir))) continue;
      const pkgPath = join(dir, 'package.json');
      if (await fileExists(pkgPath)) {
        const pkg = await readJSON<{ name?: string }>(pkgPath);
        if (pkg?.name) names.add(pkg.name);
      }
    }
  }
  return [...names];
}
