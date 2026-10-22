import * as vscode from 'vscode';
import { ProjectRow } from '../cli/types';
import { t } from '../t';
import { parseListValue } from '../views/filter-logic';
import { showEnhancedPicker } from '../pickers/enhanced';
import {
  CommandServices,
  RegisterFn,
  confirmDanger,
  extractArgObject,
  extractPayload,
  handleCliError,
  withNotificationProgress,
} from './shared';

/**
 * 项目分组命令族（注册表 project-groups.json）：
 * - `lattice.projects.toggleGrouping`：平铺 / 按分组树切换（持久化 + 上下文键）；
 * - 组节点操作：新建子分组 / 重命名 / 移动 / 移除 / 复制路径（菜单或命令面板，面板内先选组）；
 * - 项目节点「添加到分组…」：树多选 + 新建路径（缺失自动创建）。
 * 程序化参数（集成测试 / 外部调用）：
 *   - toggleGrouping：`{ mode?: 'flat' | 'groups' }`
 *   - create/rename/move/remove/copyPath：`{ groupId?: string; path?: string }`
 *   - assignGroup：`{ projectId?: string; set?: string[] }`
 */

interface GroupRef {
  groupId: string;
  path: string;
}

const CREATE_SENTINEL = '\u0000__create__';

function indentPath(path: string): string {
  return `${'  '.repeat(Math.max(0, path.split('/').length - 1))}${path}`;
}

function groupRefFromArg(arg: unknown): GroupRef | undefined {
  const payload = extractPayload(arg);
  if (payload?.kind === 'projectGroup') return { groupId: payload.groupId, path: payload.path };
  const obj = extractArgObject<{ groupId?: unknown; path?: unknown; ref?: unknown }>(arg);
  if (obj && typeof obj.groupId === 'string') {
    return { groupId: obj.groupId, path: typeof obj.path === 'string' ? obj.path : obj.groupId };
  }
  if (obj && typeof obj.ref === 'string') return { groupId: obj.ref, path: obj.ref };
  return undefined;
}

async function pickGroupRef(
  services: CommandServices,
  title: string,
): Promise<GroupRef | undefined> {
  const paths = await services.data.projectGroupPaths();
  if (paths.length === 0) {
    // 用户主动点击：不去重（每次都有反馈）
    void vscode.window.showWarningMessage(t('No groups yet. Create one first ("New Group…").'));
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    paths.map((path) => ({ label: indentPath(path), path })),
    { title },
  );
  return picked ? { groupId: picked.path, path: picked.path } : undefined;
}

async function resolveGroupRef(
  services: CommandServices,
  arg: unknown,
  title: string,
): Promise<GroupRef | undefined> {
  return groupRefFromArg(arg) ?? (await pickGroupRef(services, title));
}

async function pickProjectForAssign(services: CommandServices): Promise<ProjectRow | undefined> {
  await services.snapshot.ensure(['projects']);
  const items = [...services.snapshot.data.projects]
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
    .map((project) => ({
      label: project.name || project.id,
      description: project.packageNames[0] ?? project.id,
      project,
    }));
  const picked = await showEnhancedPicker(items, {
    title: t('Pick a project'),
    matchOnDetail: true,
  });
  return picked?.project;
}

function groupNameValidation(value: string, allowPath: boolean): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return t('Name is required');
  if (!allowPath && trimmed.includes('/')) return t('Group name cannot contain "/"');
  if (/[,，]/.test(trimmed)) return t('Commas are not allowed');
  return undefined;
}

export function registerProjectGroupCommands(
  services: CommandServices,
  register: RegisterFn,
): void {
  const grouping = services.projectsGrouping;
  if (grouping) {
    register('lattice.projects.toggleGrouping', async (arg?: unknown) => {
      const args = extractArgObject<{ mode?: unknown }>(arg);
      if (args && (args.mode === 'flat' || args.mode === 'groups')) {
        return grouping.set(args.mode);
      }
      const mode = await grouping.toggle();
      // 显式点击反馈（每次都有）
      void vscode.window.showInformationMessage(
        mode === 'groups' ? t('Projects are now grouped by group') : t('Projects are now flat'),
      );
      return mode;
    });
  }

  // ── 新建分组 / 子分组 ──
  register('lattice.project.group.create', async (arg?: unknown) => {
    const parent = groupRefFromArg(arg);
    const name = await vscode.window.showInputBox({
      title: parent
        ? t('New subgroup under "{0}"', parent.path)
        : t('New group (supports a/b/c paths)'),
      prompt: parent
        ? t('Name of the new subgroup')
        : t('Path of the new group, e.g. Work/Frontend'),
      validateInput: (value) => groupNameValidation(value, !parent),
    });
    if (name === undefined) return;
    try {
      const result = await withNotificationProgress(t('Creating group…'), () =>
        services.data.projectGroupCreate(parent?.path ?? null, name.trim()),
      );
      await services.snapshot.invalidate(['projects']);
      if (result) void vscode.window.showInformationMessage(t('Group created: {0}', result.path));
    } catch (error) {
      await handleCliError(error, t('Failed to create the group'));
    }
  });

  // ── 重命名 ──
  register('lattice.project.group.rename', async (arg?: unknown) => {
    const ref = await resolveGroupRef(services, arg, t('Pick a group to rename'));
    if (!ref) return;
    const currentName = ref.path.split('/').pop() ?? ref.path;
    const name = await vscode.window.showInputBox({
      title: t('Rename group'),
      prompt: t('New name for "{0}"', ref.path),
      value: currentName,
      validateInput: (value) => groupNameValidation(value, false),
    });
    if (name === undefined || name.trim() === currentName) return;
    try {
      const impact = await services.data.projectGroupImpact(ref.groupId);
      if (impact.projectCount > 0) {
        const confirmed = await confirmDanger(
          t('Rename group "{0}" to "{1}"?', impact.path, name.trim()),
          t('{0} project(s) will show the new path.', String(impact.projectCount)),
          t('Rename'),
        );
        if (!confirmed) return;
      }
      const result = await services.data.projectGroupRename(ref.groupId, name.trim());
      await services.snapshot.invalidate(['projects']);
      void vscode.window.showInformationMessage(
        t(
          'Group renamed: {0} → {1} ({2} project(s) updated)',
          impact.path,
          result.path,
          String(result.affectedProjects),
        ),
      );
    } catch (error) {
      await handleCliError(error, t('Failed to rename the group'));
    }
  });

  // ── 移动 ──
  register('lattice.project.group.move', async (arg?: unknown) => {
    const ref = await resolveGroupRef(services, arg, t('Pick a group to move'));
    if (!ref) return;
    const paths = await services.data.projectGroupPaths();
    const targets = paths.filter((path) => path !== ref.path && !path.startsWith(`${ref.path}/`));
    interface TargetItem extends vscode.QuickPickItem {
      value?: string | null;
    }
    const items: TargetItem[] = [
      { label: `$(root-folder) ${t('(Root)')}`, value: null },
      ...targets.map((path) => ({ label: indentPath(path), value: path })),
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: t('Move "{0}" to…', ref.path),
    });
    if (!picked) return;
    const targetPath = picked.value ?? null;
    try {
      const impact = await services.data.projectGroupImpact(ref.groupId);
      if (impact.projectCount > 0) {
        const confirmed = await confirmDanger(
          t('Move group "{0}" to "{1}"?', impact.path, targetPath ?? t('(Root)')),
          t('{0} project(s) will show the new path.', String(impact.projectCount)),
          t('Move'),
        );
        if (!confirmed) return;
      }
      const result = await services.data.projectGroupMove(ref.groupId, targetPath);
      await services.snapshot.invalidate(['projects']);
      void vscode.window.showInformationMessage(t('Group moved: {0}', result.path));
    } catch (error) {
      await handleCliError(error, t('Failed to move the group'));
    }
  });

  // ── 移除（子树 + 项目引用剥离） ──
  register('lattice.project.group.remove', async (arg?: unknown) => {
    const ref = await resolveGroupRef(services, arg, t('Pick a group to remove'));
    if (!ref) return;
    try {
      const impact = await services.data.projectGroupImpact(ref.groupId);
      const confirmed = await confirmDanger(
        t('Remove group "{0}" and its {1} subgroup(s)?', impact.path, String(impact.subgroupCount)),
        t(
          '{0} project(s) will lose this group reference. This cannot be undone.',
          String(impact.projectCount),
        ),
        t('Remove'),
      );
      if (!confirmed) return;
      const result = await services.data.projectGroupRemove(ref.groupId);
      await services.snapshot.invalidate(['projects']);
      void vscode.window.showInformationMessage(
        t(
          'Group removed: {0} node(s), {1} project(s) updated',
          String(result.removedCount),
          String(result.affectedProjects),
        ),
      );
    } catch (error) {
      await handleCliError(error, t('Failed to remove the group'));
    }
  });

  // ── 复制分组路径 ──
  register('lattice.project.group.copyPath', async (arg?: unknown) => {
    const ref = await resolveGroupRef(services, arg, t('Pick a group'));
    if (!ref) return;
    await vscode.env.clipboard.writeText(ref.path);
    void vscode.window.showInformationMessage(t('Group path copied: {0}', ref.path));
  });

  // ── 项目「添加到分组…」 ──
  register('lattice.project.assignGroup', async (arg?: unknown) => {
    const payload = extractPayload(arg);
    const obj = extractArgObject<{ projectId?: unknown; set?: unknown }>(arg);
    let projectId: string | undefined =
      payload?.kind === 'project' || payload?.kind === 'currentProject'
        ? payload.projectId
        : undefined;
    if (!projectId && obj && typeof obj.projectId === 'string') projectId = obj.projectId;
    await services.snapshot.ensure(['projects']);
    let project = projectId ? services.snapshot.findProject(projectId) : undefined;
    if (!project) project = await pickProjectForAssign(services);
    if (!project) return;

    // 程序化分支：直接 set（集成测试 / 外部调用）
    if (obj && Array.isArray(obj.set)) {
      const result = await services.data.projectGroupsUpdate(project.id, {
        set: obj.set.filter((value): value is string => typeof value === 'string'),
      });
      await services.snapshot.invalidate(['projects']);
      return result;
    }

    const paths = await services.data.projectGroupPaths();
    const current = new Set(parseListValue(project.groups));
    interface GroupItem extends vscode.QuickPickItem {
      value?: string;
    }
    const items: GroupItem[] = [
      { label: `$(plus) ${t('Add new path…')}`, value: CREATE_SENTINEL },
      ...paths.map((path) => ({
        label: indentPath(path),
        picked: current.has(path),
        value: path,
      })),
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: t('Groups of "{0}" (multi-select; uncheck to remove)', project.name || project.id),
      canPickMany: true,
    });
    if (picked === undefined) return;
    let extra: string[] = [];
    if (picked.some((item) => item.value === CREATE_SENTINEL)) {
      const raw = await vscode.window.showInputBox({
        title: t('New group path(s), comma separated'),
        prompt: t('Missing paths are created automatically'),
        placeHolder: t('e.g. Work/Frontend'),
      });
      if (raw === undefined) return;
      extra = raw
        .split(/[,，]/)
        .map((value) => value.trim())
        .filter(Boolean);
    }
    const selected = [
      ...picked
        .filter((item) => item.value && item.value !== CREATE_SENTINEL)
        .map((item) => item.value as string),
      ...extra,
    ];
    try {
      const result = await withNotificationProgress(t('Updating groups…'), () =>
        services.data.projectGroupsUpdate(project.id, { set: selected }),
      );
      await services.snapshot.invalidate(['projects']);
      const created = result?.createdPaths ?? [];
      const summary = selected.length > 0 ? selected.join(', ') : t('(None)');
      // 显式点击反馈（每次都有）
      void vscode.window.showInformationMessage(
        created.length > 0
          ? t('Groups updated: {0} (created: {1})', summary, created.join(', '))
          : t('Groups updated: {0}', summary),
      );
    } catch (error) {
      await handleCliError(error, t('Failed to update the groups'));
    }
  });
}
