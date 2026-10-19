import { TimeLevel, normalizeTimeLevels } from '../views/task-time-groups';

/** 任务视图分组方式：状态（默认）/ 按创建时间 / 按更新时间。 */
export type TaskGroupMode = 'status' | 'created' | 'updated';

export interface TaskGroupSetting {
  mode: TaskGroupMode;
  /** 时间模式层级（year > month > day）；status 模式保留供下次切换使用。 */
  levels: TimeLevel[];
}

export const DEFAULT_TIME_LEVELS: TimeLevel[] = ['month', 'day'];

/** 归一化持久化值：非法 mode → status；层级去重 + 固定顺序；空层级回退默认。 */
export function normalizeTaskGroupSetting(value: unknown): TaskGroupSetting {
  const obj =
    value && typeof value === 'object' ? (value as { mode?: unknown; levels?: unknown }) : {};
  const mode: TaskGroupMode =
    obj.mode === 'created' || obj.mode === 'updated' ? obj.mode : 'status';
  const levels = normalizeTimeLevels(Array.isArray(obj.levels) ? obj.levels : []);
  return { mode, levels: levels.length > 0 ? levels : [...DEFAULT_TIME_LEVELS] };
}
