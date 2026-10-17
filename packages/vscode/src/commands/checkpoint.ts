import * as vscode from 'vscode';
import { listCheckpoints } from '@qcqx/lattice-core';
import {
  CommandServices,
  RegisterFn,
  extractArgObject,
  handleCliError,
  resolveTask,
  showDeduped,
  withNotificationProgress,
} from './shared';
import { CHECKPOINT_TYPES } from './task';
import { closeDraftTab, openCheckpointDraft } from '../editor/checkpoint-draft';
import {
  buildSummaryBody,
  firstHeading,
  parseCheckpointDraft,
} from '../editor/checkpoint-draft-logic';
import { t } from '../t';

interface DraftArgs {
  taskId?: string;
  type?: string;
  title?: string;
  body?: string;
}

function isValidCheckpointType(type: string): boolean {
  return CHECKPOINT_TYPES.some((entry) => entry.type === type);
}

/** 新建检查点草稿：类型 / 标题（可预置）→ 打开 untitled 长文本草稿。 */
async function createDraft(services: CommandServices, arg: unknown): Promise<string | undefined> {
  const task = await resolveTask(services, arg);
  if (!task) return undefined;
  const args = extractArgObject<DraftArgs>(arg) ?? {};

  // 1) 类型
  let type = args.type?.trim();
  if (type && !isValidCheckpointType(type)) {
    void showDeduped('warn', t('Invalid checkpoint type: {0}', type));
    return undefined;
  }
  if (!type) {
    interface TypePickItem extends vscode.QuickPickItem {
      type: string;
    }
    const picked = await vscode.window.showQuickPick(
      CHECKPOINT_TYPES.map<TypePickItem>((entry) => ({
        label: entry.type,
        description: entry.description,
        type: entry.type,
      })),
      {
        title: t('Checkpoint type'),
        placeHolder: t('Pick the checkpoint type for "{0}"', task.title),
      },
    );
    if (!picked) return undefined;
    type = picked.type;
  }

  // 2) 标题（短摘要；正文在草稿里写）
  let title = args.title;
  if (title === undefined) {
    title = await vscode.window.showInputBox({
      title: t('Checkpoint title'),
      prompt: t('Short summary'),
      validateInput: (value) => (value.trim() ? undefined : t('Title is required')),
    });
    if (title === undefined) return undefined;
  }

  const uri = await openCheckpointDraft({
    taskId: task.id,
    type,
    title: title.trim(),
    body: args.body ?? '',
  });
  const commit = t('Commit Draft');
  void showDeduped(
    'info',
    t('Checkpoint draft opened. Write details, then run "Commit Checkpoint Draft".'),
    commit,
  ).then((action) => {
    if (action === commit) void vscode.commands.executeCommand('lattice.checkpoint.commit');
  });
  return uri;
}

/** 任务总结：任务行 + 最近检查点参考 + 完成项 / 遗留 / 下一步三段骨架。 */
async function summarizeTask(services: CommandServices, arg: unknown): Promise<string | undefined> {
  const task = await resolveTask(services, arg);
  if (!task) return undefined;
  const username = services.snapshot.data.username;
  if (!username) {
    void showDeduped('warn', t('Lattice is not initialized yet.'));
    return undefined;
  }

  const projects = task.projects
    .map((id) => services.snapshot.findProject(id)?.name || id)
    .join(', ');
  const taskLine = t(
    'Task: {0} · Status: {1} · Projects: {2} · Updated: {3}',
    task.title,
    task.status,
    projects || t('(None)'),
    task.updated || '—',
  );

  let body = buildSummaryBody({ taskLine, sections: [t('Done'), t('Pending'), t('Next Steps')] });

  // 最近检查点作为参考素材（提交前可删）
  try {
    const recent = await listCheckpoints(username, task.id, { last: 5 });
    if (recent.length > 0) {
      const lines = recent.map((entry) => `- ${entry.time} · ${entry.type} · ${entry.title}`);
      body += `\n## ${t('Recent checkpoints (reference)')}\n\n${lines.join('\n')}\n`;
    }
  } catch {
    // 参考素材失败不阻塞起草
  }

  return openCheckpointDraft({
    taskId: task.id,
    type: 'summary',
    title: t('Summary: {0}', task.title),
    body,
  });
}

/** 提交当前编辑器中的检查点草稿 → 写入 progress.yaml 并关闭草稿页签。 */
async function commitDraft(services: CommandServices): Promise<string | undefined> {
  const editor = vscode.window.activeTextEditor;
  const draft =
    editor && editor.document.uri.scheme === 'untitled'
      ? parseCheckpointDraft(editor.document.getText())
      : null;
  if (!editor || !draft) {
    void showDeduped(
      'warn',
      t('The active editor is not a checkpoint draft. Run "New Checkpoint Draft" first.'),
    );
    return undefined;
  }
  if (!draft.taskId) {
    void showDeduped('warn', t('Draft is missing the task id in its frontmatter.'));
    return undefined;
  }

  await services.snapshot.ensure(['tasks']);
  const task = services.snapshot.taskById(draft.taskId);
  if (!task) {
    void showDeduped('warn', t('Task not found: {0}', draft.taskId));
    return undefined;
  }

  const body = draft.body.trim();
  const title = (draft.title || firstHeading(body) || '').trim();
  if (!title) {
    void showDeduped(
      'warn',
      t('Draft title is empty (set "title" in the frontmatter or use a "# heading").'),
    );
    return undefined;
  }
  if (draft.type && !isValidCheckpointType(draft.type)) {
    void showDeduped('warn', t('Invalid checkpoint type: {0}', draft.type));
    return undefined;
  }

  try {
    await withNotificationProgress(t('Adding checkpoint…'), () =>
      services.data.taskCheckpoint(task.id, {
        type: draft.type || 'note',
        title,
        message: body,
      }),
    );
    await services.snapshot.invalidate(['tasks']);
    await closeDraftTab(editor.document.uri);
    void showDeduped('info', t('Checkpoint added to "{0}".', task.title));
    return task.id;
  } catch (error) {
    await handleCliError(error, t('Failed to add the checkpoint'));
    return undefined;
  }
}

/** 检查点草稿三命令：起草 / 任务总结 / 提交。 */
export function registerCheckpointDraftCommands(
  services: CommandServices,
  register: RegisterFn,
): void {
  register('lattice.task.checkpoint.draft', (arg) => createDraft(services, arg));
  register('lattice.task.summarize', (arg) => summarizeTask(services, arg));
  register('lattice.checkpoint.commit', () => commitDraft(services));
}
