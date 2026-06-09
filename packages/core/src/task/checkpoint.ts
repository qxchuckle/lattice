import { randomBytes } from 'node:crypto';
import { stringify, parse } from 'yaml';
import type { CheckpointEntry, CheckpointType, ProgressFile } from '../types';
import { getTaskProgressPath, readText, writeText, fileExists } from '../paths';
import { nowISO } from '../utils/time';

/**
 * 检查点有效类型表（按信息源三分）
 * 详细说明见 packages/core/src/types/index.ts 的 CheckpointType 注释。
 */

/** 用户输入类：用户在对话中主动提供的信息 */
const USER_INPUT_TYPES: CheckpointType[] = ['context', 'correction', 'constraint'];

/** AI 判断类：AI 自身产生的推断与记录 */
const AI_SELF_TYPES: CheckpointType[] = ['assumption', 'followup', 'note'];

/** 进程事件类：任务推进中发生的客观事件 */
const PROCESS_EVENT_TYPES: CheckpointType[] = [
  'decision',
  'pivot',
  'milestone',
  'issue',
  'summary',
];

const VALID_TYPES: CheckpointType[] = [
  ...USER_INPUT_TYPES,
  ...AI_SELF_TYPES,
  ...PROCESS_EVENT_TYPES,
];

/** 生成检查点 ID：cp_<8位随机hex> */
function generateCheckpointId(): string {
  return `cp_${randomBytes(4).toString('hex')}`;
}

/** 读取任务的 progress.yaml */
export async function readProgress(username: string, taskId: string): Promise<ProgressFile> {
  const filePath = getTaskProgressPath(username, taskId);
  const exists = await fileExists(filePath);
  if (!exists) {
    return { entries: [] };
  }

  const content = await readText(filePath);
  if (!content || !content.trim()) {
    return { entries: [] };
  }

  try {
    const data = parse(content) as ProgressFile | null;
    return data && Array.isArray(data.entries) ? data : { entries: [] };
  } catch {
    return { entries: [] };
  }
}

/** 写入 progress.yaml */
async function writeProgress(
  username: string,
  taskId: string,
  progress: ProgressFile,
): Promise<void> {
  const filePath = getTaskProgressPath(username, taskId);
  const content = stringify(progress, { lineWidth: 0 });
  await writeText(filePath, content);
}

/** 校验 checkpoint type */
function validateType(type: string): CheckpointType {
  if (!VALID_TYPES.includes(type as CheckpointType)) {
    throw new Error(`无效的检查点类型：${type}。可选值：${VALID_TYPES.join(' / ')}`);
  }
  return type as CheckpointType;
}

export interface AddCheckpointOptions {
  type: string;
  title: string;
  message: string;
}

/** 添加一条检查点记录 */
export async function addCheckpoint(
  username: string,
  taskId: string,
  opts: AddCheckpointOptions,
): Promise<CheckpointEntry> {
  const type = validateType(opts.type);

  const entry: CheckpointEntry = {
    id: generateCheckpointId(),
    time: nowISO(),
    type,
    title: opts.title.trim(),
    message: opts.message.trim(),
  };

  const progress = await readProgress(username, taskId);
  progress.entries.push(entry);
  await writeProgress(username, taskId, progress);

  return entry;
}

export interface ListCheckpointsOptions {
  last?: number;
  type?: CheckpointType;
}

/** 列出检查点记录 */
export async function listCheckpoints(
  username: string,
  taskId: string,
  opts?: ListCheckpointsOptions,
): Promise<CheckpointEntry[]> {
  const progress = await readProgress(username, taskId);
  let entries = progress.entries;

  if (opts?.type) {
    entries = entries.filter((e) => e.type === opts.type);
  }

  if (opts?.last && opts.last > 0) {
    entries = entries.slice(-opts.last);
  }

  return entries;
}

/** 获取单条检查点 */
export async function getCheckpoint(
  username: string,
  taskId: string,
  checkpointId: string,
): Promise<CheckpointEntry | null> {
  const progress = await readProgress(username, taskId);
  return progress.entries.find((e) => e.id === checkpointId) ?? null;
}
