import * as vscode from 'vscode';

const ACTIVE_TASK_KEY = 'lattice.activeTaskId';

/** 会话级「活动任务」：wizards 默认对象、范围装饰、复制上下文的目标。 */
export class ActiveTaskService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<string | undefined>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  get id(): string | undefined {
    const value = this.context.workspaceState.get<string>(ACTIVE_TASK_KEY);
    return value && value.trim() !== '' ? value : undefined;
  }

  async set(id: string | undefined): Promise<void> {
    const value = id && id.trim() !== '' ? id : undefined;
    await this.context.workspaceState.update(ACTIVE_TASK_KEY, value);
    this.emitter.fire(value);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
