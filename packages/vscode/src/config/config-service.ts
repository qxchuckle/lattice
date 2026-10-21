import * as vscode from 'vscode';
import { stat } from 'node:fs/promises';
import * as path from 'node:path';
import {
  CORE_VERSION,
  addRemote,
  commitAll,
  domainHashOf,
  getDbPath,
  getDefaultEmbeddingConfig,
  getDefaultGlobalConfig,
  getDefaultLocalConfig,
  getEmbeddingConfig,
  getGitStatus,
  getGlobalConfigPath,
  getLatticeRoot,
  getLocalConfigPath,
  initLatticeGit,
  joinDomain,
  listDomains,
  listRemotes,
  previewContribution,
  pullRebase,
  pushGit,
  readBaseline,
  readGlobalConfig,
  readLocalConfig,
  readSyncDomains,
  removeRemote,
  resolveDomainRef,
  setRemoteUrl,
  syncAll,
  syncDomains,
  unlinkDomain,
  updateDomain,
  writeLocalConfig,
  writeSyncDomains,
} from '@qcqx/lattice-core';
import type {
  GitRemoteInfo,
  LatticeGitStatus,
  RAGStatus,
  SyncDomainConfig,
} from '@qcqx/lattice-core';
import {
  applyConfigPatch,
  currentUsername,
  listUsers,
  registerProjectAtPath,
  scanProjects,
} from '@qcqx/lattice-services';
import type {
  ConfigCoreState,
  ConfigDomainInfo,
  ConfigDraftSnapshot,
  ConfigGitOperation,
  ConfigProgressEvent,
  ConfigProjectRow,
  ConfigRegisterPayload,
  ConfigRegisterResult,
  ConfigRagPayload,
  ConfigSavePayload,
  ConfigSaveResult,
  ConfigScanResult,
  ConfigSettingsState,
  ConfigStatePayload,
  ConfigSyncOperation,
  ConfigUpdateProjectPayload,
  ConfigUserOperation,
  ConfigWorkspaceProject,
  ConfigWorkspaceState,
} from '@qcqx/lattice-protocol';
import type { CommandServices } from '../commands/shared';
import { t } from '../t';
import { findGitRoot } from '../util/git-root';
import { findLatticeAnchor } from '../util/paths';
import { isPathInsideOrEqual } from '../state/project-context-logic';
import type { ProjectCandidate } from '../state/project-context-logic';
import { VSCODE_FIELDS, isKnownVscodeSetting, vscodeConfigKey } from '../../shared/config-schema';

const EMPTY_GIT_STATUS: LatticeGitStatus = {
  initialized: false,
  remote: null,
  hasChanges: false,
  changedFiles: [],
  branch: null,
  aheadCount: 0,
  behindCount: 0,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Merge the effective embedding values into the global config for form display. */
function mergeEmbeddingIntoGlobal(
  base: Record<string, unknown>,
  embedding: Record<string, unknown>,
  preferBase = false,
): Record<string, unknown> {
  const rag = asRecord(base.rag);
  const embeddingBase = asRecord(rag.embedding);
  return {
    ...base,
    rag: {
      ...rag,
      embedding: preferBase
        ? { ...embedding, ...embeddingBase }
        : { ...embeddingBase, ...embedding },
    },
  };
}

function splitCsv(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function projectRow(project: {
  id: string;
  ids?: string[];
  name: string;
  description?: string | null;
  localPaths?: string[];
  gitRemotes?: string[];
  groups?: string | null;
  groupIds?: string[];
  tags?: string | null;
  updated?: string | null;
}): ConfigProjectRow {
  return {
    id: project.id,
    ids: project.ids ?? [],
    name: project.name,
    description: project.description ?? null,
    localPaths: project.localPaths ?? [],
    gitRemotes: project.gitRemotes ?? [],
    groups: splitCsv(project.groups),
    groupIds: project.groupIds ?? [],
    tags: splitCsv(project.tags),
    updated: project.updated ?? null,
  };
}

function domainInfo(domain: Awaited<ReturnType<typeof listDomains>>[number]): ConfigDomainInfo {
  return {
    hash: domain.hash,
    remote: domain.remote,
    branch: domain.branch,
    label: domain.label,
    use: domain.use,
    routes: domain.routes,
    pushState: domain.pushState,
    mirrorExists: domain.mirrorExists,
    lastPushAt: domain.lastPushAt,
    priority: domain.priority,
    lastSync: domain.lastSync,
    stats: domain.stats,
  };
}

function workspaceStateOf(
  candidate: ProjectCandidate,
  registeredRoots: readonly string[],
): ConfigWorkspaceState['state'] {
  if (candidate.projectId) {
    return candidate.anchorRoot ? 'registered' : 'registered-via-git';
  }
  if (candidate.anchorRoot) {
    const nested = registeredRoots.some(
      (root) => root !== candidate.rootPath && isPathInsideOrEqual(root, candidate.rootPath),
    );
    return nested ? 'nested' : 'unregistered-anchor';
  }
  return candidate.gitRoot ? 'unregistered-git' : 'unregistered-no-anchor';
}

/**
 * 配置中心宿主服务：组合 core/services 与 VS Code API。
 *
 * 所有写操作集中在这里；Webview 只提交意图，不直接触碰文件系统。
 */
export class ConfigService implements vscode.Disposable {
  private readonly progressEmitter = new vscode.EventEmitter<ConfigProgressEvent>();
  readonly onProgress = this.progressEmitter.event;
  private scanController: AbortController | undefined;

  constructor(private readonly services: CommandServices) {}

  dispose(): void {
    this.scanController?.abort();
    this.progressEmitter.dispose();
  }

  private emitProgress(event: ConfigProgressEvent): void {
    this.progressEmitter.fire(event);
  }

  private async username(): Promise<string> {
    try {
      const name = await this.services.data.username();
      if (name) return name;
    } catch {
      // 未初始化时 data.username() 会抛错；继续尝试直接读本机配置。
    }
    try {
      return await currentUsername();
    } catch {
      return '';
    }
  }

  /** 写操作需要有效用户；未初始化时给出明确错误，而不是写到 users// 下。 */
  private async requireUsername(): Promise<string> {
    const name = await this.username();
    if (!name) throw new Error(t('Lattice is not initialized yet.'));
    return name;
  }

  private assertWritable(): void {
    if (this.services.userScope?.browseUser) {
      throw new Error(
        t(
          'Cannot modify while browsing user "{0}" (read-only). Exit browsing first.',
          this.services.userScope.browseUser,
        ),
      );
    }
  }

  // ── 状态读取 ──

  async getState(): Promise<ConfigStatePayload> {
    const local = await readLocalConfig().catch(() => null);
    const initialized = Boolean(local?.username);
    const username = await this.username();

    await this.services.snapshot.ensure(['user', 'projects', 'tasks', 'specs']);
    const snapshot = this.services.snapshot.data;

    const [
      globalConfig,
      globalDefaults,
      localDefaults,
      dbSizeKB,
      rag,
      git,
      remotes,
      domains,
      embeddingConfig,
    ] = await Promise.all([
      readGlobalConfig().catch(() => ({ version: '0.1.0' })),
      Promise.resolve(readGlobalConfigDefaults()),
      Promise.resolve(readLocalConfigDefaults()),
      getDbSizeKB(),
      this.services.data.ragStatus().catch(() => null),
      getGitStatus().catch(() => EMPTY_GIT_STATUS),
      listRemotes().catch(() => [] as GitRemoteInfo[]),
      listDomains().catch(() => []),
      getEmbeddingConfig().catch(() => null),
    ]);

    const projects = snapshot.projects.map(projectRow);
    const specCount =
      snapshot.specs.project.length + snapshot.specs.user.length + snapshot.specs.global.length;
    const workspace = await this.readWorkspaceStates();
    const settings = this.readSettings();
    // 永远不要把 webAuth（密码哈希 / JWT secret）送进 Webview；只暴露配置页可编辑的普通字段。
    const { webAuth: _webAuth, ...safeLocal } = asRecord(local);
    const globalRecord = asRecord(globalConfig);
    const defaultRecord = asRecord(globalDefaults);
    const core: ConfigCoreState = {
      global: globalRecord,
      local: safeLocal,
      globalDefaults: mergeEmbeddingIntoGlobal(
        defaultRecord,
        getDefaultEmbeddingConfig() as unknown as Record<string, unknown>,
        true,
      ),
      localDefaults: asRecord(localDefaults),
      globalEffective: mergeEmbeddingIntoGlobal(globalRecord, asRecord(embeddingConfig), false),
    };

    return {
      initialized,
      runtime: {
        extensionVersion: String(this.services.context.extension.packageJSON.version ?? 'dev'),
        coreVersion: CORE_VERSION,
        vscodeVersion: vscode.version,
        nodeVersion: process.version,
        platform: `${process.platform} ${process.arch}`,
        root: getLatticeRoot(),
        initialized,
        configPaths: {
          global: getGlobalConfigPath(),
          local: getLocalConfigPath(),
        },
        db: {
          driver: this.services.data.dbStatus().driver,
          available: this.services.data.dbStatus().available,
          error: this.services.data.dbStatus().error,
          path: getDbPath(),
          sizeKB: dbSizeKB,
        },
        watcher: {
          healthy: this.services.watcher?.healthy ?? false,
          autoRefresh: vscode.workspace.getConfiguration('lattice').get('autoRefresh', true),
          fallbackPollMs: vscode.workspace
            .getConfiguration('lattice')
            .get('fallbackPollMs', 30_000),
        },
      },
      user: username,
      users: await listUsers().catch(() => (username ? [username] : [])),
      stats: {
        projectCount: projects.length,
        taskCount: snapshot.tasks.length,
        activeTaskCount: snapshot.tasks.filter((task) => task.status === 'in_progress').length,
        specCount,
        relationCount: snapshot.relations.length,
      },
      rag: rag ? (rag as unknown as RAGStatus) : null,
      settings,
      core,
      workspace,
      projects,
      groupPaths: await this.services.data.projectGroupPaths().catch(() => [] as string[]),
      git: { status: git, remotes },
      domains: domains.map(domainInfo),
      errors: { ...snapshot.errors },
    };
  }

  private readSettings(): ConfigSettingsState {
    const configuration = vscode.workspace.getConfiguration('lattice');
    const values: Record<string, unknown> = {};
    const defaults: Record<string, unknown> = {};
    const sources: Record<string, 'user' | 'workspace' | 'workspaceFolder' | 'default'> = {};

    for (const field of VSCODE_FIELDS) {
      const key = vscodeConfigKey(field.key);
      const inspected = configuration.inspect(key);
      values[field.key] = configuration.get(key);
      defaults[field.key] = inspected?.defaultValue ?? field.default ?? null;
      if (inspected?.workspaceFolderValue !== undefined) {
        sources[field.key] = 'workspaceFolder';
      } else if (inspected?.workspaceValue !== undefined) {
        sources[field.key] = 'workspace';
      } else if (inspected?.globalValue !== undefined) {
        sources[field.key] = 'user';
      } else {
        sources[field.key] = 'default';
      }
    }

    return {
      target: vscode.workspace.workspaceFolders?.length ? 'workspace' : 'user',
      values,
      defaults,
      sources,
    };
  }

  private async readWorkspaceStates(): Promise<ConfigWorkspaceState[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const candidates = await this.services.activeProject.getProjectCandidates();
    const activeKey = this.services.activeProject.currentCandidate?.key;
    const registeredRoots = this.services.snapshot.data.projects.flatMap(
      (project) => project.localPaths,
    );
    const states: ConfigWorkspaceState[] = [];
    for (const folder of folders) {
      const folderPath = folder.uri.fsPath;
      const folderCandidates = candidates.filter(
        (candidate) => candidate.folderUri === folder.uri.toString(),
      );
      const projects: ConfigWorkspaceProject[] = folderCandidates.map((candidate) => ({
        folder: folderPath,
        name: candidate.projectName || path.basename(candidate.rootPath) || folder.name,
        path: candidate.rootPath,
        anchorRoot: candidate.anchorRoot,
        gitRoot: candidate.gitRoot,
        projectId: candidate.projectId,
        projectName: candidate.projectName,
        state: workspaceStateOf(candidate, registeredRoots),
        targetPath: candidate.rootPath,
        isRoot: candidate.isRoot,
        active: candidate.key === activeKey,
      }));
      const root = projects.find((project) => project.isRoot) ?? projects[0];
      states.push({
        folder: folderPath,
        name: folder.name,
        anchorRoot: root?.anchorRoot ?? null,
        gitRoot: root?.gitRoot ?? null,
        projectId: root?.projectId ?? null,
        projectName: root?.projectName ?? null,
        state: root?.state ?? 'unregistered-no-anchor',
        targetPath: root?.targetPath ?? folderPath,
        projects,
      });
    }
    return states;
  }

  // ── 配置保存 ──

  async save(payload: ConfigSavePayload): Promise<ConfigSaveResult> {
    this.assertWritable();
    const changedKeys: string[] = [];
    const warnings: string[] = [];
    let requiresReload = false;
    let requiresRagRebuild = false;

    const vscodePayload = payload.vscode;
    if (vscodePayload) {
      const target =
        vscodePayload.target === 'workspace'
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global;
      if (vscodePayload.target === 'workspace' && !vscode.workspace.workspaceFolders?.length) {
        throw new Error(t('No workspace is open; cannot write workspace settings.'));
      }
      if (vscodePayload.target === 'workspace' && !vscode.workspace.isTrusted) {
        throw new Error(
          t('This workspace is not trusted; use user settings or trust the workspace first.'),
        );
      }
      const configuration = vscode.workspace.getConfiguration('lattice');
      for (const key of Object.keys(vscodePayload.set ?? {})) {
        if (!isKnownVscodeSetting(key)) throw new Error(`Unknown setting: ${key}`);
        await configuration.update(vscodeConfigKey(key), vscodePayload.set?.[key], target);
        changedKeys.push(key);
        if (key === 'lattice.latticeHome') requiresReload = true;
      }
      for (const key of vscodePayload.unset ?? []) {
        if (!isKnownVscodeSetting(key)) throw new Error(`Unknown setting: ${key}`);
        await configuration.update(vscodeConfigKey(key), undefined, target);
        changedKeys.push(key);
        if (key === 'lattice.latticeHome') requiresReload = true;
      }
    }

    if (payload.global) {
      const result = await applyConfigPatch('global', payload.global);
      changedKeys.push(...result.changedKeys);
      warnings.push(...result.warnings);
      requiresRagRebuild ||= result.requiresRagRebuild;
    }
    if (payload.local) {
      const result = await applyConfigPatch('local', payload.local);
      changedKeys.push(...result.changedKeys);
      warnings.push(...result.warnings);
      requiresRagRebuild ||= result.requiresRagRebuild;
    }

    if (changedKeys.length > 0) {
      await this.services.activeProject.refresh();
      await this.services.snapshot.invalidate(['projects'], { reload: true });
    }

    return {
      changedKeys: [...new Set(changedKeys)],
      warnings: [...new Set(warnings)],
      requiresReload,
      requiresRagRebuild,
    };
  }

  // ── 项目 / 扫描 ──

  async scan(dirs: string[], saveAsDefault = false): Promise<ConfigScanResult> {
    this.assertWritable();
    if (this.scanController) throw new Error(t('A scan is already running.'));
    const cleanDirs = [...new Set(dirs.map((dir) => dir.trim()).filter(Boolean))];
    if (cleanDirs.length === 0) throw new Error(t('Add at least one directory to scan.'));

    const username = await this.requireUsername();
    const controller = new AbortController();
    this.scanController = controller;
    this.emitProgress({ kind: 'scan', phase: 'start', message: t('Scanning projects…') });

    try {
      const result = await scanProjects(
        username,
        cleanDirs,
        (progress) => {
          this.emitProgress({
            kind: 'scan',
            phase: 'progress',
            currentDir: progress.currentDir,
            found: progress.found,
            added: progress.added,
            updated: progress.updated,
          });
        },
        controller.signal,
      );

      if (saveAsDefault) {
        const local = await readLocalConfig();
        if (local) await writeLocalConfig({ ...local, scanDirs: cleanDirs });
      }

      await this.services.snapshot.invalidate(['projects'], { reload: true });
      await this.services.activeProject.refresh();
      this.emitProgress({
        kind: 'scan',
        phase: 'done',
        added: result.added.length,
        updated: result.updated.length,
      });
      return result;
    } catch (error) {
      if ((error as Error)?.name === 'AbortError' || controller.signal.aborted) {
        this.emitProgress({ kind: 'scan', phase: 'canceled', message: t('Scan canceled.') });
        return { added: [], updated: [], canceled: true };
      }
      this.emitProgress({
        kind: 'scan',
        phase: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      if (this.scanController === controller) this.scanController = undefined;
    }
  }

  cancelScan(): void {
    this.scanController?.abort();
  }

  async registerProject(payload: ConfigRegisterPayload): Promise<ConfigRegisterResult> {
    this.assertWritable();
    const base = path.resolve(payload.path);
    const anchorRoot = await findLatticeAnchor(base);
    const gitRoot = await findGitRoot(base);
    // 默认优先使用已有锚点；没有锚点再用 Git 根；都没有才回落到当前目录。
    const target = payload.target === 'folder' ? base : (anchorRoot ?? gitRoot ?? base);
    if (!anchorRoot && !gitRoot && !payload.createAnchor) {
      throw new Error(
        t('This directory is not a Git repository. Enable "create lattice.json" to register it.'),
      );
    }

    const result = await registerProjectAtPath(await this.requireUsername(), target, {
      createAnchor: payload.createAnchor,
      name: payload.name,
    });
    await this.services.snapshot.invalidate(['projects'], { reload: true });
    await this.services.activeProject.refresh();
    return result;
  }

  /** 命令面板「注册当前项目」：优先当前活动项目根，否则选择 workspace folder。 */
  async registerCurrentInteractive(): Promise<ConfigRegisterResult | undefined> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      void vscode.window.showWarningMessage(t('Open a workspace folder first.'));
      return undefined;
    }

    const active = this.services.activeProject.currentCandidate;
    let folder = active
      ? folders.find((item) => item.uri.toString() === active.folderUri)
      : undefined;
    if (!folder && active) {
      void vscode.window.showWarningMessage(
        t('The active project is no longer in this workspace.'),
      );
      return undefined;
    }
    if (!folder) {
      folder = folders[0];
      if (folders.length > 1) {
        const picked = await vscode.window.showQuickPick(
          folders.map((item) => ({ label: item.name, description: item.uri.fsPath, folder: item })),
          { title: t('Register Current Project') },
        );
        if (!picked) return undefined;
        folder = picked.folder;
      }
    }

    const basePath = active?.rootPath ?? folder.uri.fsPath;
    const anchorRoot = active?.anchorRoot ?? (await findLatticeAnchor(basePath));
    const gitRoot = active?.gitRoot ?? (await findGitRoot(basePath));
    const targetPath = active?.rootPath ?? anchorRoot ?? gitRoot ?? folder.uri.fsPath;
    const nested = targetPath !== gitRoot;
    const defaultTarget: 'git-root' | 'folder' = nested ? 'folder' : 'git-root';
    interface PickItem extends vscode.QuickPickItem {
      createAnchor: boolean;
      target: 'git-root' | 'folder';
    }
    const items: PickItem[] = [];
    if (anchorRoot) {
      items.push({
        label: `$(link) ${t('Register only (recommended)')}`,
        description: targetPath,
        detail: active?.projectId
          ? t('Already registered; updates the local path for this project.')
          : t('Uses the existing lattice.json anchor.'),
        createAnchor: false,
        target: 'folder',
      });
    } else if (gitRoot) {
      items.push({
        label: `$(link) ${t('Register only (recommended)')}`,
        description: targetPath,
        detail: nested
          ? t(
              'Registers this nested project root with the Git fingerprint; no lattice.json is written.',
            )
          : t('Uses the Git fingerprint. Does not write lattice.json.'),
        createAnchor: false,
        target: defaultTarget,
      });
      items.push({
        label: `$(new-file) ${t('Register and create lattice.json')}`,
        description: targetPath,
        detail: t('Writes a project anchor at this project root.'),
        createAnchor: true,
        target: 'folder',
      });
      if (nested) {
        items.push({
          label: `$(folder) ${t('Register the parent Git project')}`,
          description: gitRoot,
          detail: t('Adds this workspace folder to the repository-level project.'),
          createAnchor: false,
          target: 'git-root',
        });
      } else if (folder.uri.fsPath !== gitRoot) {
        items.push({
          label: `$(folder) ${t('Register this workspace folder')}`,
          description: folder.uri.fsPath,
          detail: t('Adds this folder as a local path of the same Git project.'),
          createAnchor: false,
          target: 'folder',
        });
        items.push({
          label: `$(new-file) ${t('Register this folder as a nested project')}`,
          description: folder.uri.fsPath,
          detail: t('Creates a nested lattice.json anchor project for this folder.'),
          createAnchor: true,
          target: 'folder',
        });
      }
    } else {
      items.push({
        label: `$(new-file) ${t('Create lattice.json and register')}`,
        description: targetPath,
        detail: t('Non-Git directories need an anchor file.'),
        createAnchor: true,
        target: 'folder',
      });
    }

    const picked = await vscode.window.showQuickPick(items, {
      title: t('Register Current Project'),
      placeHolder: active?.projectName
        ? t('Choose how to register {0}', active.projectName)
        : t('Choose how to register this project'),
    });
    if (!picked) return undefined;

    try {
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: t('Registering project…'),
          cancellable: false,
        },
        () =>
          this.registerProject({
            path: basePath,
            target: picked.target,
            createAnchor: picked.createAnchor,
          }),
      );
      void vscode.window.showInformationMessage(
        t('Project registered: {0} ({1})', result.projectName, result.projectId),
      );
      return result;
    } catch (error) {
      void vscode.window.showErrorMessage(
        t('Register project failed: {0}', error instanceof Error ? error.message : String(error)),
      );
      return undefined;
    }
  }

  async updateProject(payload: ConfigUpdateProjectPayload): Promise<void> {
    this.assertWritable();
    await this.requireUsername();
    await this.services.data.projectUpdate(payload.id, {
      ...(payload.name !== undefined ? { name: payload.name } : {}),
      ...(payload.description !== undefined ? { description: payload.description } : {}),
      ...(payload.tags !== undefined ? { tags: payload.tags } : {}),
    });
    if (payload.groups !== undefined) {
      await this.services.data.projectGroupsUpdate(payload.id, { set: payload.groups });
    }
    await this.services.snapshot.invalidate(['projects'], { reload: true });
    await this.services.activeProject.refresh();
  }

  // ── 维护操作 ──

  async runRag(payload: ConfigRagPayload): Promise<number> {
    this.assertWritable();
    this.emitProgress({
      kind: 'rag',
      phase: 'start',
      message: payload.action === 'rebuild' ? t('Rebuilding index…') : t('Updating index…'),
    });
    try {
      const count = await this.services.data.ragIndex(payload.action, {
        onProgress: (progress) => {
          this.emitProgress({
            kind: 'rag',
            phase: 'progress',
            current: progress.current,
            total: progress.total,
            message: progress.currentFile,
          });
        },
      });
      this.emitProgress({
        kind: 'rag',
        phase: 'done',
        message: t('Indexed {0} document(s).', count),
      });
      return count;
    } catch (error) {
      this.emitProgress({
        kind: 'rag',
        phase: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async runDoctor(fix = false): Promise<unknown> {
    if (fix) this.assertWritable();
    this.emitProgress({
      kind: 'doctor',
      phase: 'start',
      message: fix ? t('Running health check (fix)…') : t('Running health check…'),
    });
    try {
      const report = await this.services.data.doctor({ fix });
      this.emitProgress({ kind: 'doctor', phase: 'done' });
      return report;
    } catch (error) {
      this.emitProgress({
        kind: 'doctor',
        phase: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ── Git ──

  async gitOperation(payload: ConfigGitOperation): Promise<unknown> {
    this.assertWritable();
    this.emitProgress({ kind: 'git', phase: 'start', message: t('Git operation…') });
    try {
      let result: unknown;
      switch (payload.op) {
        case 'commit':
          result = await commitAll(payload.message);
          break;
        case 'pull':
          result = await pullRebase();
          break;
        case 'push':
          result = await pushGit();
          break;
        case 'sync':
          result = await syncAll();
          break;
        case 'init':
          result = await initLatticeGit(getLatticeRoot(), payload.remote);
          break;
        case 'remote-add':
          result = await addRemote(payload.name, payload.url);
          break;
        case 'remote-set':
          result = await setRemoteUrl(payload.name, payload.url);
          break;
        case 'remote-remove':
          result = await removeRemote(payload.name);
          break;
      }
      // 单步 Git 操作以 { success:false, message } 表达失败；转成错误让 UI 显示 failure toast。
      if (
        payload.op !== 'sync' &&
        result &&
        typeof result === 'object' &&
        (result as { success?: boolean }).success === false
      ) {
        throw new Error((result as { message?: string }).message ?? 'Git operation failed');
      }
      await this.services.snapshot.invalidate(['projects'], { reload: true });
      this.emitProgress({ kind: 'git', phase: 'done' });
      return result;
    } catch (error) {
      this.emitProgress({
        kind: 'git',
        phase: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ── 同步域 ──

  async syncOperation(payload: ConfigSyncOperation): Promise<unknown> {
    this.assertWritable();
    this.emitProgress({ kind: 'sync', phase: 'start', message: t('Syncing domains…') });
    try {
      let result: unknown;
      switch (payload.op) {
        case 'join': {
          const domain: SyncDomainConfig = {
            remote: payload.remote,
            branch: payload.branch,
            label: payload.label,
            use: payload.use as SyncDomainConfig['use'],
            routes: payload.routes,
          };
          result = await joinDomain(domain, await this.requireUsername());
          break;
        }
        case 'update':
          result = await updateDomain(payload.hash, {
            ...(payload.remote ? { remote: payload.remote } : {}),
            ...(payload.branch ? { branch: payload.branch } : {}),
            ...(payload.label !== undefined ? { label: payload.label || undefined } : {}),
            ...(payload.use !== undefined ? { use: payload.use as SyncDomainConfig['use'] } : {}),
            ...(payload.routes !== undefined ? { routes: payload.routes } : {}),
          });
          break;
        case 'unlink':
          result = await unlinkDomain(payload.hash);
          break;
        case 'reorder': {
          const domains = await readSyncDomains();
          const byHash = new Map(domains.map((domain) => [domainHashOf(domain), domain]));
          const next: SyncDomainConfig[] = [];
          for (const hash of payload.hashes) {
            const domain = byHash.get(hash);
            if (!domain) throw new Error(`未找到同步域：${hash}`);
            next.push(domain);
            byHash.delete(hash);
          }
          for (const domain of byHash.values()) next.push(domain);
          await writeSyncDomains(next);
          result = { ok: true, count: next.length };
          break;
        }
        case 'sync':
          result = await syncDomains(await this.requireUsername());
          break;
        case 'preview': {
          const resolved = await resolveDomainRef(payload.hash);
          if (resolved.error || resolved.domain === undefined) {
            throw new Error(resolved.error ?? '未找到同步域');
          }
          const hash = domainHashOf(resolved.domain);
          const baseline = await readBaseline(hash);
          result = await previewContribution(
            await this.requireUsername(),
            payload.routes,
            baseline?.paths ?? [],
          );
          break;
        }
      }
      this.emitProgress({ kind: 'sync', phase: 'done' });
      return result;
    } catch (error) {
      this.emitProgress({
        kind: 'sync',
        phase: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ── 草稿（面板关闭后恢复）──

  private static readonly DRAFT_KEY = 'lattice.config.draft';

  async getConfigDraft(): Promise<ConfigDraftSnapshot | null> {
    const snapshot = this.services.context.workspaceState.get<ConfigDraftSnapshot>(
      ConfigService.DRAFT_KEY,
    );
    return snapshot ?? null;
  }

  async saveConfigDraft(payload: {
    draft: unknown;
    settingsTarget: ConfigDraftSnapshot['settingsTarget'];
  }): Promise<ConfigDraftSnapshot> {
    const text = JSON.stringify(payload);
    if (text.length > 256_000) throw new Error(t('Config draft is too large to persist.'));
    const snapshot: ConfigDraftSnapshot = {
      draft: payload.draft,
      settingsTarget: payload.settingsTarget,
      savedAt: new Date().toISOString(),
    };
    await this.services.context.workspaceState.update(ConfigService.DRAFT_KEY, snapshot);
    return snapshot;
  }

  async clearConfigDraft(): Promise<void> {
    await this.services.context.workspaceState.update(ConfigService.DRAFT_KEY, undefined);
  }

  // ── 用户 ──

  async userOperation(payload: ConfigUserOperation): Promise<void> {
    if (payload.op === 'switch') {
      await vscode.commands.executeCommand('lattice.user.switch', payload.username);
      return;
    }
    if (payload.op === 'create') {
      await vscode.commands.executeCommand('lattice.user.create', payload.username);
      return;
    }
    await vscode.commands.executeCommand('lattice.user.rename', {
      username: payload.username,
      force: payload.force === true,
    });
  }

  // ── 宿主交互 ──

  async pickDirectory(): Promise<string[]> {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: true,
      openLabel: t('Select Directory'),
    });
    return picked?.map((uri) => uri.fsPath) ?? [];
  }

  async openConfigFile(scope: 'global' | 'local'): Promise<void> {
    const filePath = scope === 'local' ? getLocalConfigPath() : getGlobalConfigPath();
    try {
      await stat(filePath);
      await vscode.window.showTextDocument(vscode.Uri.file(filePath), { preview: false });
    } catch {
      void vscode.window.showWarningMessage(t('Config file does not exist yet: {0}', filePath));
    }
  }

  async openVscodeSettings(key?: string): Promise<void> {
    await vscode.commands.executeCommand(
      'workbench.action.openSettings',
      key ? `@id:${key}` : 'lattice',
    );
  }

  async copyDiagnostics(): Promise<string> {
    const state = await this.getState().catch(() => null);
    const lines: string[] = [];
    lines.push(
      `extension: lattice@${String(this.services.context.extension.packageJSON.version ?? 'dev')}`,
    );
    lines.push(`vscode: ${vscode.version}`);
    lines.push(`platform: ${process.platform} ${process.arch} node ${process.version}`);
    lines.push(`latticeRoot: ${getLatticeRoot()}`);
    lines.push(`globalConfig: ${getGlobalConfigPath()}`);
    lines.push(`localConfig: ${getLocalConfigPath()}`);
    if (state) {
      lines.push(
        `snapshot: projects=${state.stats.projectCount} tasks=${state.stats.taskCount} specs=${state.stats.specCount} relations=${state.stats.relationCount}`,
      );
      lines.push(
        `db: ${state.runtime.db.driver} available=${state.runtime.db.available} sizeKB=${state.runtime.db.sizeKB}`,
      );
      lines.push(
        `rag: ${state.rag ? `${state.rag.modelId} docs=${state.rag.indexedDocuments}` : 'unavailable'}`,
      );
      lines.push(
        `git: initialized=${state.git.status.initialized} changes=${state.git.status.hasChanges}`,
      );
      const errors = Object.entries(state.errors);
      if (errors.length > 0)
        lines.push(`errors: ${errors.map(([k, v]) => `${k}: ${v}`).join('; ')}`);
    }
    const text = lines.join('\n');
    await vscode.env.clipboard.writeText(text);
    return text;
  }
}

function readGlobalConfigDefaults(): Record<string, unknown> {
  return getDefaultGlobalConfig() as unknown as Record<string, unknown>;
}

function readLocalConfigDefaults(): Record<string, unknown> {
  return getDefaultLocalConfig() as Record<string, unknown>;
}

async function getDbSizeKB(): Promise<number> {
  try {
    const info = await stat(getDbPath());
    return Math.round(info.size / 1024);
  } catch {
    return 0;
  }
}
