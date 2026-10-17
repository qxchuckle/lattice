import * as vscode from 'vscode';

/**
 * 只读浏览范围：查看其他用户的数据（视图 / 图谱 / 桥只读；数据面统一拦截写入）。
 * - enter：切到目标用户视图并全量刷新
 * - exit：回到当前配置用户
 */
export class UserScopeService implements vscode.Disposable {
  private browse: string | undefined;
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  /** 正在只读浏览的用户（未浏览时为 undefined）。 */
  get browseUser(): string | undefined {
    return this.browse;
  }

  get readOnly(): boolean {
    return this.browse !== undefined;
  }

  enter(username: string): void {
    if (this.browse === username) return;
    this.browse = username;
    this.emitter.fire();
  }

  exit(): void {
    if (this.browse === undefined) return;
    this.browse = undefined;
    this.emitter.fire();
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
