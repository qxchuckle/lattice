import type { TaskMeta, ReferencedSpec, ParsedSpec } from '../types';
import { getTaskMeta } from './index';
import { writeJSON } from '../paths';
import { getTaskMetaPath } from '../paths';
import { writeSpec, normalizeSpecFrontmatter, formatSpecParseError } from '../spec/io';
import { isValidSpecId } from '../spec/id';
import { findSpecByName, findSpecById } from '../spec/query';
import { nowISO } from '../utils/time';

export interface RefSpecResult {
  added: string[];
  skipped: string[];
  errors: string[];
}

/**
 * 为任务添加 spec 引用。
 *
 * 逻辑：
 * 1. 解析 spec（支持文件路径、spec 名称、或 spec-id）
 * 2. 如果 spec 缺 id，自动 backfill（自愈式 backfill 触发点之一）
 * 3. 去重后写入 task.json.referencedSpecs
 */
export async function addSpecRefs(
  username: string,
  taskId: string,
  specInputs: string[],
  opts?: { projectId?: string | null },
): Promise<RefSpecResult> {
  const task = await getTaskMeta(username, taskId);
  if (!task) throw new Error(`未找到任务：${taskId}`);

  const refs: ReferencedSpec[] = [...(task.referencedSpecs ?? [])];
  const existingIds = new Set(refs.map((r) => r.id));
  const added: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  for (const input of specInputs) {
    try {
      const resolved = await resolveSpecInput(username, input, opts?.projectId ?? null);
      if (!resolved) {
        errors.push(`未找到 spec：${input}`);
        continue;
      }
      if (existingIds.has(resolved.id)) {
        skipped.push(resolved.id);
        continue;
      }
      refs.push({
        id: resolved.id,
        relativePath: resolved.relativePath,
        scope: resolved.scope,
        ...(resolved.projectId ? { projectId: resolved.projectId } : {}),
        firstReadAt: nowISO(),
      });
      existingIds.add(resolved.id);
      added.push(resolved.id);
    } catch (e) {
      errors.push(`处理 ${input} 时出错：${(e as Error).message}`);
    }
  }

  if (added.length > 0) {
    const updated: TaskMeta = {
      ...task,
      referencedSpecs: refs,
      updated: nowISO(),
    };
    await writeJSON(getTaskMetaPath(username, taskId), updated);
  }

  return { added, skipped, errors };
}

/**
 * 从任务移除 spec 引用。
 */
export async function removeSpecRefs(
  username: string,
  taskId: string,
  specIds: string[],
): Promise<{ removed: string[]; notFound: string[] }> {
  const task = await getTaskMeta(username, taskId);
  if (!task) throw new Error(`未找到任务：${taskId}`);

  const refs = task.referencedSpecs ?? [];
  const removeSet = new Set(specIds);
  const removed: string[] = [];
  const notFound: string[] = [];

  for (const id of specIds) {
    if (refs.some((r) => r.id === id)) {
      removed.push(id);
    } else {
      notFound.push(id);
    }
  }

  if (removed.length > 0) {
    const updated: TaskMeta = {
      ...task,
      referencedSpecs: refs.filter((r) => !removeSet.has(r.id)),
      updated: nowISO(),
    };
    await writeJSON(getTaskMetaPath(username, taskId), updated);
  }

  return { removed, notFound };
}

// ─── 内部辅助 ───

interface ResolvedSpecInput {
  id: string;
  relativePath: string;
  scope: 'global' | 'user' | 'project';
  /** project 级 spec 的归属项目 ID（跨项目引用可精确定位；其他 scope 或旧数据为 undefined） */
  projectId?: string;
}

/**
 * 解析 spec 输入：
 * - 合法 spec-id 格式（推荐）→ 走 findSpecById，跨 global/user/全部项目按 frontmatter.id 精确查找
 * - ID 未命中或非 ID → 回退 findSpecByName（文件名/路径片段/标题/glob，限 cwd 项目 + user + global）
 *
 * 如果 spec 文件缺 id，触发自愈式 backfill（自动写入 id 并保存）。
 */
async function resolveSpecInput(
  username: string,
  input: string,
  projectId: string | null,
): Promise<ResolvedSpecInput | null> {
  // ID 优先分支：合法 spec-id → 跨全部层级与全部项目精确查找（支持跨项目的项目级 spec）
  if (isValidSpecId(input)) {
    const byId = await findSpecById(username, input, { preferProjectId: projectId });
    if (byId) return await finalizeResolvedSpec(byId.spec, byId.scope, byId.projectId);
    // ID 未命中 → 落到下方名称解析（容错）
  }

  // 名称/路径解析：findSpecByName（既支持文件名也支持路径片段）
  const matches = await findSpecByName(username, projectId, input);
  if (matches.length === 0) return null;

  // 多个不同 spec 命中时拒绝静默猜测，要求用户精确指定
  const uniquePaths = new Set(matches.map((m) => m.spec.relativePath));
  if (uniquePaths.size > 1) {
    const candidates = matches.map((m) => `[${m.scope}] ${m.spec.relativePath}`).join(', ');
    throw new Error(
      `"${input}" 匹配到 ${matches.length} 个不同 spec（${candidates}），请使用更精确的名称或改用 spec ID`,
    );
  }

  const match = matches[0]; // 同 spec 跨层级时取最高优先级
  return await finalizeResolvedSpec(match.spec, match.scope as ResolvedSpecInput['scope']);
}

/**
 * 校验并归一命中的 spec，产出 ReferencedSpec 所需字段。
 *
 * - 坏 frontmatter（parseError）：拒绝自愈 backfill（writeSpec 会重建 frontmatter，原内容将丢失），抛带定位错误
 * - 缺合法 id：自愈式 backfill（写入新 id 并保存）
 */
async function finalizeResolvedSpec(
  spec: ParsedSpec,
  scope: ResolvedSpecInput['scope'],
  projectId?: string,
): Promise<ResolvedSpecInput> {
  if (spec.parseError) {
    throw new Error(
      `spec ${spec.relativePath} frontmatter YAML 解析失败（${formatSpecParseError(spec.parseError)}），请先修复语法错误后再引用`,
    );
  }

  let specId = spec.frontmatter.id;

  // 自愈式 backfill：如果 spec 缺少合法 id，自动补上
  if (!isValidSpecId(specId)) {
    const fm = normalizeSpecFrontmatter(spec.frontmatter);
    await writeSpec(spec.filePath, fm, spec.content);
    specId = fm.id as string;
  }

  return {
    id: specId!,
    relativePath: spec.relativePath,
    scope,
    projectId,
  };
}
