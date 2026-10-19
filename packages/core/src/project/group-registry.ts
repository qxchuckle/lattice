/**
 * 项目分组注册表 — 读写 / CRUD / 路径解析
 *
 * 真源：~/.lattice/users/<u>/project-groups.json
 * 结构：{ version: 1, groups: GroupNode[] }（扁平列表 + parentId，见 GroupRegistry）
 * 纯操作（*InRegistry 系列，直接变更传入的 registry）与 IO 分离，
 * doctor 迁移等批量场景可复用纯操作、只落盘一次。
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getProjectGroupsFilePath, readJSON, writeJSON } from '../paths';
import type { GroupNode, GroupRegistry } from '../types';
import {
  collectSubtreeIds,
  groupPathMap,
  normalizeGroupPathSegments,
  resolveGroupPath,
  validateGroupName,
} from './group-tree';

/** 分组 ID 前缀 */
export const GROUP_ID_PREFIX = 'grp-';

/** 8 位 ID 主体长度（base36） */
const ID_BODY_LENGTH = 8;

/** 分组 ID 完整格式正则：grp- + 8 位 base36（小写字母 + 数字） */
export const GROUP_ID_PATTERN = /^grp-[0-9a-z]{8}$/;

/**
 * 生成新的分组 ID（与 spec ID 同规）。
 * 格式：`grp-{8 位 base36}`，例如 `grp-a3f9c2d1`。
 */
export function generateGroupId(): string {
  const buf = randomBytes(6);
  let n = 0n;
  for (const b of buf) n = (n << 8n) + BigInt(b);
  let body = n.toString(36);
  if (body.length < ID_BODY_LENGTH) body = body.padStart(ID_BODY_LENGTH, '0');
  if (body.length > ID_BODY_LENGTH) body = body.slice(-ID_BODY_LENGTH);
  return `${GROUP_ID_PREFIX}${body}`;
}

/** 检查字符串是否是合法的分组 ID 格式 */
export function isValidGroupId(value: unknown): value is string {
  return typeof value === 'string' && GROUP_ID_PATTERN.test(value);
}

export function emptyGroupRegistry(): GroupRegistry {
  return { version: 1, groups: [] };
}

/** 宽松规范化磁盘数据：过滤结构非法的条目，缺失字段补默认 */
function normalizeRegistry(raw: unknown): GroupRegistry {
  if (!raw || typeof raw !== 'object') return emptyGroupRegistry();
  const record = raw as { version?: unknown; groups?: unknown };
  const groups: GroupNode[] = [];
  if (Array.isArray(record.groups)) {
    let index = 0;
    for (const item of record.groups) {
      if (!item || typeof item !== 'object') continue;
      const node = item as Record<string, unknown>;
      if (typeof node.id !== 'string' || node.id.length === 0) continue;
      if (typeof node.name !== 'string' || node.name.trim().length === 0) continue;
      groups.push({
        id: node.id,
        name: node.name,
        parentId:
          typeof node.parentId === 'string' && node.parentId.length > 0 ? node.parentId : null,
        order: typeof node.order === 'number' && Number.isFinite(node.order) ? node.order : index,
        description:
          typeof node.description === 'string' && node.description.length > 0
            ? node.description
            : null,
        created: typeof node.created === 'string' ? node.created : '',
        updated: typeof node.updated === 'string' ? node.updated : null,
      });
      index++;
    }
  }
  return { version: typeof record.version === 'number' ? record.version : 1, groups };
}

export async function readGroupRegistry(username: string): Promise<GroupRegistry> {
  const raw = await readJSON<unknown>(getProjectGroupsFilePath(username));
  return normalizeRegistry(raw);
}

/** 同步读取（DB 行构建等同步路径使用；文件很小） */
export function readGroupRegistrySync(username: string): GroupRegistry {
  try {
    const text = readFileSync(getProjectGroupsFilePath(username), 'utf-8');
    return normalizeRegistry(JSON.parse(text));
  } catch {
    return emptyGroupRegistry();
  }
}

export async function writeGroupRegistry(username: string, registry: GroupRegistry): Promise<void> {
  await writeJSON(getProjectGroupsFilePath(username), registry);
}

// ─── 纯操作（直接变更传入 registry，不落盘） ───

export interface EnsureGroupPathResult {
  /** 末级节点（输入全空时为 null） */
  node: GroupNode | null;
  /** 本次新建的节点（按层级从高到低） */
  created: GroupNode[];
  /** 输入是否可解析（全空段视为非法） */
  ok: boolean;
}

/** 按路径确保节点存在（缺失逐级创建），直接变更传入 registry */
export function ensureGroupPathInRegistry(
  registry: GroupRegistry,
  pathInput: string,
  now: string = new Date().toISOString(),
): EnsureGroupPathResult {
  const segments = normalizeGroupPathSegments(pathInput);
  if (segments.length === 0) return { node: null, created: [], ok: false };
  const created: GroupNode[] = [];
  let parentId: string | null = null;
  let current: GroupNode | null = null;
  for (const segment of segments) {
    let node = registry.groups.find((n) => (n.parentId ?? null) === parentId && n.name === segment);
    if (!node) {
      const maxOrder = registry.groups
        .filter((n) => (n.parentId ?? null) === parentId)
        .reduce((max, n) => Math.max(max, n.order), -1);
      node = {
        id: generateGroupId(),
        name: segment,
        parentId,
        order: maxOrder + 1,
        description: null,
        created: now,
        updated: null,
      };
      registry.groups.push(node);
      created.push(node);
    }
    parentId = node.id;
    current = node;
  }
  return { node: current, created, ok: true };
}

export interface GroupMutationError {
  error: string;
}

function isMutationError(value: GroupNode | GroupMutationError): value is GroupMutationError {
  return 'error' in value;
}

/** 创建子分组（同级唯一校验） */
export function createGroupNodeInRegistry(
  registry: GroupRegistry,
  parentId: string | null,
  name: string,
  now: string = new Date().toISOString(),
): GroupNode | GroupMutationError {
  if (parentId && !registry.groups.some((n) => n.id === parentId)) {
    return { error: '父分组不存在' };
  }
  const error = validateGroupName(registry.groups, parentId, name);
  if (error) return { error };
  const maxOrder = registry.groups
    .filter((n) => (n.parentId ?? null) === parentId)
    .reduce((max, n) => Math.max(max, n.order), -1);
  const node: GroupNode = {
    id: generateGroupId(),
    name: name.trim(),
    parentId,
    order: maxOrder + 1,
    description: null,
    created: now,
    updated: null,
  };
  registry.groups.push(node);
  return node;
}

/** 重命名节点（同级唯一校验） */
export function renameGroupNodeInRegistry(
  registry: GroupRegistry,
  id: string,
  newName: string,
  now: string = new Date().toISOString(),
): GroupNode | GroupMutationError {
  const node = registry.groups.find((n) => n.id === id);
  if (!node) return { error: '分组不存在' };
  const trimmed = newName.trim();
  if (trimmed === node.name) return node;
  const error = validateGroupName(registry.groups, node.parentId ?? null, trimmed, id);
  if (error) return { error };
  node.name = trimmed;
  node.updated = now;
  return node;
}

/** 移动节点（防环 + 同级唯一校验） */
export function moveGroupNodeInRegistry(
  registry: GroupRegistry,
  id: string,
  newParentId: string | null,
  now: string = new Date().toISOString(),
): GroupNode | GroupMutationError {
  const node = registry.groups.find((n) => n.id === id);
  if (!node) return { error: '分组不存在' };
  const parent = newParentId ?? null;
  if (parent !== null) {
    if (!registry.groups.some((n) => n.id === parent)) return { error: '目标父分组不存在' };
    if (collectSubtreeIds(registry.groups, id).has(parent)) {
      return { error: '不能移动到自身或其子分组下' };
    }
  }
  if ((node.parentId ?? null) === parent) return node;
  const error = validateGroupName(registry.groups, parent, node.name, id);
  if (error) return { error };
  node.parentId = parent;
  node.updated = now;
  return node;
}

/** 删除节点及其子树（返回被移除的节点，含全部后代） */
export function removeGroupTreeInRegistry(
  registry: GroupRegistry,
  id: string,
): { removed: GroupNode[] } {
  const ids = collectSubtreeIds(registry.groups, id);
  const removed = registry.groups.filter((n) => ids.has(n.id));
  registry.groups = registry.groups.filter((n) => !ids.has(n.id));
  return { removed };
}

// ─── IO 包装（读 → 变更 → 落盘） ───

export async function ensureGroupPath(
  username: string,
  pathInput: string,
): Promise<EnsureGroupPathResult> {
  const registry = await readGroupRegistry(username);
  const result = ensureGroupPathInRegistry(registry, pathInput);
  if (result.created.length > 0) await writeGroupRegistry(username, registry);
  return result;
}

export async function createGroupNode(
  username: string,
  parentId: string | null,
  name: string,
): Promise<GroupNode | GroupMutationError> {
  const registry = await readGroupRegistry(username);
  const result = createGroupNodeInRegistry(registry, parentId, name);
  if (!isMutationError(result)) await writeGroupRegistry(username, registry);
  return result;
}

export async function renameGroupNode(
  username: string,
  id: string,
  newName: string,
): Promise<GroupNode | GroupMutationError> {
  const registry = await readGroupRegistry(username);
  const result = renameGroupNodeInRegistry(registry, id, newName);
  if (!isMutationError(result)) await writeGroupRegistry(username, registry);
  return result;
}

export async function moveGroupNode(
  username: string,
  id: string,
  newParentId: string | null,
): Promise<GroupNode | GroupMutationError> {
  const registry = await readGroupRegistry(username);
  const result = moveGroupNodeInRegistry(registry, id, newParentId);
  if (!isMutationError(result)) await writeGroupRegistry(username, registry);
  return result;
}

export async function removeGroupTree(
  username: string,
  id: string,
): Promise<{ removed: GroupNode[] }> {
  const registry = await readGroupRegistry(username);
  const result = removeGroupTreeInRegistry(registry, id);
  if (result.removed.length > 0) await writeGroupRegistry(username, registry);
  return result;
}

// ─── 解析辅助 ───

/** 按引用（grp- id 或完整路径）查找节点 */
export function findGroupByRef(registry: GroupRegistry, ref: string): GroupNode | null {
  const trimmed = ref.trim();
  if (trimmed.length === 0) return null;
  if (isValidGroupId(trimmed)) return registry.groups.find((n) => n.id === trimmed) ?? null;
  return resolveGroupPath(registry.groups, trimmed);
}

/** id 列表 → 完整路径列表（去重、保持输入顺序；未知 id 跳过） */
export function resolveGroupPathsForIds(
  registry: GroupRegistry,
  ids: string[] | undefined,
): string[] {
  if (!ids || ids.length === 0) return [];
  const paths = groupPathMap(registry.groups);
  const result: string[] = [];
  for (const id of ids) {
    const path = paths.get(id);
    if (path && !result.includes(path)) result.push(path);
  }
  return result;
}

/** 同步解析（DB 行构建等同步路径使用） */
export function resolveGroupPathsSync(username: string, ids: string[] | undefined): string[] {
  return resolveGroupPathsForIds(readGroupRegistrySync(username), ids);
}
