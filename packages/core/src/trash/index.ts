import { randomBytes } from 'node:crypto';
import { rename } from 'node:fs/promises';
import { join } from 'node:path';
import {
  getLatticeRoot,
  ensureDir,
  readJSON,
  writeJSON,
  removeDir,
  listDir,
  dirExists,
} from '../paths';

// ─── 类型 ───

export interface TrashMeta {
  /** 垃圾桶条目唯一 ID */
  id: string;
  /** 被删除实体的类型 */
  type: 'task' | 'project' | 'spec';
  /** 原始路径 */
  originalPath: string;
  /** 人类可读标题 */
  title: string;
  /** 所属用户 */
  username: string;
  /** 实体原始 ID（taskId / projectId / spec 文件名） */
  entityId: string;
  /** 移入垃圾桶的时间 */
  trashedAt: string;
  /** 恢复所需的额外元数据 */
  restoreHints?: Record<string, unknown>;
}

// ─── 路径 ───

export function getTrashDir(): string {
  return join(getLatticeRoot(), '.trash');
}

function getTrashItemDir(trashId: string): string {
  return join(getTrashDir(), trashId);
}

function getTrashMetaPath(trashId: string): string {
  return join(getTrashItemDir(trashId), '.trash-meta.json');
}

// ─── 核心操作 ───

/**
 * 将文件/目录移入垃圾桶
 * @returns 垃圾桶条目 ID
 */
export async function moveToTrash(
  originalPath: string,
  meta: Omit<TrashMeta, 'id' | 'trashedAt'>,
): Promise<string> {
  const id = generateTrashId();
  const trashItemDir = getTrashItemDir(id);
  await ensureDir(trashItemDir);

  // 写入元数据
  const trashMeta: TrashMeta = {
    ...meta,
    id,
    trashedAt: new Date().toISOString(),
  };
  await writeJSON(getTrashMetaPath(id), trashMeta);

  // 将原始内容移入垃圾桶的 content 子目录
  const contentDir = join(trashItemDir, 'content');
  await rename(originalPath, contentDir);

  return id;
}

/**
 * 列出垃圾桶中的所有条目
 */
export async function listTrashItems(username?: string): Promise<TrashMeta[]> {
  const trashDir = getTrashDir();
  if (!(await dirExists(trashDir))) return [];

  const entries = await listDir(trashDir);
  const items: TrashMeta[] = [];

  for (const entry of entries) {
    const meta = await readJSON<TrashMeta>(getTrashMetaPath(entry));
    if (!meta) continue;
    if (username && meta.username !== username) continue;
    items.push(meta);
  }

  // 按时间倒序
  items.sort((a, b) => b.trashedAt.localeCompare(a.trashedAt));
  return items;
}

/**
 * 获取单个垃圾桶条目元数据
 */
export async function getTrashItem(trashId: string): Promise<TrashMeta | null> {
  return readJSON<TrashMeta>(getTrashMetaPath(trashId));
}

/**
 * 从垃圾桶恢复条目到原始位置
 */
export async function restoreFromTrash(trashId: string): Promise<TrashMeta> {
  const meta = await readJSON<TrashMeta>(getTrashMetaPath(trashId));
  if (!meta) {
    throw new Error(`垃圾桶中未找到条目：${trashId}`);
  }

  const contentDir = join(getTrashItemDir(trashId), 'content');
  if (!(await dirExists(contentDir))) {
    throw new Error(`垃圾桶条目内容已损坏：${trashId}`);
  }

  // 确保目标父目录存在
  const parentDir = join(meta.originalPath, '..');
  await ensureDir(parentDir);

  // 检查原始位置是否已被占用
  if (await dirExists(meta.originalPath)) {
    throw new Error(`原始位置已存在内容，无法恢复：${meta.originalPath}`);
  }

  // 移回原始位置
  await rename(contentDir, meta.originalPath);

  // 清理垃圾桶条目
  await removeDir(getTrashItemDir(trashId));

  return meta;
}

/**
 * 彻底删除垃圾桶中的单个条目
 */
export async function purgeTrashItem(trashId: string): Promise<TrashMeta | null> {
  const meta = await readJSON<TrashMeta>(getTrashMetaPath(trashId));
  if (!meta) return null;

  await removeDir(getTrashItemDir(trashId));
  return meta;
}

/**
 * 清空垃圾桶
 */
export async function emptyTrash(username?: string): Promise<number> {
  const items = await listTrashItems(username);
  for (const item of items) {
    await removeDir(getTrashItemDir(item.id));
  }
  return items.length;
}

/**
 * 通过精确 ID 或前缀匹配解析垃圾桶条目
 */
export async function resolveTrashById(input: string): Promise<TrashMeta | null> {
  const items = await listTrashItems();
  return (
    items.find((item) => item.id === input) ??
    items.find((item) => item.id.startsWith(input)) ??
    null
  );
}

// ─── 工具 ───

function generateTrashId(): string {
  const date = new Date().toISOString().slice(0, 10);
  const rand = randomBytes(4).toString('hex');
  return `${date}-${rand}`;
}
