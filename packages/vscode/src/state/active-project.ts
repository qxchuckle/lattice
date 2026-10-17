import * as vscode from 'vscode';
import { LatticeDataService } from '../data/service';
import { ProjectRow } from '../cli/types';
import { findLatticeAnchor, normalizeLegacyId, readLatticeId } from '../util/paths';
import { warnLog } from '../logging';
import { SnapshotStore } from './snapshot';

interface FolderCandidate {
  folder: vscode.WorkspaceFolder;
  anchorRoot: string | null;
  declaredId: string | null;
}

const PINNED_KEY = 'lattice.pinnedFolder';
const WHERE_TTL_MS = 60_000;

/** 活动项目解析：pinned > 活动编辑器所在根 > 第一个含锚点的工作区根（design.md §3.1）。 */
export class ActiveProjectService implements vscode.Disposable {
  private candidates: FolderCandidate[] = [];
  private activeFolder: vscode.WorkspaceFolder | undefined;
  private projectId: string | undefined;
  private anchorRoot: string | undefined;
  private whereCache = new Map<string, { value: string | null; at: number }>();
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
        if (sections.includes('projects')) {
          this.whereCache.clear();
          void this.refresh();
        }
      }),
    );
    void this.refresh();
  }

  get currentFolder(): vscode.WorkspaceFolder | undefined {
    return this.activeFolder;
  }

  /** 解析出的项目 id（可能为未注册锚点：此时 anchorRoot 有值而 projectId 为空）。 */
  get currentProjectId(): string | undefined {
    return this.projectId;
  }

  get currentAnchorRoot(): string | undefined {
    return this.anchorRoot;
  }

  get currentProject(): ProjectRow | undefined {
    return this.snapshot.findProject(this.projectId);
  }

  /** 所有工作区根（含未检测到锚点的）。 */
  get allFolders(): readonly vscode.WorkspaceFolder[] {
    return vscode.workspace.workspaceFolders ?? [];
  }

  get folderCandidates(): ReadonlyArray<{
    folder: vscode.WorkspaceFolder;
    anchorRoot: string | null;
  }> {
    return this.candidates.map((c) => ({ folder: c.folder, anchorRoot: c.anchorRoot }));
  }

  get pinnedFolderUri(): string | undefined {
    return this.context.workspaceState.get<string>(PINNED_KEY);
  }

  async pinFolder(folder: vscode.WorkspaceFolder | undefined): Promise<void> {
    await this.context.workspaceState.update(PINNED_KEY, folder?.uri.toString());
    await this.refresh();
  }

  async refresh(): Promise<void> {
    await this.rescan();
    await this.resolve();
  }

  private async rescan(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const next: FolderCandidate[] = [];
    for (const folder of folders) {
      const anchorRoot = await findLatticeAnchor(folder.uri.fsPath);
      const declaredId = anchorRoot ? await readLatticeId(anchorRoot) : null;
      next.push({ folder, anchorRoot, declaredId });
    }
    this.candidates = next;
  }

  private pickFolder(): FolderCandidate | undefined {
    if (this.candidates.length === 0) return undefined;
    const pinned = this.pinnedFolderUri;
    if (pinned) {
      const hit = this.candidates.find((c) => c.folder.uri.toString() === pinned);
      if (hit) return hit;
    }
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      if (folder) {
        const hit = this.candidates.find((c) => c.folder.uri.toString() === folder.uri.toString());
        if (hit) return hit;
      }
    }
    return this.candidates.find((c) => c.anchorRoot) ?? this.candidates[0];
  }

  /** 项目根 → 项目 id（缓存 60s；命中快照；最后回退 lattice.json 声明的 id）。 */
  private async resolveId(
    anchorRoot: string | null,
    declaredId: string | null,
  ): Promise<string | null> {
    if (anchorRoot) {
      const cached = this.whereCache.get(anchorRoot);
      if (cached && Date.now() - cached.at < WHERE_TTL_MS) {
        if (cached.value) return cached.value;
      } else {
        try {
          const result = await this.data.projectWhere(anchorRoot);
          const id = result.exact?.id ?? result.prefixMatches[0]?.id ?? null;
          this.whereCache.set(anchorRoot, { value: id, at: Date.now() });
          if (id) return id;
        } catch (error) {
          warnLog(`project where failed for ${anchorRoot}: ${String(error)}`);
        }
      }
    }
    if (declaredId) {
      const normalized = normalizeLegacyId(declaredId);
      const hit = this.snapshot.findProject(normalized) ?? this.snapshot.findProject(declaredId);
      if (hit) return hit.id;
      return normalized;
    }
    return null;
  }

  private async resolve(): Promise<void> {
    const candidate = this.pickFolder();
    const nextId = candidate
      ? await this.resolveId(candidate.anchorRoot, candidate.declaredId)
      : null;
    const nextRoot = candidate?.anchorRoot ?? undefined;
    const folderChanged = this.activeFolder?.uri.toString() !== candidate?.folder.uri.toString();
    const idChanged = this.projectId !== (nextId ?? undefined);
    const rootChanged = this.anchorRoot !== nextRoot;
    this.activeFolder = candidate?.folder;
    this.projectId = nextId ?? undefined;
    this.anchorRoot = nextRoot;
    if (folderChanged || idChanged || rootChanged) {
      this.changeEmitter.fire();
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.changeEmitter.dispose();
  }
}
