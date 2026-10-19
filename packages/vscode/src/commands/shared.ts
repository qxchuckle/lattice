import * as vscode from 'vscode';
import { CliError } from '../cli/errors';
import { LatticeDataService } from '../data/service';
import { TaskRow } from '../cli/types';
import { errorLog } from '../logging';
import { ActiveProjectService } from '../state/active-project';
import { ActiveTaskService } from '../state/active-task';
import { ReportStore } from '../state/report-store';
import { SearchStateService } from '../state/search-state';
import { SnapshotStore } from '../state/snapshot';
import { LatticeItemPayload, LatticeTreeItem } from '../views/items';
import { t } from '../t';
import { showEnhancedPicker } from '../pickers/enhanced';

export interface GraphController {
  open(target?: {
    view?: 'global' | 'task' | 'project' | 'spec';
    anchorId?: string;
  }): Promise<void>;
}

import type { BusyService } from '../busy';
import type { RevealService } from '../views/reveal';
import type { SpecDiagnosticsService } from '../editor/spec-diagnostics';
import type { UserScopeService } from '../state/user-scope';
import type { ViewSearchService } from '../state/view-search';
import type { ViewFilterService } from '../state/view-filter';
import type { TasksScopeService } from '../state/tasks-scope';
import type { ViewSearchPreviewService } from '../views/view-search-preview';

export interface CommandServices {
  context: vscode.ExtensionContext;
  data: LatticeDataService;
  snapshot: SnapshotStore;
  activeProject: ActiveProjectService;
  activeTask: ActiveTaskService;
  searchState: SearchStateService;
  reports: ReportStore;
  busy?: BusyService;
  userScope?: UserScopeService;
  viewFilter?: ViewFilterService;
  tasksScope?: TasksScopeService;
  viewSearch?: ViewSearchService;
  viewSearchPreview?: ViewSearchPreviewService;
  graph?: GraphController;
  watcher?: { start(): void; healthy: boolean };
  reveal?: RevealService;
  specDiagnostics?: SpecDiagnosticsService;
}

export type RegisterFn = (id: string, handler: (...args: unknown[]) => unknown) => void;

// ── 参数归一化（菜单传入 TreeItem / 命令面板无参 / 内部直接传对象） ──

export function extractPayload(arg: unknown): LatticeItemPayload | undefined {
  if (arg && typeof arg === 'object' && 'lattice' in arg) {
    return (arg as LatticeTreeItem).lattice;
  }
  return undefined;
}

export function extractArgObject<T extends object>(arg: unknown): T | undefined {
  if (
    arg &&
    typeof arg === 'object' &&
    !('lattice' in arg) &&
    !(arg instanceof vscode.Uri) &&
    !Array.isArray(arg)
  ) {
    return arg as T;
  }
  return undefined;
}

export function payloadTaskId(payload: LatticeItemPayload | undefined): string | undefined {
  if (!payload) return undefined;
  switch (payload.kind) {
    case 'task':
    case 'taskDoc':
    case 'taskProgressGroup':
    case 'taskRefsGroup':
    case 'taskSubtasksGroup':
    case 'taskProjectsGroup':
    case 'checkpoint':
    case 'progressAll':
      return payload.taskId;
    case 'refSpecLeaf':
      return payload.taskId;
    default:
      return undefined;
  }
}

export function collectUris(args: unknown[]): vscode.Uri[] {
  const uris: vscode.Uri[] = [];
  for (const arg of args) {
    if (arg instanceof vscode.Uri) uris.push(arg);
    else if (Array.isArray(arg))
      uris.push(...arg.filter((x): x is vscode.Uri => x instanceof vscode.Uri));
  }
  return uris;
}

// ── 通知（30s 同文案去重） ──

const recentNotifications = new Map<string, number>();

export function showDeduped(
  kind: 'error' | 'warn' | 'info',
  message: string,
  ...actions: string[]
): Thenable<string | undefined> {
  const key = `${kind}\u0000${message}`;
  const now = Date.now();
  const last = recentNotifications.get(key);
  if (last !== undefined && now - last < 30_000) {
    return Promise.resolve(undefined);
  }
  recentNotifications.set(key, now);
  if (kind === 'error') return vscode.window.showErrorMessage(message, ...actions);
  if (kind === 'warn') return vscode.window.showWarningMessage(message, ...actions);
  return vscode.window.showInformationMessage(message, ...actions);
}

/** CLI 错误统一出口：按分类给引导（可操作按钮），取消静默。 */
export async function handleCliError(error: unknown, contextMessage: string): Promise<void> {
  if (error instanceof CliError) {
    switch (error.code) {
      case 'NO_PROJECT': {
        await showDeduped('warn', t('The current directory is not a registered Lattice project.'));
        return;
      }
      default:
        errorLog(contextMessage, error);
        await showDeduped(
          'error',
          `${contextMessage}: ${error.stderrSummary || error.message}`,
          t('Show Logs'),
        ).then((action) => {
          if (action === t('Show Logs')) void vscode.commands.executeCommand('lattice.logs.show');
        });
        return;
    }
  }
  errorLog(contextMessage, error);
  const message = error instanceof Error ? error.message : String(error);
  await showDeduped('error', `${contextMessage}: ${message}`);
}

// ── 进度与取消 ──

export function tokenToSignal(token: vscode.CancellationToken): AbortSignal {
  const controller = new AbortController();
  if (token.isCancellationRequested) controller.abort();
  controller.signal.throwIfAborted?.();
  token.onCancellationRequested(() => controller.abort());
  return controller.signal;
}

export async function withNotificationProgress<T>(
  title: string,
  task: (update: (message: string) => void, signal: AbortSignal) => Promise<T>,
  cancellable = false,
): Promise<T | undefined> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title, cancellable },
    async (progress, token) =>
      task((message) => progress.report({ message }), tokenToSignal(token)),
  );
}

// ── 任务/项目选择 ──

export interface PickTaskOptions {
  title?: string;
  allowNone?: boolean;
  statuses?: string[];
}

export async function pickTask(
  services: CommandServices,
  options: PickTaskOptions = {},
): Promise<TaskRow | undefined> {
  await services.snapshot.ensure(['tasks', 'projects']);
  const tasks = [...services.snapshot.data.tasks]
    .filter((task) => !options.statuses || options.statuses.includes(task.status))
    .sort((a, b) =>
      String(b.updated ?? b.created ?? '').localeCompare(String(a.updated ?? a.created ?? '')),
    );
  interface PickTaskItem extends vscode.QuickPickItem {
    task?: TaskRow;
  }
  const items: PickTaskItem[] = tasks.map((task) => {
    const project = task.projects.map((p) => services.snapshot.findProject(p)).find(Boolean);
    return {
      label: task.title,
      description: [task.status, project?.name].filter(Boolean).join(' · '),
      detail: task.id,
      task,
    };
  });
  if (options.allowNone) {
    items.unshift({ label: t('(None)'), task: undefined });
  }
  const picked = await showEnhancedPicker(items, {
    title: options.title ?? t('Pick a task'),
    matchOnDetail: true,
    placeHolder: options.title ?? t('Pick a task'),
    actions: {
      copyId: (item) => item.task?.id,
      openGraph: async (item) => {
        if (item.task) await services.graph?.open({ view: 'task', anchorId: item.task.id });
      },
      reveal: async (item) => {
        if (item.task) await services.reveal?.reveal({ kind: 'task', id: item.task.id });
      },
    },
  });
  return picked?.task;
}

/** 解析任务：item payload / 参数对象 / TaskRow / 活动任务 / 选择器。 */
export async function resolveTask(
  services: CommandServices,
  arg: unknown,
  options: PickTaskOptions = {},
): Promise<TaskRow | undefined> {
  const payload = extractPayload(arg);
  const fromPayload = payloadTaskId(payload);
  if (fromPayload) {
    const task = services.snapshot.taskById(fromPayload);
    if (task) return task;
  }
  const obj = extractArgObject<{ taskId?: string; id?: string; title?: string; status?: string }>(
    arg,
  );
  const objId = obj?.taskId ?? (obj?.id && obj?.status ? obj.id : undefined);
  if (objId) {
    const task = services.snapshot.taskById(objId);
    if (task) return task;
  }
  const activeId = services.activeTask.id;
  if (activeId) {
    await services.snapshot.ensure(['tasks', 'projects']);
    const active = services.snapshot.taskById(activeId);
    if (active) return active;
  }
  return pickTask(services, options);
}

export async function pickSpecId(
  services: CommandServices,
  options: { title?: string } = {},
): Promise<{ specId: string; filePath: string } | undefined> {
  await services.snapshot.ensure(['specs']);
  const specs = services.snapshot.allSpecs;
  const picked = await showEnhancedPicker(
    specs.map((spec) => ({
      label: spec.title || spec.id,
      description: `${spec.scope} · ${spec.id}`,
      detail: spec.description ?? spec.filePath,
      spec,
    })),
    {
      title: options.title ?? t('Pick a spec'),
      matchOnDetail: true,
      actions: {
        copyId: (item) => item.spec.id,
        openGraph: async (item) => {
          await services.graph?.open({ view: 'spec', anchorId: item.spec.id });
        },
        reveal: async (item) => {
          await services.reveal?.reveal({ kind: 'spec', id: item.spec.id });
        },
      },
    },
  );
  if (!picked) return undefined;
  return { specId: picked.spec.id, filePath: picked.spec.filePath };
}

// ── 确认 ──

export async function confirmDanger(
  message: string,
  detail: string | undefined,
  confirmLabel: string,
): Promise<boolean> {
  const picked = await vscode.window.showWarningMessage(
    message,
    { modal: true, detail },
    confirmLabel,
  );
  return picked === confirmLabel;
}

export function cwdForCli(services: CommandServices): string | undefined {
  return (
    services.activeProject.currentAnchorRoot ?? services.activeProject.currentFolder?.uri.fsPath
  );
}
