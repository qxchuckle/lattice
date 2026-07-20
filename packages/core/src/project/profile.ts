/**
 * 项目画像模块 — 管理 profile/ 目录下的 summary.md、tags.json、cache.json
 */
import { createHash } from 'node:crypto';
import simpleGit from 'simple-git';
import type { ProjectMeta } from '../types';
import {
  getProjectProfileDir,
  getProjectProfileSummaryPath,
  getProjectProfileTagsPath,
  getProjectProfileCachePath,
  readJSON,
  writeJSON,
  ensureDir,
  fileExists,
  readText,
  writeText,
} from '../paths';
import { getTasksForProject } from '../db';
import { getTaskMeta } from '../task';
import { getProjectSpecs } from '../spec';
import { getRelationsByProject } from './relation';
import { listProjects, getProjectMeta, updateProjectMeta } from './index';
import { nowISO } from '../utils/time';

// ─── 类型 ───

export interface ProfileCacheDetail {
  git: {
    headSha: string | null;
    commitCount: number | null;
  } | null;
  tasks: {
    count: number;
    idsSnapshot: string[];
  };
  specs: {
    count: number;
    titlesSnapshot: string[];
  };
  relations: {
    count: number;
  };
  projectMetaUpdated: string | null;
}

export interface ProfileCache {
  generatedAt: string;
  schemaVersion: number;
  inputsHash: string;
  detail: ProfileCacheDetail;
}

export interface ProfileCheckResultItem {
  id: string;
  name: string;
  status: 'stale' | 'fresh' | 'no-profile' | 'warning';
  reasons: string[];
}

export interface ProfileCheckResult {
  stale: ProfileCheckResultItem[];
  fresh: number;
  noProfile: ProfileCheckResultItem[];
  warnings: ProfileCheckResultItem[];
}

const SCHEMA_VERSION = 1;

// ─── 路径解析 ───

/**
 * 获取项目 profile 目录路径（同步版本，需要已知 dirName）
 */
export function getProfileDirPath(username: string, projectDirName: string): string {
  return getProjectProfileDir(username, projectDirName);
}

// ─── Tags 管理 ───

export async function readProfileTags(username: string, projectDirName: string): Promise<string[]> {
  const tagsPath = getProjectProfileTagsPath(username, projectDirName);
  const data = await readJSON<string[]>(tagsPath);
  return Array.isArray(data) ? data : [];
}

export async function writeProfileTags(
  username: string,
  projectDirName: string,
  tags: string[],
): Promise<void> {
  const tagsPath = getProjectProfileTagsPath(username, projectDirName);
  await ensureDir(getProjectProfileDir(username, projectDirName));
  await writeJSON(tagsPath, tags);
}

export async function addProfileTags(
  username: string,
  projectDirName: string,
  newTags: string[],
): Promise<string[]> {
  const existing = await readProfileTags(username, projectDirName);
  const merged = [...new Set([...existing, ...newTags])];
  await writeProfileTags(username, projectDirName, merged);
  return merged;
}

export async function removeProfileTags(
  username: string,
  projectDirName: string,
  tagsToRemove: string[],
): Promise<string[]> {
  const existing = await readProfileTags(username, projectDirName);
  const removeSet = new Set(tagsToRemove);
  const result = existing.filter((t) => !removeSet.has(t));
  await writeProfileTags(username, projectDirName, result);
  return result;
}

// ─── Summary 管理 ───

export async function readProfileSummary(
  username: string,
  projectDirName: string,
): Promise<string | null> {
  const summaryPath = getProjectProfileSummaryPath(username, projectDirName);
  return readText(summaryPath);
}

export async function writeProfileSummary(
  username: string,
  projectDirName: string,
  content: string,
): Promise<void> {
  const summaryPath = getProjectProfileSummaryPath(username, projectDirName);
  await ensureDir(getProjectProfileDir(username, projectDirName));
  await writeText(summaryPath, content);
}

// ─── Cache 管理 ───

export async function readProfileCache(
  username: string,
  projectDirName: string,
): Promise<ProfileCache | null> {
  const cachePath = getProjectProfileCachePath(username, projectDirName);
  return readJSON<ProfileCache>(cachePath);
}

// ─── 输入采集与 Hash 计算 ───

interface ProfileInputs {
  git: { headSha: string | null; commitCount: number | null } | null;
  taskIds: string[];
  taskTitles: string[];
  specFileNames: string[];
  specTitles: string[];
  relationCount: number;
  relationProjectIds: string[];
  projectMetaUpdated: string | null;
}

/**
 * 采集项目当前输入源状态
 */
export async function collectProfileInputs(
  username: string,
  projectId: string,
  projectDirName: string,
): Promise<ProfileInputs> {
  // Git 状态
  let git: ProfileInputs['git'] = null;
  const meta = await getProjectMeta(username, projectId);
  if (meta?.localPaths?.length) {
    const localPath = meta.localPaths[0];
    try {
      const gitInstance = simpleGit(localPath);
      const isRepo = await gitInstance.checkIsRepo();
      if (isRepo) {
        const headSha = await gitInstance.revparse(['HEAD']);
        const countResult = await gitInstance.revparse(['--count', 'HEAD']);
        git = { headSha: headSha.trim(), commitCount: parseInt(countResult.trim(), 10) || null };
      }
    } catch {
      // 非 git 仓库或路径不存在
    }
  }

  // 任务
  const taskIds = getTasksForProject(projectId);
  const taskTitles: string[] = [];
  for (const tid of taskIds) {
    const taskMeta = await getTaskMeta(username, tid);
    if (taskMeta) taskTitles.push(taskMeta.title);
  }

  // Spec
  const specs = await getProjectSpecs(username, projectId);
  const specFileNames = specs.map((s) => s.fileName).sort();
  const specTitles = specs.map((s) => s.frontmatter.title ?? s.fileName).sort();

  // 关系
  let relationCount = 0;
  let relationProjectIds: string[] = [];
  try {
    const relations = await getRelationsByProject(username, projectId);
    relationCount = relations.length;
    relationProjectIds = relations
      .map((r) => (r.projectA === projectId ? r.projectB : r.projectA))
      .sort();
  } catch {
    // ignore
  }

  return {
    git,
    taskIds: [...taskIds].sort(),
    taskTitles: taskTitles.sort(),
    specFileNames,
    specTitles,
    relationCount,
    relationProjectIds,
    projectMetaUpdated: meta?.updated ?? null,
  };
}

/**
 * 计算 inputsHash
 */
export function computeInputsHash(inputs: ProfileInputs): string {
  const parts: string[] = [];

  if (inputs.git) {
    parts.push(`git:${inputs.git.headSha}:${inputs.git.commitCount}`);
  }
  parts.push(`tasks:${inputs.taskIds.join(',')}:${inputs.taskTitles.join('|')}`);
  parts.push(`specs:${inputs.specFileNames.join(',')}:${inputs.specTitles.join('|')}`);
  parts.push(`relations:${inputs.relationCount}:${inputs.relationProjectIds.join(',')}`);
  parts.push(`meta:${inputs.projectMetaUpdated ?? ''}`);

  const hash = createHash('sha256').update(parts.join('\n')).digest('hex');
  return `sha256:${hash.slice(0, 16)}`;
}

/**
 * 从 inputs 构建 detail 快照
 */
function buildDetail(inputs: ProfileInputs): ProfileCacheDetail {
  return {
    git: inputs.git,
    tasks: {
      count: inputs.taskIds.length,
      idsSnapshot: inputs.taskIds,
    },
    specs: {
      count: inputs.specFileNames.length,
      titlesSnapshot: inputs.specTitles,
    },
    relations: {
      count: inputs.relationCount,
    },
    projectMetaUpdated: inputs.projectMetaUpdated,
  };
}

// ─── Check 逻辑 ───

/**
 * 对比新旧 detail，生成变化原因列表
 */
function diffDetails(oldDetail: ProfileCacheDetail, newDetail: ProfileCacheDetail): string[] {
  const reasons: string[] = [];

  // Git
  if (oldDetail.git && newDetail.git) {
    if (oldDetail.git.headSha !== newDetail.git.headSha) {
      const oldCount = oldDetail.git.commitCount ?? 0;
      const newCount = newDetail.git.commitCount ?? 0;
      const diff = newCount - oldCount;
      reasons.push(diff > 0 ? `新提交 ${diff} 条` : '提交历史变化');
    }
  } else if (!oldDetail.git && newDetail.git) {
    reasons.push('新增 git 仓库');
  }

  // Tasks
  if (oldDetail.tasks.count !== newDetail.tasks.count) {
    const diff = newDetail.tasks.count - oldDetail.tasks.count;
    reasons.push(diff > 0 ? `新增任务 ${diff} 个` : `减少任务 ${Math.abs(diff)} 个`);
  } else {
    const oldSet = new Set(oldDetail.tasks.idsSnapshot);
    const newSet = new Set(newDetail.tasks.idsSnapshot);
    const added = newDetail.tasks.idsSnapshot.filter((id) => !oldSet.has(id));
    const removed = oldDetail.tasks.idsSnapshot.filter((id) => !newSet.has(id));
    if (added.length > 0 || removed.length > 0) {
      reasons.push('任务变更');
    }
  }

  // Specs
  if (oldDetail.specs.count !== newDetail.specs.count) {
    const diff = newDetail.specs.count - oldDetail.specs.count;
    reasons.push(diff > 0 ? `新增 spec ${diff} 个` : `减少 spec ${Math.abs(diff)} 个`);
  } else {
    const oldTitles = oldDetail.specs.titlesSnapshot.join('|');
    const newTitles = newDetail.specs.titlesSnapshot.join('|');
    if (oldTitles !== newTitles) {
      reasons.push('spec 标题变化');
    }
  }

  // Relations
  if (oldDetail.relations.count !== newDetail.relations.count) {
    reasons.push('项目关系变化');
  }

  // Meta
  if (oldDetail.projectMetaUpdated !== newDetail.projectMetaUpdated) {
    reasons.push('项目元数据更新');
  }

  return reasons.length > 0 ? reasons : ['输入源变化'];
}

/**
 * 检查所有项目的画像状态
 */
export async function checkProfiles(username: string): Promise<ProfileCheckResult> {
  const projects = listProjects(username);
  const result: ProfileCheckResult = { stale: [], fresh: 0, noProfile: [], warnings: [] };

  for (const project of projects) {
    const dirName = project.id;
    const cachePath = getProjectProfileCachePath(username, dirName);
    const summaryPath = getProjectProfileSummaryPath(username, dirName);

    // 无画像
    const hasCache = await fileExists(cachePath);
    const hasSummary = await fileExists(summaryPath);
    if (!hasCache || !hasSummary) {
      result.noProfile.push({
        id: project.id,
        name: project.name,
        status: 'no-profile',
        reasons: ['未生成画像'],
      });
      continue;
    }

    // 有画像，检查是否过期
    const cache = await readProfileCache(username, dirName);
    if (!cache || cache.schemaVersion !== SCHEMA_VERSION) {
      result.stale.push({
        id: project.id,
        name: project.name,
        status: 'stale',
        reasons: ['画像版本过期'],
      });
      continue;
    }

    // 采集当前输入
    const inputs = await collectProfileInputs(username, project.id, dirName);
    const currentHash = computeInputsHash(inputs);

    if (currentHash === cache.inputsHash) {
      result.fresh++;
    } else {
      const newDetail = buildDetail(inputs);
      const reasons = diffDetails(cache.detail, newDetail);
      result.stale.push({
        id: project.id,
        name: project.name,
        status: 'stale',
        reasons,
      });
    }
  }

  return result;
}

/**
 * 检查单个项目的画像状态
 */
export async function checkSingleProfile(
  username: string,
  projectDirName: string,
  projectId: string,
  projectName: string,
): Promise<ProfileCheckResultItem> {
  const cachePath = getProjectProfileCachePath(username, projectDirName);
  const summaryPath = getProjectProfileSummaryPath(username, projectDirName);

  const hasCache = await fileExists(cachePath);
  const hasSummary = await fileExists(summaryPath);
  if (!hasCache || !hasSummary) {
    return { id: projectId, name: projectName, status: 'no-profile', reasons: ['未生成画像'] };
  }

  const cache = await readProfileCache(username, projectDirName);
  if (!cache || cache.schemaVersion !== SCHEMA_VERSION) {
    return { id: projectId, name: projectName, status: 'stale', reasons: ['画像版本过期'] };
  }

  const inputs = await collectProfileInputs(username, projectId, projectDirName);
  const currentHash = computeInputsHash(inputs);

  if (currentHash === cache.inputsHash) {
    return { id: projectId, name: projectName, status: 'fresh', reasons: [] };
  }

  const newDetail = buildDetail(inputs);
  const reasons = diffDetails(cache.detail, newDetail);
  return { id: projectId, name: projectName, status: 'stale', reasons };
}

// ─── Done 逻辑 ───

/**
 * 标记画像生成完成：采集当前状态写入 cache.json + 同步 project.json profileUpdated + 触发 rag update
 */
export async function markProfileDone(
  username: string,
  projectDirName: string,
  projectId: string,
): Promise<void> {
  // 采集当前输入
  const inputs = await collectProfileInputs(username, projectId, projectDirName);
  const hash = computeInputsHash(inputs);
  const detail = buildDetail(inputs);

  const cache: ProfileCache = {
    generatedAt: nowISO(),
    schemaVersion: SCHEMA_VERSION,
    inputsHash: hash,
    detail,
  };

  // 写入 cache.json
  await ensureDir(getProjectProfileDir(username, projectDirName));
  await writeJSON(getProjectProfileCachePath(username, projectDirName), cache);

  // 同步 project.json profileUpdated
  await updateProjectMeta(username, projectId, { profileUpdated: nowISO() });
}

// ─── 综合查询 ───

export interface ProfileShowResult {
  summary: string | null;
  tags: string[];
  cache: ProfileCache | null;
  profileDir: string;
  summaryPath: string;
  tagsPath: string;
}

/**
 * 获取项目画像完整信息
 */
export async function getProfileShow(
  username: string,
  projectDirName: string,
): Promise<ProfileShowResult> {
  const profileDir = getProjectProfileDir(username, projectDirName);
  return {
    summary: await readProfileSummary(username, projectDirName),
    tags: await readProfileTags(username, projectDirName),
    cache: await readProfileCache(username, projectDirName),
    profileDir,
    summaryPath: getProjectProfileSummaryPath(username, projectDirName),
    tagsPath: getProjectProfileTagsPath(username, projectDirName),
  };
}

/**
 * 构建 context 输出的画像段（Markdown 格式）
 * 返回 null 表示无画像
 */
export async function buildProfileSection(
  username: string,
  projectDirName: string,
): Promise<string | null> {
  const summary = await readProfileSummary(username, projectDirName);
  if (!summary) return null;
  const tags = await readProfileTags(username, projectDirName);

  const lines: string[] = ['## 项目画像\n'];
  if (tags.length > 0) {
    lines.push(`标签：${tags.join(', ')}\n`);
  }
  lines.push(summary);
  return lines.join('\n');
}

// ─── Brief（聚合信息） ───

export interface ProfileBriefSpec {
  fileName: string;
  title: string;
  description: string;
}

export interface ProfileBriefTask {
  id: string;
  title: string;
  status: string;
}

export interface ProfileBriefRelation {
  projectName: string;
  type: string;
  description?: string;
}

export interface ProfileBrief {
  project: {
    id: string;
    name: string;
    description?: string;
    localPaths: string[];
    gitRemotes?: string[];
    packageNames?: string[];
    monorepoPackages?: string[];
    groups?: string[];
  };
  profileDir: string;
  summary: string | null;
  tags: string[];
  specs: ProfileBriefSpec[];
  tasks: ProfileBriefTask[];
  relations: ProfileBriefRelation[];
}

/**
 * 一次性获取项目画像所需的所有 lattice 内部信息
 */
export async function getProfileBrief(
  username: string,
  projectId: string,
  projectDirName: string,
): Promise<ProfileBrief | null> {
  const meta = await getProjectMeta(username, projectId);
  if (!meta) return null;

  // 已有画像
  const summary = await readProfileSummary(username, projectDirName);
  const tags = await readProfileTags(username, projectDirName);

  // Spec 清单
  const specs = await getProjectSpecs(username, projectId);
  const specList: ProfileBriefSpec[] = specs.map((s) => ({
    fileName: s.fileName,
    title: s.frontmatter.title ?? s.fileName.replace('.md', ''),
    description: typeof s.frontmatter.description === 'string' ? s.frontmatter.description : '',
  }));

  // 任务清单
  const taskIds = getTasksForProject(projectId);
  const taskList: ProfileBriefTask[] = [];
  for (const tid of taskIds) {
    const taskMeta = await getTaskMeta(username, tid);
    if (taskMeta) {
      taskList.push({ id: taskMeta.id, title: taskMeta.title, status: taskMeta.status });
    }
  }

  // 关系
  const relationList: ProfileBriefRelation[] = [];
  try {
    const relations = await getRelationsByProject(username, projectId);
    for (const r of relations) {
      const relatedId = r.projectA === projectId ? r.projectB : r.projectA;
      const relatedMeta = await getProjectMeta(username, relatedId);
      relationList.push({
        projectName: relatedMeta?.name ?? relatedId,
        type: r.type,
        description: r.description,
      });
    }
  } catch {
    // ignore
  }

  return {
    project: {
      id: projectId,
      name: meta.name,
      description: meta.description,
      localPaths: meta.localPaths ?? [],
      gitRemotes: meta.gitRemotes,
      packageNames: meta.packageNames,
      monorepoPackages: meta.monorepoPackages,
      groups: meta.groups,
    },
    profileDir: getProjectProfileDir(username, projectDirName),
    summary,
    tags,
    specs: specList,
    tasks: taskList,
    relations: relationList,
  };
}
