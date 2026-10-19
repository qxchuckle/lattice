import * as vscode from 'vscode';
import { TimeLevel } from '../views/task-time-groups';
import { TaskGroupMode, TaskGroupSetting, normalizeTaskGroupSetting } from './task-group-logic';

export type { TaskGroupMode, TaskGroupSetting } from './task-group-logic';

const STORAGE_KEY = 'lattice.tasks.groupBy';

/**
 * 任务视图分组方式持久化（workspaceState 键 `lattice.tasks.groupBy`）：
 * - 时间模式 = 基准（创建/更新）+ 层级（年/月/日任意组合）；
 * - 跨窗口重载保持；不写 settings.json（对齐持久化约定）。
 */
export class TaskGroupService implements vscode.Disposable {
  private setting: TaskGroupSetting;
  private readonly emitter = new vscode.EventEmitter<TaskGroupSetting>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.setting = normalizeTaskGroupSetting(context.workspaceState.get(STORAGE_KEY));
  }

  get current(): TaskGroupSetting {
    return { mode: this.setting.mode, levels: [...this.setting.levels] };
  }

  get mode(): TaskGroupMode {
    return this.setting.mode;
  }

  /** 时间分组基准（status 模式为 undefined）。 */
  get basis(): 'created' | 'updated' | undefined {
    return this.setting.mode === 'status' ? undefined : this.setting.mode;
  }

  get levels(): TimeLevel[] {
    return [...this.setting.levels];
  }

  async set(value: {
    mode: TaskGroupMode;
    levels?: readonly TimeLevel[];
  }): Promise<TaskGroupSetting> {
    const next = normalizeTaskGroupSetting({
      mode: value.mode,
      levels: value.levels ?? this.setting.levels,
    });
    this.setting = next;
    await this.context.workspaceState.update(STORAGE_KEY, next);
    this.emitter.fire(next);
    return this.current;
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
