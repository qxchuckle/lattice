import * as vscode from 'vscode';
import { t } from './t';

/**
 * 长操作互斥 + 状态栏 busy 指示（$(sync~spin)）。
 * key 相同的操作第二触发直接提示「正在执行中」，避免重复启动重活（rag/doctor）。
 */
export class BusyService implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
  private readonly active = new Map<string, string>();

  isBusy(key: string): boolean {
    return this.active.has(key);
  }

  async runIfIdle(key: string, title: string, task: () => Promise<void>): Promise<boolean> {
    if (this.active.has(key)) {
      void vscode.window.showInformationMessage(
        t('{0} is already running…', this.active.get(key) ?? key),
      );
      return false;
    }
    this.active.set(key, title);
    this.refreshItem();
    try {
      await task();
      return true;
    } finally {
      this.active.delete(key);
      this.refreshItem();
    }
  }

  private refreshItem(): void {
    const next = [...this.active.values()][0];
    if (!next) {
      this.item.hide();
      return;
    }
    this.item.text = `$(sync~spin) ${next}`;
    this.item.tooltip = next;
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
