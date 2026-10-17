import * as vscode from 'vscode';
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

function openInOs(path: string | undefined): void {
  if (!path) {
    void showDeduped('warn', t('No local path recorded for this project.'));
    return;
  }
  void vscode.env.openExternal(vscode.Uri.file(path));
}

export function registerProjectCommands(services: CommandServices, register: RegisterFn): void {
  register('lattice.project.open', async (arg?: unknown) => {
    const project = await resolveProject(services, arg);
    if (!project) return;
    openInOs(project.localPaths[0]);
  });

  register('lattice.project.openFolder', async (arg?: unknown) => {
    const project = await resolveProject(services, arg);
    if (!project?.localPaths[0]) {
      void showDeduped('warn', t('No local path recorded for this project.'));
      return;
    }
    await vscode.commands.executeCommand(
      'vscode.openFolder',
      vscode.Uri.file(project.localPaths[0]),
      {
        forceNewWindow: true,
      },
    );
  });

  register('lattice.project.copyId', async (arg?: unknown) => {
    const projectId = projectIdFrom(services, arg) ?? (await pickProject(services))?.id;
    if (!projectId) return;
    await vscode.env.clipboard.writeText(projectId);
    void showDeduped('info', t('Copied: {0}', projectId));
  });

  register('lattice.project.copyPath', async (arg?: unknown) => {
    const project = await resolveProject(services, arg);
    const path = project?.localPaths[0];
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
    try {
      await withNotificationProgress(t('Updating project…'), () =>
        services.data.projectUpdate(project.id, {
          name: name.trim(),
          description: description.trim(),
          tags: tagsRaw
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean),
        }),
      );
      await services.snapshot.invalidate(['projects']);
      void showDeduped('info', t('Project updated: {0}', name.trim() || project.id));
    } catch (error) {
      await handleCliError(error, t('Failed to update the project'));
    }
  });

  register('lattice.project.switchActive', async () => {
    const candidates = services.activeProject.folderCandidates;
    if (candidates.length === 0) {
      void showDeduped('warn', t('No workspace folders to switch between.'));
      return;
    }
    interface FolderPickItem extends vscode.QuickPickItem {
      folderUri?: string;
    }
    const items: FolderPickItem[] = candidates.map((candidate) => ({
      label: candidate.folder.name,
      description: candidate.anchorRoot ?? candidate.folder.uri.fsPath,
      folderUri: candidate.folder.uri.toString(),
    }));
    items.unshift({ label: t('(Auto)'), description: t('Follow the active editor') });
    const picked = await vscode.window.showQuickPick(items, { title: t('Switch Active Project') });
    if (!picked) return;
    const folder = picked.folderUri
      ? vscode.workspace.workspaceFolders?.find((f) => f.uri.toString() === picked.folderUri)
      : undefined;
    await services.activeProject.pinFolder(folder);
    void showDeduped('info', t('Active project: {0}', picked.label));
  });
}
