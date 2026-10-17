import * as vscode from 'vscode';
import { errorLog } from '../logging';
import { t } from '../t';
import { LatticeTreeItem } from '../views/items';
import {
  CommandServices,
  RegisterFn,
  confirmDanger,
  showDeduped,
  withNotificationProgress,
} from './shared';

/** 批量状态动作（任务树多选）。 */
type BatchAction = 'start' | 'complete' | 'archive';

const BATCH_LABELS: Record<BatchAction, string> = {
  start: t('Start'),
  complete: t('Complete'),
  archive: t('Archive'),
};

/** 集成测试钩子：测试宿主无法点击模态确认弹窗。 */
function skipConfirm(): boolean {
  return process.env.LATTICE_TEST_SKIP_CONFIRM === '1';
}

/**
 * 归一化命令参数为任务 ID 列表。
 * VS Code 多选上下文菜单的参数形态随版本/点击位置而异：
 * `(element)` / `(element, elements[])` / `(elements[])` / 展开多参 —— 全部兜底，并按任务去重。
 */
export function collectTaskIds(args: unknown[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const payload = (value as LatticeTreeItem).lattice;
    if (payload?.kind === 'task' && payload.taskId && !seen.has(payload.taskId)) {
      seen.add(payload.taskId);
      ids.push(payload.taskId);
    }
  };
  for (const arg of args) visit(arg);
  return ids;
}

async function runBatchStatus(
  services: CommandServices,
  args: unknown[],
  action: BatchAction,
): Promise<void> {
  const ids = collectTaskIds(args);
  if (ids.length === 0) {
    void showDeduped('info', t('No batch-operable tasks in the selection.'));
    return;
  }
  const label = BATCH_LABELS[action];
  if (!skipConfirm()) {
    const confirmed = await confirmDanger(
      t('Apply "{0}" to {1} selected task(s)?', label, ids.length),
      undefined,
      label,
    );
    if (!confirmed) return;
  }
  const title = t('Updating {0} task(s)…', ids.length);
  const execute = async (): Promise<void> => {
    const failed: string[] = [];
    let attempted = 0;
    await withNotificationProgress(
      title,
      async (update, signal) => {
        for (let i = 0; i < ids.length; i += 1) {
          if (signal.aborted) break;
          update(`${i + 1}/${ids.length} · ${ids[i]}`);
          try {
            await services.data.taskSetStatus(ids[i], action);
            attempted += 1;
          } catch (error) {
            attempted += 1;
            failed.push(ids[i]);
            errorLog(`batch ${action} failed: ${ids[i]}`, error);
          }
        }
      },
      true,
    );
    await services.snapshot.invalidate(['tasks']);

    const success = attempted - failed.length;
    const skipped = ids.length - attempted;
    if (failed.length === 0 && skipped === 0) {
      void showDeduped('info', t('Updated {0} task(s).', success));
      return;
    }
    const showLogs = t('Show Logs');
    void showDeduped(
      'warn',
      t(
        'Batch update finished: {0} updated, {1} failed, {2} skipped.',
        success,
        failed.length,
        skipped,
      ),
      showLogs,
    ).then((action) => {
      if (action === showLogs) void vscode.commands.executeCommand('lattice.logs.show');
    });
  };

  if (services.busy) await services.busy.runIfIdle('tasks-batch', title, execute);
  else await execute();
}

function runBatchCopyIds(args: unknown[]): void {
  const ids = collectTaskIds(args);
  if (ids.length === 0) {
    void showDeduped('info', t('No batch-operable tasks in the selection.'));
    return;
  }
  void vscode.env.clipboard.writeText(ids.join('\n'));
  void showDeduped('info', t('Copied {0} task ID(s).', ids.length));
}

/** 任务树多选批量操作（view/item/context，`listMultiSelection` 时显示）。 */
export function registerTaskBatchCommands(services: CommandServices, register: RegisterFn): void {
  register('lattice.tasks.batchStart', (...args: unknown[]) =>
    runBatchStatus(services, args, 'start'),
  );
  register('lattice.tasks.batchComplete', (...args: unknown[]) =>
    runBatchStatus(services, args, 'complete'),
  );
  register('lattice.tasks.batchArchive', (...args: unknown[]) =>
    runBatchStatus(services, args, 'archive'),
  );
  register('lattice.tasks.copyIds', (...args: unknown[]) => runBatchCopyIds(args));
}
