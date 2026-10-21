import * as vscode from 'vscode';
import { TaskRow } from '../cli/types';
import { truncate } from '../cli/parsers';
import { getConfig } from '../config';
import { t } from '../t';
import { openTaskDoc } from './document';
import {
  CommandServices,
  RegisterFn,
  collectUris,
  confirmDanger,
  cwdForCli,
  extractArgObject,
  extractPayload,
  handleCliError,
  pickTask,
  resolveTask,
  showDeduped,
  withNotificationProgress,
} from './shared';

export const CHECKPOINT_TYPES: Array<{ type: string; description: string }> = [
  { type: 'context', description: t('Background / rule / constraint given by the user') },
  { type: 'correction', description: t('A mistake was made (what / why / correct way)') },
  { type: 'constraint', description: t('Hard constraint imposed by the user') },
  { type: 'assumption', description: t('Key assumption (impact if proven wrong)') },
  { type: 'followup', description: t('Deferred work (why not now)') },
  { type: 'note', description: t('Objective fact (source noted)') },
  { type: 'decision', description: t('Choice made (decision + rationale)') },
  { type: 'pivot', description: t('Direction changed (old → new + reason)') },
  { type: 'milestone', description: t('Verified stage result') },
  { type: 'issue', description: t('Environment / dependency problem (not an AI mistake)') },
  { type: 'summary', description: t('Archive summary') },
];

type TaskAction = 'start' | 'complete' | 'archive' | 'reopen';

const ACTION_LABELS: Record<TaskAction, string> = {
  start: t('Task started: {0}'),
  complete: t('Task completed: {0}'),
  archive: t('Task archived: {0}'),
  reopen: t('Task reopened: {0}'),
};

async function setTaskStatus(
  services: CommandServices,
  action: TaskAction,
  arg: unknown,
): Promise<void> {
  const task = await resolveTask(services, arg);
  if (!task) return;
  try {
    await withNotificationProgress(t('Updating task…'), () =>
      services.data.taskSetStatus(task.id, action),
    );
    await services.snapshot.invalidate(['tasks']);
    // 开始任务 = 聚焦到它：自动设为活动任务（任务详情视图 / 状态栏 / 范围装饰随之跟随）
    if (action === 'start') await services.activeTask.set(task.id);
    void showDeduped('info', ACTION_LABELS[action].replace('{0}', task.title));
  } catch (error) {
    await handleCliError(error, t('Failed to update the task'));
  }
}

async function createTask(services: CommandServices): Promise<void> {
  const title = await vscode.window.showInputBox({
    title: t('Create Task'),
    prompt: t('Task title'),
    validateInput: (value) => (value.trim() ? undefined : t('Title is required')),
  });
  if (!title) return;

  await services.snapshot.ensure(['projects']);
  interface ProjectPickItem extends vscode.QuickPickItem {
    projectId: string;
  }
  const activeId = services.snapshot.canonicalProjectId(services.activeProject.currentProjectId);
  const projectItems: ProjectPickItem[] = [...services.snapshot.data.projects]
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
    .map((project) => ({
      label: project.name || project.id,
      description: project.packageNames[0] ?? project.id,
      projectId: project.id,
      picked: project.id === activeId,
    }));
  const projects = await vscode.window.showQuickPick(projectItems, {
    title: t('Associate projects (optional)'),
    canPickMany: true,
    placeHolder: t('Select projects to associate with this task'),
  });
  if (projects === undefined) return;

  // allowNone 的「(None)」与用户 ESC 都返回 undefined —— 统一按无父任务处理。
  const parent = await pickTask(services, {
    title: t('Parent task (optional)'),
    allowNone: true,
  });

  const startNow = await vscode.window.showQuickPick(
    [
      { label: t('Start now'), value: true },
      { label: t('Keep as planning'), value: false },
    ],
    { title: t('Workflow'), placeHolder: t('Start the task immediately?') },
  );
  if (!startNow) return;

  try {
    const taskId = await withNotificationProgress(t('Creating task…'), () =>
      services.data.taskCreate(title.trim(), {
        projectIds: projects.map((p) => p.projectId),
        parentId: parent?.id,
        cwd: cwdForCli(services),
      }),
    );
    if (!taskId) return;
    if (startNow.value) {
      await services.data.taskSetStatus(taskId, 'start');
    }
    await services.snapshot.invalidate(['tasks']);
    await services.activeTask.set(taskId);
    const openPrd = t('Open PRD');
    const showInGraph = t('Show in Graph');
    void showDeduped('info', t('Task created: {0}', title.trim()), openPrd, showInGraph).then(
      async (action) => {
        if (action === openPrd) await openTaskDoc(services, taskId, 'prd');
        if (action === showInGraph) await services.graph?.open({ view: 'task', anchorId: taskId });
      },
    );
  } catch (error) {
    await handleCliError(error, t('Failed to create the task'));
  }
}

async function addCheckpoint(services: CommandServices, arg: unknown): Promise<void> {
  const task = await resolveTask(services, arg);
  if (!task) return;
  interface TypePickItem extends vscode.QuickPickItem {
    type: string;
  }
  const typeItems: TypePickItem[] = CHECKPOINT_TYPES.map((entry) => ({
    label: entry.type,
    description: entry.description,
    type: entry.type,
  }));
  const pickedType = await vscode.window.showQuickPick(typeItems, {
    title: t('Checkpoint type'),
    placeHolder: t('Pick the checkpoint type for "{0}"', task.title),
  });
  if (!pickedType) return;
  const checkpointTitle = await vscode.window.showInputBox({
    title: t('Checkpoint title'),
    prompt: t('Short summary'),
    validateInput: (value) => (value.trim() ? undefined : t('Title is required')),
  });
  if (!checkpointTitle) return;
  const message = await vscode.window.showInputBox({
    title: t('Checkpoint message (optional)'),
    prompt: t('Details (optional; use "New Checkpoint Draft" for long text)'),
  });
  if (message === undefined) return;
  try {
    await withNotificationProgress(t('Adding checkpoint…'), () =>
      services.data.taskCheckpoint(task.id, {
        type: pickedType.type,
        title: checkpointTitle.trim(),
        message: message.trim(),
      }),
    );
    await services.snapshot.invalidate(['tasks']);
    void showDeduped('info', t('Checkpoint added to "{0}".', task.title));
  } catch (error) {
    await handleCliError(error, t('Failed to add the checkpoint'));
  }
}

async function associateProject(services: CommandServices, arg: unknown): Promise<void> {
  const task = await resolveTask(services, arg);
  if (!task) return;
  await services.snapshot.ensure(['projects']);
  let projectId = services.snapshot.canonicalProjectId(services.activeProject.currentProjectId);
  if (!projectId || !services.snapshot.findProject(projectId)) {
    const picked = await vscode.window.showQuickPick(
      services.snapshot.data.projects.map((project) => ({
        label: project.name || project.id,
        description: project.packageNames[0] ?? project.id,
        projectId: project.id,
      })),
      { title: t('Pick a project to associate'), matchOnDetail: true },
    );
    if (!picked) return;
    projectId = picked.projectId;
  }
  try {
    await withNotificationProgress(t('Associating project…'), () =>
      services.data.taskAssociate(task.id, { projectId }),
    );
    await services.snapshot.invalidate(['tasks']);
    void showDeduped('info', t('Project associated with "{0}".', task.title));
  } catch (error) {
    await handleCliError(error, t('Failed to associate the project'));
  }
}

async function associatePaths(services: CommandServices, ...args: unknown[]): Promise<void> {
  const task = await resolveTask(services, args[0] instanceof vscode.Uri ? undefined : args[0]);
  if (!task) return;
  let uris = collectUris(args);
  if (uris.length === 0) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: true,
      canSelectMany: true,
      defaultUri: services.activeProject.currentProjectRoot
        ? vscode.Uri.file(services.activeProject.currentProjectRoot)
        : services.activeProject.currentFolder?.uri,
      openLabel: t('Associate with task'),
      title: t('Pick files/folders to add to the task scope'),
    });
    if (!picked || picked.length === 0) return;
    uris = picked;
  }
  const paths = uris.map((uri) => uri.fsPath);
  try {
    await withNotificationProgress(t('Updating task scope…'), () =>
      services.data.taskAssociate(task.id, { paths }),
    );
    await services.snapshot.invalidate(['tasks']);
    void showDeduped('info', t('Added {0} path(s) to "{1}".', paths.length, task.title));
  } catch (error) {
    await handleCliError(error, t('Failed to update the task scope'));
  }
}

async function refSpecs(services: CommandServices, arg: unknown): Promise<void> {
  const task = await resolveTask(services, arg);
  if (!task) return;
  await services.snapshot.ensure(['specs']);
  interface SpecPickItem extends vscode.QuickPickItem {
    specId: string;
  }
  const items: SpecPickItem[] = services.snapshot.allSpecs.map((spec) => ({
    label: spec.title || spec.id,
    description: `${spec.scope} · ${spec.id}`,
    detail: truncate(spec.description ?? '', 120),
    specId: spec.id,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: t('Reference specs'),
    canPickMany: true,
    matchOnDetail: true,
    placeHolder: t('Select specs to reference from "{0}"', task.title),
  });
  if (!picked || picked.length === 0) return;
  try {
    await withNotificationProgress(t('Referencing specs…'), () =>
      services.data.taskRefSpec(
        task.id,
        picked.map((x) => x.specId),
      ),
    );
    await services.snapshot.invalidate(['tasks']);
    void showDeduped('info', t('Referenced {0} spec(s) from "{1}".', picked.length, task.title));
  } catch (error) {
    await handleCliError(error, t('Failed to reference specs'));
  }
}

async function unrefSpec(services: CommandServices, arg: unknown): Promise<void> {
  const payload = extractPayload(arg);
  const task = await resolveTask(services, arg);
  if (!task) return;
  let specId = payload?.kind === 'refSpecLeaf' ? payload.specId : undefined;
  if (!specId) {
    const picked = await vscode.window.showQuickPick(
      task.referencedSpecs.map((ref) => ({
        label: services.snapshot.specById(ref.id)?.title ?? ref.relativePath ?? ref.id ?? '',
        description: ref.id,
        specId: ref.id,
      })),
      { title: t('Unreference spec') },
    );
    if (!picked?.specId) return;
    specId = picked.specId;
  }
  try {
    await services.data.taskUnrefSpec(task.id, specId);
    await services.snapshot.invalidate(['tasks']);
    void showDeduped('info', t('Unreferenced {0}.', specId));
  } catch (error) {
    await handleCliError(error, t('Failed to unreference the spec'));
  }
}

async function renameTask(services: CommandServices, arg: unknown): Promise<void> {
  const task = await resolveTask(services, arg);
  if (!task) return;
  const title = await vscode.window.showInputBox({
    title: t('Rename Task'),
    value: task.title,
    validateInput: (value) => (value.trim() ? undefined : t('Title is required')),
  });
  if (!title || title === task.title) return;
  try {
    await services.data.taskUpdateTitle(task.id, title.trim());
    await services.snapshot.invalidate(['tasks']);
    void showDeduped('info', t('Task renamed: {0}', title.trim()));
  } catch (error) {
    await handleCliError(error, t('Failed to rename the task'));
  }
}

/** 取消关联项目（程序化 `{ taskId, projectId }`）。 */
async function unassociateProject(services: CommandServices, arg: unknown): Promise<void> {
  const args = extractArgObject<{ taskId?: string; projectId?: string }>(arg);
  const task = await resolveTask(services, arg);
  if (!task) return;
  let projectId = args?.projectId;
  if (!projectId) {
    await services.snapshot.ensure(['projects']);
    if (task.projects.length === 0) {
      void vscode.window.showWarningMessage(t('The task has no associated projects.'));
      return;
    }
    const picked = await vscode.window.showQuickPick(
      task.projects.map((id) => {
        const project = services.snapshot.findProject(id);
        return {
          label: project?.name || id,
          description: project?.packageNames[0] ?? id,
          projectId: id,
        };
      }),
      { title: t('Unassociate Project'), matchOnDetail: true },
    );
    if (!picked) return;
    projectId = picked.projectId;
  }
  try {
    await withNotificationProgress(t('Updating task…'), () =>
      services.data.taskUnassociate(task.id, { projectId }),
    );
    await services.snapshot.invalidate(['tasks']);
    void showDeduped('info', t('Project unassociated from "{0}".', task.title));
  } catch (error) {
    await handleCliError(error, t('Failed to unassociate the project'));
  }
}

/** 移除单个关联路径（程序化 `{ taskId, path }`）。 */
async function removeScopePath(services: CommandServices, arg: unknown): Promise<void> {
  const args = extractArgObject<{ taskId?: string; path?: string }>(arg);
  const task = await resolveTask(services, arg);
  if (!task) return;
  let path = args?.path;
  if (!path) {
    if (task.scopePaths.length === 0) {
      void vscode.window.showWarningMessage(t('The task has no associated paths.'));
      return;
    }
    const picked = await vscode.window.showQuickPick(
      task.scopePaths.map((entry) => ({
        label: entry.path,
        description: entry.note,
        path: entry.path,
      })),
      { title: t('Remove Scope Path'), matchOnDetail: true },
    );
    if (!picked) return;
    path = picked.path;
  }
  try {
    await withNotificationProgress(t('Updating task…'), () =>
      services.data.taskUnassociate(task.id, { path }),
    );
    await services.snapshot.invalidate(['tasks']);
    void showDeduped('info', t('Removed path from "{0}".', task.title));
  } catch (error) {
    await handleCliError(error, t('Failed to remove the path'));
  }
}

/** 清空全部关联路径（程序化 `{ taskId, clearPaths: true }`；需确认）。 */
async function clearScopePaths(services: CommandServices, arg: unknown): Promise<void> {
  const args = extractArgObject<{ taskId?: string; clearPaths?: boolean }>(arg);
  const task = await resolveTask(services, arg);
  if (!task) return;
  if (task.scopePaths.length === 0) {
    void vscode.window.showWarningMessage(t('The task has no associated paths.'));
    return;
  }
  if (!args?.clearPaths) {
    const confirmed = await confirmDanger(
      t('Clear all scope paths of "{0}"?', task.title),
      t('{0} path(s) will be removed from the task scope.', task.scopePaths.length),
      t('Clear Paths'),
    );
    if (!confirmed) return;
  }
  try {
    await withNotificationProgress(t('Updating task…'), () =>
      services.data.taskUnassociate(task.id, { clearPaths: true }),
    );
    await services.snapshot.invalidate(['tasks']);
    void showDeduped(
      'info',
      t('Cleared {0} scope path(s) of "{1}".', task.scopePaths.length, task.title),
    );
  } catch (error) {
    await handleCliError(error, t('Failed to clear the paths'));
  }
}

/** 变更父任务（程序化 `{ taskId, parentId }`；`{ taskId, clearParent: true }` = 清空）。 */
async function updateParentTask(services: CommandServices, arg: unknown): Promise<void> {
  const args = extractArgObject<{ taskId?: string; parentId?: string; clearParent?: boolean }>(arg);
  const task = await resolveTask(services, arg);
  if (!task) return;
  let parentId: string | undefined;
  if (args && ('parentId' in args || 'clearParent' in args)) {
    parentId = args.clearParent ? undefined : args.parentId;
  } else {
    await services.snapshot.ensure(['tasks']);
    interface ParentPickItem extends vscode.QuickPickItem {
      parentId?: string;
      clear?: boolean;
    }
    const items: ParentPickItem[] = [
      { label: t('(None)'), description: t('Clear parent task'), clear: true },
    ];
    for (const candidate of [...services.snapshot.data.tasks]
      .filter((entry) => entry.id !== task.id)
      .sort((a, b) =>
        String(b.updated ?? b.created ?? '').localeCompare(String(a.updated ?? a.created ?? '')),
      )) {
      items.push({
        label: candidate.title,
        description: [candidate.status, candidate.id].filter(Boolean).join(' · '),
        parentId: candidate.id,
        picked: candidate.id === task.parentTaskId,
      });
    }
    const picked = await vscode.window.showQuickPick(items, {
      title: t('Change Parent Task'),
      matchOnDescription: true,
    });
    if (!picked) return;
    parentId = picked.clear ? undefined : picked.parentId;
  }
  if (parentId === task.parentTaskId) return;
  try {
    await services.data.taskUpdateParent(task.id, parentId);
    await services.snapshot.invalidate(['tasks']);
    void showDeduped(
      'info',
      parentId
        ? t('Parent task updated: {0}', task.title)
        : t('Parent task cleared: {0}', task.title),
    );
  } catch (error) {
    await handleCliError(error, t('Failed to update the parent task'));
  }
}

async function deleteTask(services: CommandServices, arg: unknown): Promise<void> {
  const task = await resolveTask(services, arg);
  if (!task) return;
  const confirmed = await confirmDanger(
    t('Delete task "{0}"?', task.title),
    t('The task is moved to the recycle bin and can be restored later.'),
    t('Delete'),
  );
  if (!confirmed) return;
  try {
    await withNotificationProgress(t('Deleting task…'), () => services.data.taskDelete(task.id));
    if (services.activeTask.id === task.id) await services.activeTask.set(undefined);
    await services.snapshot.invalidate(['tasks']);
    const restore = t('Restore');
    const action = await showDeduped(
      'info',
      t('Task deleted (recycle bin): {0}', task.title),
      restore,
    );
    if (action === restore) {
      const entries = await services.data.trashList();
      const entry = entries
        .filter((e) => e.type === 'task' && e.entityId === task.id)
        .sort((a, b) => String(b.trashedAt ?? '').localeCompare(String(a.trashedAt ?? '')))[0];
      if (!entry) {
        void showDeduped('warn', t('No recycle-bin entry found for this task.'));
        return;
      }
      await services.data.trashRestore(entry.id);
      await services.snapshot.invalidate(['tasks']);
      void showDeduped('info', t('Task restored: {0}', task.title));
    }
  } catch (error) {
    await handleCliError(error, t('Failed to delete the task'));
  }
}

async function setActiveTask(services: CommandServices, arg: unknown): Promise<void> {
  const task = await resolveTask(services, arg);
  if (!task) return;
  await services.activeTask.set(task.id);
  void showDeduped('info', t('Active task: {0}', task.title));
}

export function registerTaskCommands(services: CommandServices, register: RegisterFn): void {
  register('lattice.task.create', () => createTask(services));
  register('lattice.task.start', (arg) => setTaskStatus(services, 'start', arg));
  register('lattice.task.complete', (arg) => setTaskStatus(services, 'complete', arg));
  register('lattice.task.archive', (arg) => setTaskStatus(services, 'archive', arg));
  register('lattice.task.reopen', (arg) => setTaskStatus(services, 'reopen', arg));
  register('lattice.task.checkpoint.add', (arg) => addCheckpoint(services, arg));
  register('lattice.task.associate.project', (arg) => associateProject(services, arg));
  register('lattice.task.associate.paths', (...args) => associatePaths(services, ...args));
  register('lattice.task.unassociate.project', (arg) => unassociateProject(services, arg));
  register('lattice.task.unassociate.path', (arg) => removeScopePath(services, arg));
  register('lattice.task.clearPaths', (arg) => clearScopePaths(services, arg));
  register('lattice.task.refSpec', (arg) => refSpecs(services, arg));
  register('lattice.task.unrefSpec', (arg) => unrefSpec(services, arg));
  register('lattice.task.update.title', (arg) => renameTask(services, arg));
  register('lattice.task.update.parent', (arg) => updateParentTask(services, arg));
  register('lattice.task.delete', (arg) => deleteTask(services, arg));
  register('lattice.task.setActive', (arg) => setActiveTask(services, arg));
  register('lattice.task.clearActive', async () => {
    await services.activeTask.set(undefined);
  });
  register('lattice.task.revealInGraph', async (arg?: unknown) => {
    const payload = extractPayload(arg);
    const obj =
      arg && typeof arg === 'object' && !('lattice' in arg)
        ? (arg as { taskId?: string; projectId?: string; specId?: string })
        : undefined;
    if (payload?.kind === 'task') {
      await services.graph?.open({ view: 'task', anchorId: payload.taskId });
      return;
    }
    if (payload?.kind === 'searchResult') {
      const row = payload.row;
      const view = row.type === 'project' ? 'project' : row.type === 'spec' ? 'spec' : 'task';
      const anchorId =
        view === 'task' ? row.taskId : view === 'spec' ? row.specId : row.projectIds[0];
      if (anchorId) await services.graph?.open({ view, anchorId });
      return;
    }
    if (payload?.kind === 'project') {
      await services.graph?.open({ view: 'project', anchorId: payload.projectId });
      return;
    }
    if (payload?.kind === 'specProjectGroup') {
      await services.graph?.open({ view: 'project', anchorId: payload.projectId });
      return;
    }
    if (payload?.kind === 'spec') {
      await services.graph?.open({ view: 'spec', anchorId: payload.specId });
      return;
    }
    if (obj?.taskId) await services.graph?.open({ view: 'task', anchorId: obj.taskId });
    else if (obj?.projectId)
      await services.graph?.open({ view: 'project', anchorId: obj.projectId });
    else if (obj?.specId) await services.graph?.open({ view: 'spec', anchorId: obj.specId });
    else {
      const task = await pickTask(services, { title: t('Show in Graph') });
      if (task) await services.graph?.open({ view: 'task', anchorId: task.id });
    }
  });
}

export type { TaskRow };
