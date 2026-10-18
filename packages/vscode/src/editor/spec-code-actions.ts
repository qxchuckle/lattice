import * as vscode from 'vscode';
import { extractSpecIds } from '../util/spec-links';
import { ActiveTaskService } from '../state/active-task';
import { SnapshotStore } from '../state/snapshot';
import { t } from '../t';

/**
 * `spec-xxxxxxxx` 位置的 CodeAction：把该规范引用到**当前活动任务**。
 *
 * 提供条件（全部满足）：
 * - 存在活动任务（无活动任务时由命令面板 `lattice.spec.refToTask` 走选任务流程）；
 * - 该 spec 已在快照中（未知 id 不提供动作）；
 * - 快照已加载 specs/tasks（未加载则触发 ensure，下次触发即可见）。
 */
export class SpecRefCodeActionProvider implements vscode.CodeActionProvider {
  constructor(
    private readonly snapshot: SnapshotStore,
    private readonly activeTask: ActiveTaskService,
  ) {}

  provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
    if (document.uri.scheme !== 'file') return [];
    const taskId = this.activeTask.id;
    if (!taskId) return [];
    if (!this.snapshot.data.loaded.specs || !this.snapshot.data.loaded.tasks) {
      void this.snapshot.ensure(['specs', 'tasks']);
      return [];
    }

    const line = document.lineAt(range.start.line).text;
    const hits = extractSpecIds(line);
    if (hits.length === 0) return [];

    const task = this.snapshot.taskById(taskId);
    const actions: vscode.CodeAction[] = [];
    for (const { id } of hits) {
      const spec = this.snapshot.specById(id);
      if (!spec) continue;
      const action = new vscode.CodeAction(
        t('Reference {0} from "{1}"', id, task?.title ?? taskId),
        vscode.CodeActionKind.QuickFix,
      );
      action.command = {
        command: 'lattice.spec.refToTask',
        title: t('Reference to the active task'),
        arguments: [{ specId: id }],
      };
      actions.push(action);
    }
    return actions;
  }
}
