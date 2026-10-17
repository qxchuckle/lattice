import * as vscode from 'vscode';
import { formatDate } from '../views/items';
import { truncate } from '../cli/parsers';
import { getLatticeRoot } from '../config';
import { taskDocPath } from '../util/lattice-files';
import { fileExists } from '../util/paths';
import { checkpointUri, progressUri } from '../util/virtual-uris';
import { t } from '../t';
import {
  CommandServices,
  RegisterFn,
  extractArgObject,
  extractPayload,
  handleCliError,
  payloadTaskId,
  resolveTask,
  showDeduped,
  withNotificationProgress,
} from './shared';
import { TaskRow } from '../cli/types';

export async function openTaskDoc(
  services: CommandServices,
  taskId: string | undefined,
  doc?: 'prd' | 'design',
): Promise<void> {
  await services.snapshot.ensure(['user']);
  let id = taskId;
  if (!id) {
    const resolvedTask = await resolveTask(services, undefined);
    if (!resolvedTask) return;
    id = resolvedTask.id;
  }
  const username = services.snapshot.data.username;
  if (!username) {
    await showDeduped(
      'warn',
      t(
        'Cannot determine the Lattice user. Use "Lattice: Manage Users…" to create or switch users.',
      ),
    );
    return;
  }
  let effectiveDoc = doc;
  if (!effectiveDoc) {
    interface PickDocItem extends vscode.QuickPickItem {
      doc: 'prd' | 'design';
    }
    const options: PickDocItem[] = [{ label: t('PRD'), doc: 'prd' }];
    if (await fileExists(taskDocPath(getLatticeRoot(), username, id, 'design'))) {
      options.push({ label: t('Design Doc'), doc: 'design' });
    }
    const picked = await vscode.window.showQuickPick(options, { title: t('Open Document') });
    if (!picked) return;
    effectiveDoc = picked.doc;
  }
  const filePath = taskDocPath(getLatticeRoot(), username, id, effectiveDoc);
  if (!(await fileExists(filePath))) {
    await showDeduped('warn', t('Document not found: {0}', filePath));
    return;
  }
  await vscode.window.showTextDocument(vscode.Uri.file(filePath), { preview: false });
}

async function openCheckpoint(services: CommandServices, arg: unknown): Promise<void> {
  const obj = extractArgObject<{ taskId?: string; checkpointId?: string }>(arg);
  const payload = extractPayload(arg);
  const taskId = obj?.taskId ?? payloadTaskId(payload);
  const checkpointId =
    obj?.checkpointId ?? (payload?.kind === 'checkpoint' ? payload.checkpointId : undefined);
  if (!taskId || !checkpointId) return;
  await vscode.window.showTextDocument(checkpointUri(taskId, checkpointId), { preview: false });
}

async function openProgress(services: CommandServices, arg: unknown): Promise<void> {
  const obj = extractArgObject<{ taskId?: string }>(arg);
  const payload = extractPayload(arg);
  const taskId = obj?.taskId ?? payloadTaskId(payload);
  if (!taskId) return;
  await vscode.window.showTextDocument(progressUri(taskId), { preview: false });
}

/** 复制任务上下文（Markdown：元数据 + PRD 全文 + 最近 checkpoint 时间线）。 */
export async function buildTaskContextMarkdown(
  services: CommandServices,
  task: TaskRow,
): Promise<string> {
  const [info, checkpoints] = await Promise.all([
    services.data.taskInfo(task.id),
    services.data.taskProgress(task.id, { last: 15 }).catch(() => []),
  ]);
  const meta = info.meta ?? task;
  const lines: string[] = [];
  lines.push(`# Task: ${meta.title}`);
  lines.push('');
  lines.push(`- id: ${meta.id}`);
  lines.push(`- status: ${meta.status}`);
  if (meta.projects.length > 0) {
    lines.push(
      `- projects: ${meta.projects
        .map((p) => services.snapshot.findProject(p)?.name ?? p)
        .join(', ')}`,
    );
  }
  if (meta.referencedSpecs.length > 0) {
    lines.push(
      `- referenced specs: ${meta.referencedSpecs.map((r) => r.id ?? r.relativePath).join(', ')}`,
    );
  }
  if (meta.updated) lines.push(`- updated: ${formatDate(meta.updated)}`);
  if (info.prd.trim()) {
    lines.push('', '## PRD', '', info.prd.trim());
  }
  if (checkpoints.length > 0) {
    lines.push('', '## Recent Progress', '');
    for (const checkpoint of checkpoints) {
      lines.push(
        `- [${checkpoint.type ?? ''}] ${checkpoint.title ?? checkpoint.id} (${formatDate(checkpoint.time)})${
          checkpoint.message ? `\n  ${truncate(checkpoint.message, 300)}` : ''
        }`,
      );
    }
  }
  return lines.join('\n');
}

export function registerDocumentCommands(services: CommandServices, register: RegisterFn): void {
  register('lattice.task.openDoc', async (arg?: unknown) => {
    const obj = extractArgObject<{ taskId?: string; doc?: 'prd' | 'design' }>(arg);
    const payload = extractPayload(arg);
    await openTaskDoc(services, obj?.taskId ?? payloadTaskId(payload), obj?.doc);
  });

  register('lattice.task.openProgress', async (arg?: unknown) => {
    await openProgress(services, arg);
  });

  register('lattice.task.openCheckpoint', async (arg?: unknown) => {
    await openCheckpoint(services, arg);
  });

  register('lattice.doc.openSource', async (arg?: unknown) => {
    const obj = extractArgObject<{ filePath?: string }>(arg);
    const payload = extractPayload(arg);
    const filePath =
      obj?.filePath ??
      (payload?.kind === 'spec' || payload?.kind === 'conflict' ? payload.filePath : undefined);
    if (!filePath) return;
    try {
      await vscode.window.showTextDocument(vscode.Uri.file(filePath), { preview: false });
    } catch (error) {
      await handleCliError(error, t('Open file failed'));
    }
  });

  register('lattice.task.copyId', async (arg?: unknown) => {
    const obj = extractArgObject<{ taskId?: string }>(arg);
    const payload = extractPayload(arg);
    let taskId = obj?.taskId ?? payloadTaskId(payload);
    if (!taskId) {
      const task = await resolveTask(services, undefined);
      taskId = task?.id;
    }
    if (!taskId) return;
    await vscode.env.clipboard.writeText(taskId);
    void showDeduped('info', t('Copied: {0}', taskId));
  });

  register('lattice.task.copyContext', async (arg?: unknown) => {
    const task = await resolveTask(services, arg);
    if (!task) return;
    try {
      const markdown = await withNotificationProgress(t('Building task context…'), () =>
        buildTaskContextMarkdown(services, task),
      );
      if (!markdown) return;
      await vscode.env.clipboard.writeText(markdown);
      void showDeduped('info', t('Task context copied to clipboard ({0} chars).', markdown.length));
    } catch (error) {
      await handleCliError(error, t('Copy task context failed'));
    }
  });
}
