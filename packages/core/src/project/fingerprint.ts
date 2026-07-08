import { resolve as pathResolve, sep } from 'node:path';
import simpleGit from 'simple-git';
import { glob } from 'glob';
import { fileExists, readJSON, readText, dirExists, join } from '../paths';
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

  const git = simpleGit(projectPath);

  // git 命令 + package.json 读取全部并行（复用单个 git 实例）
  const [firstCommit, remotes, defaultBranch, pkg] = await Promise.all([
    // git first commit
    (async (): Promise<string | undefined> => {
      try {
        const rootCommits = await git.raw(['rev-list', '--max-parents=0', 'HEAD']);
        const rootSha = rootCommits.trim().split('\n')[0]?.trim();
        return rootSha && /^[0-9a-f]{7,}$/i.test(rootSha) ? rootSha : undefined;
      } catch {
        return undefined;
      }
    })(),
    // git remotes
    (async () => {
      try {
        return await git.getRemotes(true);
      } catch {
        return undefined;
      }
    })(),
    // git default branch（内部有 fallback，串行）
    (async (): Promise<string | undefined> => {
      try {
        const headRef = await git.raw(['symbolic-ref', 'refs/remotes/origin/HEAD']);
        const m = headRef.trim().match(/refs\/remotes\/origin\/(.+)$/);
        if (m?.[1]) return m[1];
      } catch {
        // 没有 origin/HEAD
      }
      try {
        const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
        const trimmed = branch.trim();
        if (trimmed && trimmed !== 'HEAD') return trimmed;
      } catch {
        // 忽略
      }
      return undefined;
    })(),
    // package.json 读取
    (async () => {
      const pkgPath = join(projectPath, 'package.json');
      if (!(await fileExists(pkgPath))) return null;
      return readJSON<{ name?: string; workspaces?: string[] | { packages?: string[] } }>(pkgPath);
    })(),
  ]);

  // first commit
  if (firstCommit) derived.gitFirstCommit = firstCommit;

  // remotes
  if (remotes) {
    for (const remote of remotes) {
      const url = remote.refs?.fetch || remote.refs?.push;
      if (url) {
        const normalized = normalizeGitRemote(url);
        if (normalized && !derived.gitRemotes.includes(normalized)) {
          derived.gitRemotes.push(normalized);
        }
      }
    }
  }

  // default branch
  if (defaultBranch) derived.gitDefaultBranch = defaultBranch;

  // package.json name + monorepo workspaces 扫描
  if (pkg?.name) {
    derived.packageNames.push(pkg.name);
  }

  if (pkg) {
    const wsPatterns: string[] = [];
    if (Array.isArray(pkg.workspaces)) {
      wsPatterns.push(...(pkg.workspaces as string[]));
    } else if (
      pkg.workspaces &&
      typeof pkg.workspaces === 'object' &&
      Array.isArray((pkg.workspaces as { packages?: string[] }).packages)
    ) {
      wsPatterns.push(...(pkg.workspaces as { packages: string[] }).packages);
    }
    // pnpm-workspace.yaml
    const pnpmWsPath = join(projectPath, 'pnpm-workspace.yaml');
    if (await fileExists(pnpmWsPath)) {
      try {
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
  // 所有 pattern 的 glob 并行
  const matchedPerPattern = await Promise.all(
    patterns.map((pattern) => glob(pattern, { cwd: rootPath, absolute: true, nodir: false })),
  );
  const allDirs = matchedPerPattern.flat();

  // 所有目录的 package.json 读取并行
  const pkgResults = await Promise.all(
    allDirs.map(async (dir) => {
      if (!(await dirExists(dir))) return null;
      const pkgPath = join(dir, 'package.json');
      if (!(await fileExists(pkgPath))) return null;
      return readJSON<{ name?: string }>(pkgPath);
    }),
  );

  const names = new Set<string>();
  for (const pkg of pkgResults) {
    if (pkg?.name) names.add(pkg.name);
  }
  return [...names];
}
