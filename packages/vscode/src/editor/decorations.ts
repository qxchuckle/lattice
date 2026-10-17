import * as vscode from 'vscode';
import { getConfig } from '../config';
import { ActiveTaskService } from '../state/active-task';
import { SnapshotStore } from '../state/snapshot';
import { isPathInside } from '../util/paths';
import { t } from '../t';

/** 活动任务 scopePaths 命中的文件加 "T" 徽标。 */
export class TaskScopeDecorationProvider implements vscode.FileDecorationProvider {
  private readonly emitter = new vscode.EventEmitter<undefined>();
  readonly onDidChangeFileDecorations = this.emitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly activeTask: ActiveTaskService,
    private readonly snapshot: SnapshotStore,
  ) {
    this.disposables.push(
      activeTask.onDidChange(() => this.fire()),
      snapshot.onDidChange((sections) => {
        if (sections.includes('tasks')) this.fire();
      }),
    );
  }

  fire(): void {
    this.emitter.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (!getConfig().decorationsEnabled) return undefined;
    if (uri.scheme !== 'file') return undefined;
    const taskId = this.activeTask.id;
    if (!taskId) return undefined;
    const task = this.snapshot.taskById(taskId);
    if (!task || task.scopePaths.length === 0) return undefined;
    const target = uri.fsPath;
    const hit = task.scopePaths.some((scopePath) => {
      if (!scopePath.path) return false;
      return scopePath.path === target || isPathInside(scopePath.path, target);
    });
    if (!hit) return undefined;
    return {
      badge: 'T',
      color: new vscode.ThemeColor('charts.green'),
      tooltip: t('In scope of active task: {0}', task.title),
    };
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.emitter.dispose();
  }
}
