import * as vscode from 'vscode';
import { EMPTY_TASK_FILTER, TaskFilterState } from './task-filter-logic';

/**
 * 任务树过滤服务：会话内持久化到 workspaceState；空 = 显示全部。
 * 过滤只影响任务树视图（侧栏），不影响命令面板 / 搜索 / 统计等数据面。
 */
export class TaskFilterService implements vscode.Disposable {
  private state: TaskFilterState = { ...EMPTY_TASK_FILTER };
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    const saved = context.workspaceState.get<Partial<TaskFilterState>>('lattice.taskFilter');
    if (saved && Array.isArray(saved.statuses) && Array.isArray(saved.projectIds)) {
      this.state = {
        statuses: saved.statuses.filter((item): item is string => typeof item === 'string'),
        projectIds: saved.projectIds.filter((item): item is string => typeof item === 'string'),
      };
    }
  }

  get current(): TaskFilterState {
    return this.state;
  }

  get active(): boolean {
    return this.state.statuses.length > 0 || this.state.projectIds.length > 0;
  }

  async set(next: TaskFilterState): Promise<TaskFilterState> {
    this.state = {
      statuses: [...new Set(next.statuses)],
      projectIds: [...new Set(next.projectIds)],
    };
    await this.context.workspaceState.update('lattice.taskFilter', this.state);
    this.emitter.fire();
    return this.state;
  }

  async clear(): Promise<void> {
    await this.set({ ...EMPTY_TASK_FILTER });
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
