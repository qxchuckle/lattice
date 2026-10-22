import * as vscode from 'vscode';
import * as path from 'node:path';
import { LatticeDataService } from '../data/service';
import { ProjectRow } from '../cli/types';
import { findLatticeAnchor, normalizeLegacyId, readLatticeId } from '../util/paths';
import { findGitRoot } from '../util/git-root';
import { warnLog } from '../logging';
import { SnapshotStore } from './snapshot';
import {
  buildCandidates,
  compareCandidates,
  folderForPath,
  hasMultipleProjectCandidates,
  makeCandidate,
  resolveActiveCandidate,
  upsertCandidate,
  type FolderProjectInfo,
  type PinnedProject,
  type ProjectCandidate,
  type WorkspaceFolderInput,
} from './project-context-logic';

const PINNED_KEY = 'lattice.pinnedFolder';
const PINNED_PROJECT_KEY = 'lattice.pinnedProject';
const WHERE_TTL_MS = 60_000;

/**
 * 活动项目解析：项目级上下文，而不是只按 workspace folder。
 *
 * 优先级：pin 项目 > 旧 pin folder > 活动文件最近锚点/最深已注册路径 > 活动文件 Git 根 >
 * folder 根项目 > 第一个候选。兼容旧的 pin folder 状态。
 */
export class ActiveProjectService implements vscode.Disposable {
  private workspaceFolders: vscode.WorkspaceFolder[] = [];
  private folders: WorkspaceFolderInput[] = [];
  private folderInfo = new Map<string, FolderProjectInfo>();
  private candidates: ProjectCandidate[] = [];
  private activeCandidate: ProjectCandidate | undefined;
  private activeFolder: vscode.WorkspaceFolder | undefined;
  private projectId: string | undefined;
  private projectRoot: string | undefined;
  private whereCache = new Map<string, { value: string | null; at: number }>();
  private refreshPromise: Promise<void> | undefined;
  private refreshRequested = false;
  private handlingSnapshot = false;
  private changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly data: LatticeDataService,
    private readonly snapshot: SnapshotStore,
  ) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => void this.refresh()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refresh()),
      snapshot.onDidChange((sections) => {
        if (!sections.includes('projects')) return;
        this.whereCache.clear();
        // 本服务自己触发的 projects 加载不需要再排一轮刷新。
        if (!this.handlingSnapshot) void this.refresh();
      }),
    );
    void this.refresh();
  }

  get currentFolder(): vscode.WorkspaceFolder | undefined {
    return this.activeFolder;
  }

  /** 解析出的项目 id（可能为未注册锚点：此时 projectRoot 有值而 projectId 为空）。 */
  get currentProjectId(): string | undefined {
    return this.projectId;
  }

  /** 最终项目根，任务/规范/终端/注册 cwd 使用它。 */
  get currentProjectRoot(): string | undefined {
    return this.projectRoot;
  }

  /** 兼容旧调用：历史语义是“锚点根”，现在统一返回项目根。 */
  get currentAnchorRoot(): string | undefined {
    return this.projectRoot;
  }

  get currentCandidate(): ProjectCandidate | undefined {
    return this.activeCandidate;
  }

  get currentProject(): ProjectRow | undefined {
    return this.snapshot.findProject(this.projectId);
  }

  /** 工作区内有多个可切换的 Lattice 项目（标题栏切换入口的显隐条件）。 */
  get hasMultipleProjects(): boolean {
    return hasMultipleProjectCandidates(this.candidates);
  }

  /** 所有工作区根（含未检测到锚点的）。 */
  get allFolders(): readonly vscode.WorkspaceFolder[] {
    return this.workspaceFolders;
  }

  get folderCandidates(): ReadonlyArray<{
    folder: vscode.WorkspaceFolder;
    anchorRoot: string | null;
    gitRoot: string | null;
  }> {
    return this.workspaceFolders.map((folder) => {
      const info = this.folderInfo.get(folder.uri.toString());
      return {
        folder,
        anchorRoot: info?.anchorRoot ?? null,
        gitRoot: info?.gitRoot ?? null,
      };
    });
  }

  get pinnedFolderUri(): string | undefined {
    return this.context.workspaceState.get<string>(PINNED_KEY);
  }

  get pinnedProject(): PinnedProject | undefined {
    const value = this.context.workspaceState.get<PinnedProject>(PINNED_PROJECT_KEY);
    if (!value || typeof value.folderUri !== 'string' || typeof value.rootPath !== 'string') {
      return undefined;
    }
    return value;
  }

  /** 兼容旧调用：选中文件夹等价于 pin 该 folder 根。 */
  async pinFolder(folder: vscode.WorkspaceFolder | undefined): Promise<void> {
    await this.context.workspaceState.update(PINNED_PROJECT_KEY, undefined);
    await this.context.workspaceState.update(PINNED_KEY, folder?.uri.toString());
    await this.refresh();
  }

  async pinProject(candidate: ProjectCandidate | undefined): Promise<void> {
    if (!candidate) {
      await this.clearPin();
      return;
    }
    await this.context.workspaceState.update(PINNED_PROJECT_KEY, {
      folderUri: candidate.folderUri,
      rootPath: candidate.rootPath,
    } satisfies PinnedProject);
    await this.context.workspaceState.update(PINNED_KEY, undefined);
    await this.refresh();
  }

  async clearPin(): Promise<void> {
    await this.context.workspaceState.update(PINNED_PROJECT_KEY, undefined);
    await this.context.workspaceState.update(PINNED_KEY, undefined);
    await this.refresh();
  }

  /** 项目切换器/配置中心使用：返回当前工作区内可切换的项目候选。 */
  async getProjectCandidates(): Promise<ProjectCandidate[]> {
    await this.refresh();
    const resolved = await Promise.all(
      this.candidates.map((candidate) => this.resolveCandidate(candidate)),
    );
    const byKey = new Map(resolved.map((candidate) => [candidate.key, candidate]));
    if (this.activeCandidate) byKey.set(this.activeCandidate.key, this.activeCandidate);
    const folderOrder = this.folders.map((folder) => folder.uri);
    return [...byKey.values()].sort((a, b) => compareCandidates(a, b, folderOrder));
  }

  async refresh(): Promise<void> {
    if (this.refreshPromise) {
      this.refreshRequested = true;
      return this.refreshPromise;
    }
    this.refreshPromise = this.doRefresh().finally(() => {
      this.refreshPromise = undefined;
    });
    await this.refreshPromise;
    if (this.refreshRequested) {
      this.refreshRequested = false;
      await this.refresh();
    }
  }

  private activeFilePath(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return undefined;
    // Accept remote workspace URIs too; only follow documents inside a workspace folder.
    if (!vscode.workspace.getWorkspaceFolder(editor.document.uri)) return undefined;
    return editor.document.uri.fsPath;
  }

  private async doRefresh(): Promise<void> {
    this.workspaceFolders = [...(vscode.workspace.workspaceFolders ?? [])];
    this.folders = this.workspaceFolders.map((folder) => ({
      uri: folder.uri.toString(),
      name: folder.name,
      fsPath: folder.uri.fsPath,
    }));

    this.folderInfo.clear();
    for (const folder of this.workspaceFolders) {
      const anchorRoot = await findLatticeAnchor(folder.uri.fsPath);
      const gitRoot = await findGitRoot(folder.uri.fsPath);
      const declaredId = anchorRoot ? await readLatticeId(anchorRoot) : null;
      this.folderInfo.set(folder.uri.toString(), { anchorRoot, gitRoot, declaredId });
    }

    // 已注册项目是“同一 Git 根下多个项目”的关键候选来源。
    this.handlingSnapshot = true;
    try {
      if (!this.snapshot.data.loaded.projects) await this.snapshot.ensure(['projects']);
    } catch (error) {
      // 项目快照失败时仍保留 folder/anchor/Git 级解析，不阻塞激活。
      warnLog(`project snapshot unavailable: ${String(error)}`);
    } finally {
      this.handlingSnapshot = false;
    }
    const registered = this.snapshot.data.projects.map((project) => ({
      id: project.id,
      name: project.name,
      localPaths: project.localPaths,
    }));
    const candidates = buildCandidates(this.folders, this.folderInfo, registered);

    const filePath = this.activeFilePath();
    if (filePath) {
      const folder = folderForPath(this.folders, filePath);
      if (folder) {
        const searchDir = path.dirname(filePath);
        const anchorRoot = await findLatticeAnchor(searchDir);
        const gitRoot = await findGitRoot(searchDir);
        const rootPath = anchorRoot ?? gitRoot;
        if (rootPath) {
          const declaredId = anchorRoot ? await readLatticeId(anchorRoot) : null;
          upsertCandidate(
            candidates,
            makeCandidate({
              folder,
              rootPath,
              anchorRoot,
              gitRoot,
              declaredId,
              source: anchorRoot ? 'anchor' : 'git',
            }),
          );
        }
      }
    }

    this.candidates = candidates;
    const chosen = resolveActiveCandidate({
      candidates,
      folders: this.folders,
      activeFilePath: filePath,
      pinned: this.pinnedProject,
      pinnedFolderUri: this.pinnedFolderUri,
    });
    const resolved = chosen ? await this.resolveCandidate(chosen) : undefined;
    const nextFolder = resolved
      ? this.workspaceFolders.find((folder) => folder.uri.toString() === resolved.folderUri)
      : undefined;
    const nextRoot = resolved?.rootPath;
    const nextId = resolved?.projectId ?? undefined;
    const changed =
      this.activeFolder?.uri.toString() !== nextFolder?.uri.toString() ||
      this.projectRoot !== nextRoot ||
      this.projectId !== nextId ||
      this.activeCandidate?.key !== resolved?.key;
    this.activeFolder = nextFolder;
    this.projectRoot = nextRoot;
    this.projectId = nextId;
    this.activeCandidate = resolved;
    if (changed) this.changeEmitter.fire();
  }

  /** 项目根 → 项目 id（缓存 60s；命中快照；最后回退 lattice.json 声明的 id）。 */
  private async resolveCandidate(candidate: ProjectCandidate): Promise<ProjectCandidate> {
    if (candidate.projectId) {
      const project = this.snapshot.findProject(candidate.projectId);
      return {
        ...candidate,
        projectId: project?.id ?? candidate.projectId,
        projectName: project?.name ?? candidate.projectName,
      };
    }

    let projectId: string | null = null;
    const cached = this.whereCache.get(candidate.rootPath);
    if (cached && Date.now() - cached.at < WHERE_TTL_MS) {
      projectId = cached.value;
    } else {
      try {
        const result = await this.data.projectWhere(candidate.rootPath);
        // 有本地锚点时，只有精确匹配才算该锚点项目；不能把未注册的嵌套
        // lattice.json 错认成父级 Git 项目。
        const match =
          result.exact ?? (candidate.anchorRoot ? null : (result.prefixMatches[0] ?? null));
        projectId = match?.id ?? null;
        this.whereCache.set(candidate.rootPath, { value: projectId, at: Date.now() });
      } catch (error) {
        warnLog(`project where failed for ${candidate.rootPath}: ${String(error)}`);
      }
    }

    if (!projectId && candidate.declaredId) {
      const normalized = normalizeLegacyId(candidate.declaredId);
      const hit =
        this.snapshot.findProject(normalized) ?? this.snapshot.findProject(candidate.declaredId);
      projectId = hit?.id ?? normalized;
    }

    const project = projectId ? this.snapshot.findProject(projectId) : undefined;
    return {
      ...candidate,
      projectId: project?.id ?? projectId,
      projectName: project?.name ?? candidate.projectName,
    };
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.changeEmitter.dispose();
  }
}

export type { ProjectCandidate } from './project-context-logic';
