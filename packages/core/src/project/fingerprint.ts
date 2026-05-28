import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { basename, dirname, resolve as pathResolve, sep } from 'node:path';
import type {
  ProjectFingerprintEntry,
  ProjectFingerprint,
  ProjectMatchCandidate,
  ProjectFingerprintRow,
} from '../types';
import { fileExists, readJSON, listDir, dirExists, join } from '../paths';
import {
  upsertFingerprint,
  deleteFingerprintsByProject,
  listFingerprintsByProject,
  findProjectsByFingerprint,
  findProjectsByFingerprintKeyPrefix,
  getProjectById,
  listAllProjects,
} from '../db';

// ─── 评分权重 ───
export const FINGERPRINT_WEIGHTS = {
  git_first_commit: 100,
  git_remote: 90,
  local_path: 70,
  local_path_prefix: 40,
  package_name: 40,
  monorepo_packages: 50,
  local_path_basename: 15,
  key_file_hash: 10,
} as const;

export type FingerprintKey = keyof typeof FINGERPRINT_WEIGHTS;

// ─── 置信度阈值 ───
export const CONFIDENCE_THRESHOLDS = {
  high: 100,
  medium: 70,
} as const;

/** 将 git remote URL 标准化（统一去 .git 后缀，统一 https/ssh 形式） */
export function normalizeGitRemote(remote: string): string {
  let r = remote.trim();
  if (!r) return '';
  // git@github.com:org/repo.git -> github.com/org/repo
  const sshMatch = r.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    r = `${sshMatch[1]}/${sshMatch[2]}`;
  } else {
    // https://github.com/org/repo.git -> github.com/org/repo
    r = r.replace(/^https?:\/\//, '');
    r = r.replace(/\.git$/, '');
  }
  return r.toLowerCase();
}

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

/** 收集项目的多源指纹 */
export async function collectFingerprint(projectPath: string): Promise<{
  entries: ProjectFingerprintEntry[];
  derived: {
    gitFirstCommit?: string;
    gitRemotes: string[];
    gitDefaultBranch?: string;
    packageNames: string[];
    monorepoPackages: string[];
  };
}> {
  const entries: ProjectFingerprintEntry[] = [];
  const derived: {
    gitFirstCommit?: string;
    gitRemotes: string[];
    gitDefaultBranch?: string;
    packageNames: string[];
    monorepoPackages: string[];
  } = { gitRemotes: [], packageNames: [], monorepoPackages: [] };

  const absPath = normalizeLocalPath(projectPath);

  // local_path 强匹配
  entries.push({ key: 'local_path', value: absPath, weight: FINGERPRINT_WEIGHTS.local_path });
  entries.push({
    key: 'local_path_basename',
    value: basename(absPath).toLowerCase(),
    weight: FINGERPRINT_WEIGHTS.local_path_basename,
  });
  // local_path_prefix 索引：最近的 3 级父目录
  let cur = dirname(absPath);
  for (let i = 0; i < 3 && cur && cur !== sep && cur !== '.'; i++) {
    entries.push({
      key: 'local_path_prefix',
      value: cur,
      weight: FINGERPRINT_WEIGHTS.local_path_prefix,
    });
    cur = dirname(cur);
  }

  // git first commit
  try {
    const firstCommit = execSync('git rev-list --max-parents=0 HEAD', {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
      timeout: 3000,
    })
      .trim()
      .split('\n')[0]
      ?.trim();
    if (firstCommit && /^[0-9a-f]{7,}$/i.test(firstCommit)) {
      derived.gitFirstCommit = firstCommit;
      entries.push({
        key: 'git_first_commit',
        value: firstCommit,
        weight: FINGERPRINT_WEIGHTS.git_first_commit,
      });
    }
  } catch {
    // 无 git 或非首次 commit 历史
  }

  // git remotes（所有 remote）
  try {
    const remotesRaw = execSync('git remote', {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
      timeout: 3000,
    })
      .trim()
      .split('\n')
      .filter(Boolean);
    for (const remoteName of remotesRaw) {
      try {
        const url = execSync(`git remote get-url ${remoteName}`, {
          cwd: projectPath,
          stdio: ['pipe', 'pipe', 'pipe'],
          encoding: 'utf-8',
          timeout: 3000,
        }).trim();
        if (url) {
          const normalized = normalizeGitRemote(url);
          if (normalized && !derived.gitRemotes.includes(normalized)) {
            derived.gitRemotes.push(normalized);
            entries.push({
              key: 'git_remote',
              value: normalized,
              weight: FINGERPRINT_WEIGHTS.git_remote,
            });
          }
        }
      } catch {
        // 忽略单个 remote 失败
      }
    }
  } catch {
    // 不是 git 仓库
  }

  // git default branch
  try {
    const headRef = execSync('git symbolic-ref refs/remotes/origin/HEAD', {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();
    const m = headRef.match(/refs\/remotes\/origin\/(.+)$/);
    if (m?.[1]) derived.gitDefaultBranch = m[1];
  } catch {
    // 没有 origin/HEAD
  }
  if (!derived.gitDefaultBranch) {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: projectPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf-8',
        timeout: 3000,
      }).trim();
      if (branch && branch !== 'HEAD') derived.gitDefaultBranch = branch;
    } catch {
      // 忽略
    }
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
      entries.push({
        key: 'package_name',
        value: pkg.name.toLowerCase(),
        weight: FINGERPRINT_WEIGHTS.package_name,
      });
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
      if (derived.monorepoPackages.length > 0) {
        // 把 monorepo packages 集合做成单个指纹值，便于 Jaccard 匹配
        const sorted = [...derived.monorepoPackages].sort();
        entries.push({
          key: 'monorepo_packages',
          value: sorted.join(','),
          weight: FINGERPRINT_WEIGHTS.monorepo_packages,
        });
      }
    }
  }

  return { entries, derived };
}

/** 扫描 workspace 包名 */
async function collectWorkspacePackageNames(
  rootPath: string,
  patterns: string[],
): Promise<string[]> {
  const names = new Set<string>();
  for (const pattern of patterns) {
    // 支持 packages/* 这种简单 glob，及 packages/foo 直接路径
    const expanded = await expandSimpleGlob(rootPath, pattern);
    for (const dir of expanded) {
      const pkgPath = join(dir, 'package.json');
      if (await fileExists(pkgPath)) {
        const pkg = await readJSON<{ name?: string }>(pkgPath);
        if (pkg?.name) names.add(pkg.name);
      }
    }
  }
  return [...names];
}

/** 简易 glob 展开：仅支持单层 * 通配符 */
async function expandSimpleGlob(rootPath: string, pattern: string): Promise<string[]> {
  const cleaned = pattern.replace(/\/+$/, '');
  if (!cleaned.includes('*')) {
    const full = join(rootPath, cleaned);
    return (await dirExists(full)) ? [full] : [];
  }
  // 支持 a/b/*  形式
  const idx = cleaned.indexOf('*');
  const before = cleaned.slice(0, idx).replace(/\/+$/, '');
  const after = cleaned.slice(idx + 1);
  const baseDir = before ? join(rootPath, before) : rootPath;
  if (!(await dirExists(baseDir))) return [];
  const entries = await listDir(baseDir);
  const results: string[] = [];
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const candidate = join(baseDir, entry);
    if (!after) {
      results.push(candidate);
    } else {
      const sub = after.startsWith('/') ? after.slice(1) : after;
      const full = join(candidate, sub);
      if (await dirExists(full)) results.push(full);
    }
  }
  return results;
}

// ─── 写入与查询 ───

/** 把指纹列表持久化到 db（覆盖） */
export function persistFingerprints(projectId: string, entries: ProjectFingerprintEntry[]): void {
  try {
    deleteFingerprintsByProject(projectId);
    for (const entry of entries) {
      upsertFingerprint({
        project_id: projectId,
        key: entry.key,
        value: entry.value,
        weight: entry.weight,
      });
    }
  } catch {
    // db 未初始化时静默
  }
}

export function listFingerprintsForProject(projectId: string): ProjectFingerprintRow[] {
  try {
    return listFingerprintsByProject(projectId);
  } catch {
    return [];
  }
}

/** 按指纹反查项目候选 */
export function findCandidatesByFingerprint(
  collected: ProjectFingerprintEntry[],
): ProjectMatchCandidate[] {
  const scoreMap = new Map<
    string,
    { score: number; evidence: { key: string; value: string; weight: number }[] }
  >();

  for (const entry of collected) {
    let rows: ProjectFingerprintRow[];
    try {
      // 强证据精确匹配
      rows = findProjectsByFingerprint(entry.key, entry.value);
    } catch {
      continue;
    }

    for (const row of rows) {
      const slot = scoreMap.get(row.project_id) ?? { score: 0, evidence: [] };
      slot.score += entry.weight;
      slot.evidence.push({ key: entry.key, value: entry.value, weight: entry.weight });
      scoreMap.set(row.project_id, slot);
    }
  }

  // monorepo_packages: 用 Jaccard 相似度（>=0.5 命中）
  const monoEntry = collected.find((e) => e.key === 'monorepo_packages');
  if (monoEntry) {
    try {
      // 拿所有项目的 monorepo_packages 指纹
      const allMonos = findProjectsByFingerprintKeyPrefix('monorepo_packages', '');
      const collectedSet = new Set(monoEntry.value.split(',').filter(Boolean));
      for (const row of allMonos) {
        if (row.value === monoEntry.value) continue; // 已经精确匹配过
        const otherSet = new Set(row.value.split(',').filter(Boolean));
        const intersection = new Set([...collectedSet].filter((x) => otherSet.has(x)));
        const union = new Set([...collectedSet, ...otherSet]);
        const jaccard = union.size === 0 ? 0 : intersection.size / union.size;
        if (jaccard >= 0.5) {
          const slot = scoreMap.get(row.project_id) ?? { score: 0, evidence: [] };
          slot.score += FINGERPRINT_WEIGHTS.monorepo_packages;
          slot.evidence.push({
            key: 'monorepo_packages',
            value: `Jaccard=${jaccard.toFixed(2)}`,
            weight: FINGERPRINT_WEIGHTS.monorepo_packages,
          });
          scoreMap.set(row.project_id, slot);
        }
      }
    } catch {
      // ignore
    }
  }

  // 转换为候选
  const candidates: ProjectMatchCandidate[] = [];
  for (const [projectId, slot] of scoreMap.entries()) {
    let row;
    try {
      row = getProjectById(projectId);
    } catch {
      row = undefined;
    }
    if (!row) continue;

    const confidence: 'high' | 'medium' | 'low' =
      slot.score >= CONFIDENCE_THRESHOLDS.high
        ? 'high'
        : slot.score >= CONFIDENCE_THRESHOLDS.medium
          ? 'medium'
          : 'low';

    candidates.push({
      projectId,
      projectName: row.name,
      score: slot.score,
      evidence: slot.evidence,
      confidence,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

/** 通过路径反查项目（路径前缀匹配 + 强指纹） */
export async function findProjectByPathSmart(absPath: string): Promise<ProjectMatchCandidate[]> {
  const entries: ProjectFingerprintEntry[] = [];
  const norm = normalizeLocalPath(absPath);

  // 完全路径匹配
  entries.push({ key: 'local_path', value: norm, weight: FINGERPRINT_WEIGHTS.local_path });

  // 父目录前缀
  let cur = norm;
  for (let i = 0; i < 5 && cur && cur !== sep && cur !== '.'; i++) {
    entries.push({
      key: 'local_path_prefix',
      value: cur,
      weight: FINGERPRINT_WEIGHTS.local_path_prefix,
    });
    cur = dirname(cur);
  }

  // basename
  entries.push({
    key: 'local_path_basename',
    value: basename(norm).toLowerCase(),
    weight: FINGERPRINT_WEIGHTS.local_path_basename,
  });

  return findCandidatesByFingerprint(entries);
}

/** 把内存里的 ProjectFingerprintEntry 列表整体打包 */
export function buildFingerprint(
  projectId: string,
  entries: ProjectFingerprintEntry[],
): ProjectFingerprint {
  return {
    projectId,
    entries,
    collectedAt: new Date().toISOString(),
  };
}

// ─── 用于其他工具的辅助函数 ───

/** 计算文件 hash（关键文件用） */
export async function hashFile(filePath: string): Promise<string | null> {
  if (!(await fileExists(filePath))) return null;
  try {
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(filePath);
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

/** 列出所有项目的精简 fingerprint 摘要（doctor 用） */
export function listAllProjectFingerprintSummaries(username?: string): {
  projectId: string;
  count: number;
}[] {
  try {
    const projects = listAllProjects(username);
    return projects.map((p) => ({
      projectId: p.id,
      count: listFingerprintsByProject(p.id).length,
    }));
  } catch {
    return [];
  }
}
