import * as vscode from 'vscode';
import * as path from 'node:path';
import { ProjectRow } from '../cli/types';
import { t } from '../t';
import { showEnhancedPicker } from '../pickers/enhanced';
import {
  CommandServices,
  RegisterFn,
  confirmDanger,
  extractArgObject,
  extractPayload,
  handleCliError,
  showDeduped,
  withNotificationProgress,
} from './shared';

const RELATION_TYPES: Array<{ type: string; label: string }> = [
  { type: 'related', label: t('related') },
  { type: 'depends-on', label: t('depends on') },
  { type: 'shares-component', label: t('shares component') },
  { type: 'forked-from', label: t('forked from') },
  { type: 'nested-in', label: t('nested in') },
];

function projectIdFrom(services: CommandServices, arg: unknown): string | undefined {
  const payload = extractPayload(arg);
  if (payload?.kind === 'project') return payload.projectId;
  if (payload?.kind === 'currentProject') return payload.projectId;
  if (payload?.kind === 'specProjectGroup') return payload.projectId;
  if (payload?.kind === 'relation') return payload.projectId;
  if (payload?.kind === 'searchResult') return payload.row.projectIds[0];
  const obj = extractArgObject<{ projectId?: string }>(arg);
  return obj?.projectId ?? (typeof arg === 'string' ? arg : undefined);
}

async function pickProject(
  services: CommandServices,
  options: { title?: string; exclude?: string } = {},
): Promise<ProjectRow | undefined> {
  await services.snapshot.ensure(['projects']);
  const exclude = services.snapshot.canonicalProjectId(options.exclude);
  const items = services.snapshot.data.projects
    .filter((project) => services.snapshot.canonicalProjectId(project.id) !== exclude)
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
    .map((project) => ({
      label: project.name || project.id,
      description: project.packageNames[0] ?? project.id,
      project,
    }));
  const picked = await showEnhancedPicker(items, {
    title: options.title ?? t('Pick a project'),
    matchOnDetail: true,
    actions: {
      copyId: (item) => item.project.id,
      openGraph: async (item) => {
        await services.graph?.open({ view: 'project', anchorId: item.project.id });
      },
      reveal: async (item) => {
        await services.reveal?.reveal({ kind: 'project', id: item.project.id });
      },
    },
  });
  return picked?.project;
}

async function resolveProject(
  services: CommandServices,
  arg: unknown,
): Promise<ProjectRow | undefined> {
  const fromArg = projectIdFrom(services, arg);
  if (fromArg) {
    await services.snapshot.ensure(['projects']);
    const project = services.snapshot.findProject(fromArg);
    if (project) return project;
  }
  const active = services.snapshot.findProject(services.activeProject.currentProjectId);
  if (active) return active;
  return pickProject(services);
}

/** 在系统文件管理器中显示（失败回退 OS 默认打开）。 */
async function revealInFileManager(path: string): Promise<void> {
  try {
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(path));
  } catch {
    void vscode.env.openExternal(vscode.Uri.file(path));
  }
}

/** 多本地路径：>1 时 QuickPick 选择；单路径直用；无路径告警。 */
async function pickLocalPath(project: ProjectRow, title: string): Promise<string | undefined> {
  const paths = project.localPaths.filter(Boolean);
  if (paths.length === 0) {
    // 用户主动点击：不去重（重复点击也要有反馈）
    void vscode.window.showWarningMessage(t('No local path recorded for this project.'));
    return undefined;
  }
  if (paths.length === 1) return paths[0];
  const picked = await vscode.window.showQuickPick(
    paths.map((path) => ({ label: path, path })),
    { title },
  );
  return picked?.path;
}

/** 逗号分隔字段 → 去重数组（空串 → 空数组）。 */
function splitList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

export function registerProjectCommands(services: CommandServices, register: RegisterFn): void {
  register('lattice.project.open', async (arg?: unknown) => {
    const project = await resolveProject(services, arg);
    if (!project) return;
    const path = await pickLocalPath(project, t('Pick a path'));
    if (!path) return;
    // 「在文件管理器中显示」：revealFileInOS 语义清晰，失败回退 OS 默认打开
    await revealInFileManager(path);
  });

  register('lattice.project.openInCurrentWindow', async (arg?: unknown) => {
    const project = await resolveProject(services, arg);
    if (!project) return;
    const path = await pickLocalPath(project, t('Pick a path'));
    if (!path) return;
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(path), {
      forceNewWindow: false,
    });
  });

  register('lattice.project.openFolder', async (arg?: unknown) => {
    const project = await resolveProject(services, arg);
    if (!project) return;
    const path = await pickLocalPath(project, t('Pick a path'));
    if (!path) return;
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(path), {
      forceNewWindow: true,
    });
  });

  register('lattice.project.openInTerminal', async (arg?: unknown) => {
    const project = await resolveProject(services, arg);
    if (!project) return;
    const path = await pickLocalPath(project, t('Pick a path'));
    if (!path) return;
    const terminal = vscode.window.createTerminal({ name: project.name || project.id, cwd: path });
    terminal.show();
  });

  register('lattice.project.rename', async (arg?: unknown) => {
    const args = extractArgObject<{ projectId?: string; name?: string }>(arg);
    const project = await resolveProject(services, arg);
    if (!project) return undefined;
    let name = args?.name;
    if (name === undefined) {
      name = await vscode.window.showInputBox({
        title: t('Project name'),
        value: project.name,
      });
      if (name === undefined) return undefined;
    }
    const trimmed = name.trim();
    try {
      await withNotificationProgress(t('Updating project…'), () =>
        services.data.projectUpdate(project.id, { name: trimmed }),
      );
      await services.snapshot.invalidate(['projects']);
      if (!args) void showDeduped('info', t('Project updated: {0}', trimmed || project.id));
      return services.snapshot.findProject(project.id);
    } catch (error) {
      await handleCliError(error, t('Failed to update the project'));
      return undefined;
    }
  });

  register('lattice.project.editDescription', async (arg?: unknown) => {
    const args = extractArgObject<{ projectId?: string; description?: string }>(arg);
    const project = await resolveProject(services, arg);
    if (!project) return undefined;
    let description = args?.description;
    if (description === undefined) {
      description = await vscode.window.showInputBox({
        title: t('Project description'),
        value: project.description ?? '',
      });
      if (description === undefined) return undefined;
    }
    try {
      await withNotificationProgress(t('Updating project…'), () =>
        services.data.projectUpdate(project.id, { description: description.trim() }),
      );
      await services.snapshot.invalidate(['projects']);
      if (!args) void showDeduped('info', t('Project updated: {0}', project.name || project.id));
      return services.snapshot.findProject(project.id);
    } catch (error) {
      await handleCliError(error, t('Failed to update the project'));
      return undefined;
    }
  });

  register('lattice.project.editMeta', async (arg?: unknown) => {
    const project = await resolveProject(services, arg);
    if (!project) return undefined;
    try {
      const metaPath = await services.data.projectMetaPath(project.id);
      if (!metaPath) {
        void showDeduped('warn', t('No local path recorded for this project.'));
        return undefined;
      }
      await vscode.window.showTextDocument(vscode.Uri.file(metaPath), { preview: false });
      return metaPath;
    } catch (error) {
      await handleCliError(error, t('Failed to open the project meta file'));
      return undefined;
    }
  });

  register('lattice.project.copyId', async (arg?: unknown) => {
    const projectId = projectIdFrom(services, arg) ?? (await pickProject(services))?.id;
    if (!projectId) return;
    await vscode.env.clipboard.writeText(projectId);
    void showDeduped('info', t('Copied: {0}', projectId));
  });

  register('lattice.project.copyPath', async (arg?: unknown) => {
    const project = await resolveProject(services, arg);
    if (!project) return;
    const path = await pickLocalPath(project, t('Pick a path'));
    if (!path) return;
    await vscode.env.clipboard.writeText(path);
    void showDeduped('info', t('Copied: {0}', path));
  });

  register('lattice.project.revealInGraph', async (arg?: unknown) => {
    const project = await resolveProject(services, arg);
    if (!project) return;
    await services.graph?.open({ view: 'project', anchorId: project.id });
  });

  register('lattice.project.relation.add', async (arg?: unknown) => {
    const project = await resolveProject(services, arg);
    if (!project) return;
    const peer = await pickProject(services, {
      title: t('Pick the related project'),
      exclude: project.id,
    });
    if (!peer) return;
    const typePick = await vscode.window.showQuickPick(
      RELATION_TYPES.map((entry) => ({
        label: entry.label,
        description: entry.type,
        type: entry.type,
      })),
      { title: t('Relation type') },
    );
    if (!typePick) return;
    const description = await vscode.window.showInputBox({
      title: t('Relation description (optional)'),
      prompt: t('Evidence / rationale for this relation'),
    });
    if (description === undefined) return;
    try {
      await withNotificationProgress(t('Adding relation…'), () =>
        services.data.relationAdd(project.id, peer.id, {
          type: typePick.type,
          description: description.trim() || undefined,
        }),
      );
      await services.snapshot.invalidate(['projects']);
      void showDeduped('info', t('Relation added: {0} → {1}', project.name, peer.name));
    } catch (error) {
      await handleCliError(error, t('Failed to add the relation'));
    }
  });

  register('lattice.project.relation.remove', async (arg?: unknown) => {
    const payload = extractPayload(arg);
    let relationId = payload?.kind === 'relation' ? payload.relationId : undefined;
    if (!relationId) {
      await services.snapshot.ensure(['projects']);
      const picked = await vscode.window.showQuickPick(
        services.snapshot.data.relations.map((relation) => ({
          label: `${relation.type}: ${relation.projectA} ↔ ${relation.projectB}`,
          description: relation.description,
          relationId: relation.id,
        })),
        { title: t('Remove relation'), matchOnDetail: true },
      );
      relationId = picked?.relationId;
    }
    if (!relationId) return;
    const confirmed = await confirmDanger(
      t('Remove relation {0}?', relationId),
      t('This cannot be undone from the extension.'),
      t('Remove'),
    );
    if (!confirmed) return;
    try {
      await services.data.relationRemove(relationId);
      await services.snapshot.invalidate(['projects']);
      void showDeduped('info', t('Relation removed: {0}', relationId));
    } catch (error) {
      await handleCliError(error, t('Failed to remove the relation'));
    }
  });

  register('lattice.project.update', async (arg?: unknown) => {
    const project = await resolveProject(services, arg);
    if (!project) return;
    const name = await vscode.window.showInputBox({
      title: t('Project name'),
      value: project.name,
    });
    if (name === undefined) return;
    const description = await vscode.window.showInputBox({
      title: t('Project description'),
      value: project.description ?? '',
    });
    if (description === undefined) return;
    const tagsRaw = await vscode.window.showInputBox({
      title: t('Tags (comma separated)'),
      value: project.tags ?? '',
    });
    if (tagsRaw === undefined) return;
    // 分组多选：注册表路径（缩进展示，勾选 = 归属）+「新建路径…」（缺失自动创建）
    const groupPaths = await services.data.projectGroupPaths();
    const currentGroups = new Set(splitList(project.groups ?? ''));
    interface GroupPickItem extends vscode.QuickPickItem {
      value?: string;
    }
    const CREATE_SENTINEL = '__lattice_new_group__';
    const groupItems: GroupPickItem[] = [
      { label: `$(plus) ${t('Add new path…')}`, value: CREATE_SENTINEL },
      ...groupPaths.map((path) => ({
        label: `${'  '.repeat(Math.max(0, path.split('/').length - 1))}${path}`,
        picked: currentGroups.has(path),
        value: path,
      })),
    ];
    const picked = await vscode.window.showQuickPick(groupItems, {
      title: t('Groups (multi-select; new paths are created)'),
      canPickMany: true,
    });
    if (picked === undefined) return;
    let extraGroups: string[] = [];
    if (picked.some((item) => item.value === CREATE_SENTINEL)) {
      const raw = await vscode.window.showInputBox({
        title: t('New group path(s), comma separated'),
        placeHolder: t('e.g. Work/Frontend'),
      });
      if (raw === undefined) return;
      extraGroups = splitList(raw);
    }
    const selectedGroups = [
      ...picked
        .filter((item) => item.value && item.value !== CREATE_SENTINEL)
        .map((item) => item.value as string),
      ...extraGroups,
    ];
    try {
      const groupResult = await withNotificationProgress(t('Updating project…'), async () => {
        await services.data.projectUpdate(project.id, {
          name: name.trim(),
          description: description.trim(),
          tags: splitList(tagsRaw),
        });
        return services.data.projectGroupsUpdate(project.id, { set: selectedGroups });
      });
      await services.snapshot.invalidate(['projects']);
      const created = groupResult?.createdPaths ?? [];
      // 显式点击反馈（每次都有）
      void vscode.window.showInformationMessage(
        created.length > 0
          ? t(
              'Project updated: {0} (created groups: {1})',
              name.trim() || project.id,
              created.join(', '),
            )
          : t('Project updated: {0}', name.trim() || project.id),
      );
    } catch (error) {
      await handleCliError(error, t('Failed to update the project'));
    }
  });

  register('lattice.project.switchActive', async (arg) => {
    const args = extractArgObject<{
      folderUri?: string;
      folderPath?: string;
      rootPath?: string;
      auto?: boolean;
    }>(arg);
    const candidates = await services.activeProject.getProjectCandidates();
    if (candidates.length === 0) {
      void vscode.window.showWarningMessage(t('No workspace projects to switch between.'));
      return;
    }

    if (args?.auto) {
      await services.activeProject.clearPin();
      void vscode.window.showInformationMessage(
        t('Active project: {0}', t('Auto (follow active editor)')),
      );
      return;
    }

    if (args?.rootPath) {
      const target = candidates.find(
        (candidate) =>
          (!args.folderUri || candidate.folderUri === args.folderUri) &&
          (!args.folderPath ||
            path.resolve(candidate.folderPath) === path.resolve(args.folderPath)) &&
          path.resolve(candidate.rootPath) === path.resolve(args.rootPath ?? ''),
      );
      if (!target) {
        void vscode.window.showWarningMessage(
          t('The selected project is no longer in this workspace.'),
        );
        return;
      }
      await services.activeProject.pinProject(target);
      void vscode.window.showInformationMessage(
        t('Active project: {0}', target.projectName ?? path.basename(target.rootPath)),
      );
      return;
    }

    const activeKey = services.activeProject.currentCandidate?.key;
    interface ProjectPickItem extends vscode.QuickPickItem {
      auto?: boolean;
      candidate?: (typeof candidates)[number];
    }
    const items: ProjectPickItem[] = [
      {
        label: `$(sync) ${t('Auto (follow active editor)')}`,
        description: t('Clear the project pin'),
        auto: true,
      },
      ...candidates.map((candidate) => ({
        label: `${candidate.key === activeKey ? '$(check) ' : ''}${
          candidate.projectName ?? path.basename(candidate.rootPath) ?? candidate.folderName
        }`,
        description: [candidate.projectId ?? t('Not registered'), candidate.rootPath]
          .filter(Boolean)
          .join(' · '),
        detail: [candidate.folderName, candidate.isRoot ? t('Workspace root') : t('Nested project')]
          .filter(Boolean)
          .join(' · '),
        candidate,
      })),
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: t('Switch Active Project'),
      placeHolder: t('Choose the project for tasks, specs and project commands'),
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!picked) return;
    if (picked.auto) {
      await services.activeProject.clearPin();
      void vscode.window.showInformationMessage(
        t('Active project: {0}', t('Auto (follow active editor)')),
      );
      return;
    }
    if (!picked.candidate) return;
    await services.activeProject.pinProject(picked.candidate);
    void vscode.window.showInformationMessage(
      t(
        'Active project: {0}',
        picked.candidate.projectName ?? path.basename(picked.candidate.rootPath),
      ),
    );
  });
}
