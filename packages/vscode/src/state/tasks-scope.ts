import * as vscode from 'vscode';
import { getConfig } from '../config';

const STORAGE_KEY = 'lattice.tasksScope';

export type TasksScope = 'all' | 'project';

/**
 * 任务视图范围（全部项目 / 当前项目）持久化：
 * - 有效值 = workspaceState 覆盖 ?? `lattice.tasks.scope` 设置（设置仍作默认值）；
 * - 标题栏切换只写 workspaceState（不再静默修改用户 settings.json）；
 * - 用户显式修改设置时清空覆盖（extension 侧监听 config 变更调用 clearOverride），令设置重新生效。
 */
export class TasksScopeService implements vscode.Disposable {
  private override: TasksScope | undefined;
  private readonly emitter = new vscode.EventEmitter<TasksScope>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    const saved = context.workspaceState.get<TasksScope>(STORAGE_KEY);
    if (saved === 'all' || saved === 'project') this.override = saved;
  }

  get effective(): TasksScope {
    return this.override ?? getConfig().tasksScope;
  }

  get hasOverride(): boolean {
    return this.override !== undefined;
  }

  async toggle(): Promise<TasksScope> {
    return this.set(this.effective === 'all' ? 'project' : 'all');
  }

  async set(scope: TasksScope): Promise<TasksScope> {
    this.override = scope;
    await this.context.workspaceState.update(STORAGE_KEY, scope);
    this.emitter.fire(this.override);
    return this.override;
  }

  /** 设置变更后调用：丢弃覆盖，回到设置值。 */
  async clearOverride(): Promise<void> {
    if (this.override === undefined) return;
    this.override = undefined;
    await this.context.workspaceState.update(STORAGE_KEY, undefined);
    this.emitter.fire(this.effective);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
