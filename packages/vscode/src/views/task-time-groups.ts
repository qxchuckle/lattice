import { TaskRow } from '../cli/types';

/**
 * 任务视图「时间分组」纯函数：按创建/更新时间把任务构造成 1–3 级（年/月/日任意组合）树。
 * 供 tasks provider 渲染、reveal 路径构造与单测复用；不依赖 vscode。
 */

export type TimeLevel = 'year' | 'month' | 'day';

/** 固定层级顺序（构树顺序 year > month > day）。 */
export const TIME_LEVEL_ORDER: readonly TimeLevel[] = ['year', 'month', 'day'];

/** 节点 id 路径段（`tg:<segment>:<key>`）用的短码。 */
export const TIME_LEVEL_SEGMENT: Record<TimeLevel, string> = { year: 'y', month: 'm', day: 'd' };

/** 短码 → 层级（itemFromId 解析用）。 */
export const TIME_LEVEL_BY_SEGMENT: Record<string, TimeLevel> = { y: 'year', m: 'month', d: 'day' };

export interface TimeGroupNode {
  level: TimeLevel;
  /** 绝对格式键，同时用作组标签：`2026` / `2026-10` / `2026-10-19`。 */
  key: string;
  children: TimeGroupNode[];
  /** 仅末级节点持有任务（按基准时间倒序）；中间层为空数组。 */
  tasks: TaskRow[];
  /** 该节点下任务总数（含子层）。 */
  count: number;
}

export interface TimeGroups {
  roots: TimeGroupNode[];
  /** 基准时间缺失/非法 → 「未知时间」；按原顺序（已随整体倒序落在末尾）。 */
  unknown: TaskRow[];
  /** 树遍历顺序的扁平任务序（不含 unknown，调用方自行拼接）。 */
  flat: TaskRow[];
}

/** 归一化层级：过滤非法值、去重、固定顺序；空 → 空数组（调用方回退默认）。 */
export function normalizeTimeLevels(levels: readonly unknown[]): TimeLevel[] {
  const set = new Set(
    levels.filter((level): level is TimeLevel =>
      (TIME_LEVEL_ORDER as readonly unknown[]).includes(level),
    ),
  );
  return TIME_LEVEL_ORDER.filter((level) => set.has(level));
}

interface DateParts {
  year: string;
  month: string;
  day: string;
}

/** 本地时区日期部件（与 formatDate / 任务 ID 的本地展示口径一致）。 */
export function localDateParts(iso: string | undefined | null): DateParts | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return { year: y, month: `${y}-${m}`, day: `${y}-${m}-${d}` };
}

/** 分组基准时间：created 模式缺 created 时回退 updated，反之亦然。 */
export function basisValue(
  task: Pick<TaskRow, 'created' | 'updated'>,
  basis: 'created' | 'updated',
): string | undefined {
  return basis === 'created' ? (task.created ?? task.updated) : (task.updated ?? task.created);
}

/** 任务在所选层级下的键路径（与构树同源）；基准时间缺失 → undefined。 */
export function taskTimeKeys(
  task: Pick<TaskRow, 'created' | 'updated'>,
  basis: 'created' | 'updated',
  levels: readonly TimeLevel[],
): string[] | undefined {
  const parts = localDateParts(basisValue(task, basis));
  if (!parts) return undefined;
  return levels.map((level) => parts[level]);
}

/** 构造时间分组树；levels 为空时退化为按天（防御，服务层已保证非空）。 */
export function buildTimeGroups(
  tasks: readonly TaskRow[],
  basis: 'created' | 'updated',
  levels: readonly TimeLevel[],
): TimeGroups {
  const ordered = normalizeTimeLevels(levels);
  const effective: TimeLevel[] = ordered.length > 0 ? ordered : ['day'];
  const sorted = [...tasks].sort((a, b) =>
    String(basisValue(b, basis) ?? '').localeCompare(String(basisValue(a, basis) ?? '')),
  );
  const roots: TimeGroupNode[] = [];
  const unknown: TaskRow[] = [];
  const flat: TaskRow[] = [];
  for (const task of sorted) {
    const parts = localDateParts(basisValue(task, basis));
    if (!parts) {
      unknown.push(task);
      continue;
    }
    flat.push(task);
    let siblings = roots;
    let node: TimeGroupNode | undefined;
    for (const level of effective) {
      const key = parts[level];
      let next = siblings.find((entry) => entry.key === key);
      if (!next) {
        next = { level, key, children: [], tasks: [], count: 0 };
        siblings.push(next);
      }
      next.count += 1;
      node = next;
      siblings = next.children;
    }
    node?.tasks.push(task);
  }
  return { roots, unknown, flat };
}
