import { join, relative } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { minimatch } from 'minimatch';
import type { ProjectMeta } from '../types';
import { listProjectMetas } from '../project';
import { listTasks } from '../task';
import { getUserSpecs, getGlobalSpecs } from '../spec';
import { getUserProjectsDir, getUserTasksDir, getUserSpecDir, getGlobalSpecDir } from '../paths';
import { parseRoutes } from './domain-config';

/**
 * 贡献集计算（push 白名单侧，F2 红线）。
 *
 * 贡献集只允许四类内容（顶层类型白名单）：
 *   users/<me>/projects/<contractId>/  · users/<me>/tasks/<taskId>/  ·
 *   users/<me>/spec/<rel>              · spec/<rel>（全局）
 * routes 决定每类内容的命中子集；"*" = 全量。绝不匹配白名单外的路径。
 *
 * 镜像内项目目录名 = 契约 ID 规范化（D19：衍生 id git: > remote:，
 * 冒号编码为 `--` 保证跨平台文件名安全）。
 */

/** 从项目 ids 推导契约 ID：git: 优先、remote: 兜底；无衍生 ID 返回 null（不入贡献集） */
export function deriveContractId(ids: string[]): string | null {
  const git = ids.find((id) => id.startsWith('git:'));
  if (git) return git;
  const remote = ids.find((id) => id.startsWith('remote:'));
  return remote ?? null;
}

/** 契约 ID → 镜像目录名：冒号编码为双连字符（git:abc → git--abc），跨平台安全 */
export function encodeContractDirName(contractId: string): string {
  return contractId.replace(/:/g, '--');
}

/** 镜像目录名 → 契约 ID（对称解码） */
export function decodeContractDirName(dirName: string): string {
  return dirName.replace(/--/g, ':');
}

export interface ContributionFile {
  /** 主数据绝对路径 */
  src: string;
  /** 镜像内相对路径（POSIX 风格） */
  destRel: string;
}

export interface ContributionPlan {
  files: ContributionFile[];
  /** 项目贡献明细（诊断/测试用） */
  projects: Array<{ contractId: string; mirrorDirName: string; taskIds: string[] }>;
  /** 是否为空集（无 routes 或无命中） */
  empty: boolean;
}

/** 递归收集目录下全部文件相对路径（POSIX 风格；跳过点开头条目） */
export async function walkFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      for (const rel of await walkFiles(full)) out.push(`${e.name}/${rel}`);
    } else if (e.isFile()) {
      out.push(e.name);
    }
  }
  return out;
}

function globMatchAny(value: string, globs: string[]): boolean {
  // 否定模式：! 前缀 glob 排除（minimatch 的 ! 在 some 逻辑下不生效，需独立处理）
  const positive = globs.filter((g) => !g.startsWith('!'));
  const negative = globs.filter((g) => g.startsWith('!')).map((g) => g.slice(1));
  return (
    positive.some((g) => minimatch(value, g, { nocase: true })) &&
    !negative.some((g) => minimatch(value, g, { nocase: true }))
  );
}

/** 计算某用户的域贡献集（文件级复制清单） */
/** dry-run 预览：给定 routes 会推送什么（不实际推送，保存前提示用） */
export async function previewContribution(
  username: string,
  routes: string[] | undefined,
  baselinePaths: string[] = [],
): Promise<{
  copied: number;
  removed: number;
  copiedFiles: string[];
  removedFiles: string[];
}> {
  const plan = await computeContribution(username, routes);
  const planPaths = new Set(plan.files.map((f) => f.destRel));
  const removedFiles = baselinePaths.filter((p) => !planPaths.has(p));
  return {
    copied: plan.files.length,
    removed: removedFiles.length,
    copiedFiles: plan.files.map((f) => f.destRel).slice(0, 50),
    removedFiles: removedFiles.slice(0, 50),
  };
}

export async function computeContribution(
  username: string,
  routes: string[] | undefined,
): Promise<ContributionPlan> {
  const parsed = parseRoutes(routes);
  const files: ContributionFile[] = [];
  const projectsOut: ContributionPlan['projects'] = [];

  // ── 项目目录（含项目 spec/profile/project.json） ──
  const metas = await listProjectMetas(username);
  const contractByIds = new Map<string, ProjectMeta & { contractId: string }>();
  const hitProjects: Array<ProjectMeta & { contractId: string }> = [];

  for (const meta of metas) {
    const contractId = deriveContractId(meta.ids ?? []);
    if (!contractId) continue; // 无衍生 ID 的项目不入域
    const enriched = { ...meta, contractId };
    contractByIds.set(contractId, enriched);
    for (const id of meta.ids ?? []) contractByIds.set(id, enriched);

    const matchTargets = [...(meta.ids ?? []), meta.name ?? ''];
    const hit = parsed.matchAll || matchTargets.some((t) => globMatchAny(t, parsed.projectGlobs));
    if (hit) hitProjects.push(enriched);
  }

  const hitContractIds = new Set(hitProjects.map((p) => p.contractId));

  // ── 任务目录（matchAll=全部；selective=关联命中项目的任务） ──
  const tasks = await listTasks(username);
  const taskIds = tasks
    .filter((t) => {
      if (parsed.matchAll) return true;
      return (t.projects ?? []).some((pid) => {
        const p = contractByIds.get(pid) ?? contractByIds.get(`legacy:${pid}`);
        return p !== undefined && hitContractIds.has(p.contractId);
      });
    })
    .map((t) => t.id);

  // ── 用户级 / 全局 spec ──
  const userSpecs = parsed.matchAll ? await getUserSpecs(username) : [];
  const globalSpecs = parsed.matchAll ? await getGlobalSpecs() : [];

  // ── 展开为文件级清单 ──
  const projectsDir = getUserProjectsDir(username);
  for (const p of hitProjects) {
    const dirName = encodeContractDirName(p.contractId);
    // 项目元数据目录名在主数据可能是任意 id 形态，按 project.json 所在目录取真实目录
    const srcDir = await findProjectSourceDir(projectsDir, p);
    if (!srcDir) continue;
    const dirBase = relative(projectsDir, srcDir);
    for (const rel of await walkFiles(srcDir)) {
      files.push({
        src: join(srcDir, rel),
        destRel: toPosix(`users/${username}/projects/${dirName}/${rel}`),
      });
    }
    void dirBase;
    projectsOut.push({
      contractId: p.contractId,
      mirrorDirName: dirName,
      taskIds: taskIds.filter((tid) => {
        const t = tasks.find((x) => x.id === tid);
        return (t?.projects ?? []).some((pid) => {
          const pm = contractByIds.get(pid) ?? contractByIds.get(`legacy:${pid}`);
          return pm?.contractId === p.contractId;
        });
      }),
    });
  }

  if (!parsed.matchAll) {
    const userSpecDir = getUserSpecDir(username);
    const specs = await getUserSpecs(username);
    for (const s of specs) {
      if (globMatchAny(s.relativePath, parsed.userSpecGlobs)) {
        files.push({
          src: s.filePath,
          destRel: toPosix(`users/${username}/spec/${s.relativePath}`),
        });
      }
    }
    void userSpecDir;
    const globals = await getGlobalSpecs();
    for (const s of globals) {
      if (globMatchAny(s.relativePath, parsed.globalSpecGlobs)) {
        files.push({ src: s.filePath, destRel: toPosix(`spec/${s.relativePath}`) });
      }
    }
  } else {
    for (const s of userSpecs) {
      files.push({ src: s.filePath, destRel: toPosix(`users/${username}/spec/${s.relativePath}`) });
    }
    for (const s of globalSpecs) {
      files.push({ src: s.filePath, destRel: toPosix(`spec/${s.relativePath}`) });
    }
  }

  const tasksDir = getUserTasksDir(username);
  for (const tid of taskIds) {
    const srcDir = join(tasksDir, tid);
    for (const rel of await walkFiles(srcDir)) {
      files.push({
        src: join(srcDir, rel),
        destRel: toPosix(`users/${username}/tasks/${tid}/${rel}`),
      });
    }
  }

  return { files, projects: projectsOut, empty: files.length === 0 };
}

/** 定位项目元数据在主数据的物理目录（project.json 真源目录） */
async function findProjectSourceDir(
  projectsDir: string,
  meta: ProjectMeta & { contractId: string },
): Promise<string | null> {
  const entries = await readdir(projectsDir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const dir = join(projectsDir, e.name);
    const metaPath = join(dir, 'project.json');
    try {
      const raw = await stat(metaPath);
      if (!raw.isFile()) continue;
      const { readJSON } = await import('../paths');
      const disk = await readJSON<{ ids?: string[]; id?: string }>(metaPath);
      const ids = disk?.ids ?? (disk?.id ? [disk.id] : []);
      if (ids.some((id) => id === meta.contractId || (meta.ids ?? []).includes(id))) return dir;
    } catch {
      // 忽略不可读目录
    }
  }
  return null;
}

function toPosix(p: string): string {
  return p.split('\\').join('/');
}
