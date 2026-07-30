/**
 * task/fsm — TaskStatus 状态机（领域单一真相）
 *
 * 集中定义任务状态全集与显式转换表，cli / web 一律从这里导入，
 * 禁止在消费层硬编码状态值或复制转换规则（范式参考
 * agent-protocol/src/source/node-state.ts：显式转换表常量 + 纯函数）。
 * 纯函数、零依赖。
 */
import type { TaskStatus } from '../types';

/** 任务状态全集（satisfies 保证成员与 TaskStatus 类型同步；顺序即展示顺序） */
export const TASK_STATUSES = [
  'planning',
  'in_progress',
  'completed',
  'archived',
] as const satisfies readonly TaskStatus[];

/**
 * TaskStatus 显式转换表（Record 键穷举：TaskStatus 增删成员时此处编译报错）。
 *
 * 当前为全连通矩阵——这是对既有功能的如实建模，而非疏漏：
 * - 任意态 → in_progress：cli `task start` / `task reopen`（均不检查当前态，
 *   reopen 覆盖 completed → in_progress 与 archived 恢复）、web 详情面板下拉
 * - 任意态 → completed：cli `task complete`、web 详情面板下拉
 * - 任意态 → archived：core archiveTask（cli `task archive`、web /archive 路由）
 * - 任意态 → planning：web 详情面板下拉对任意当前态（含 archived）均可选 planning；
 *   cli `task update --status` 是通用 setter，任意转换均可达
 *
 * 语义可疑但现状允许（本次不改变行为，仅注释标记）：
 * - completed → planning：跳过 in_progress 直接回规划
 * - archived → planning / in_progress / completed：归档恢复（web 下拉、cli reopen 依赖）
 *
 * 未来收紧转换规则时只改本表，消费层（cli/web 路由）行为自动跟随。
 */
export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  planning: ['planning', 'in_progress', 'completed', 'archived'],
  in_progress: ['planning', 'in_progress', 'completed', 'archived'],
  completed: ['planning', 'in_progress', 'completed', 'archived'],
  archived: ['planning', 'in_progress', 'completed', 'archived'],
};

/** 值是否为合法 TaskStatus（未知输入的运行时校验 + 类型收窄） */
export function isValidTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value);
}

/** 状态转换是否合法；同值转换视为 no-op 恒允许 */
export function canTransitionTaskStatus(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  return TASK_TRANSITIONS[from].includes(to);
}
