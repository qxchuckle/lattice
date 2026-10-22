import * as path from 'node:path';

export interface WorkspaceFolderInput {
  uri: string;
  name: string;
  fsPath: string;
}

export interface FolderProjectInfo {
  anchorRoot: string | null;
  gitRoot: string | null;
  declaredId: string | null;
}

export interface RegisteredProjectInput {
  id: string;
  name: string;
  localPaths: string[];
}

export type ProjectCandidateSource = 'folder' | 'anchor' | 'git' | 'registered';

/** A project root that can become the active project in a workspace folder. */
export interface ProjectCandidate {
  key: string;
  folderUri: string;
  folderName: string;
  folderPath: string;
  rootPath: string;
  anchorRoot: string | null;
  gitRoot: string | null;
  declaredId: string | null;
  projectId: string | null;
  projectName: string | null;
  source: ProjectCandidateSource;
  isRoot: boolean;
}

export interface PinnedProject {
  folderUri: string;
  rootPath: string;
}

function comparablePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** True when child is parent or lives below parent (path-segment aware). */
export function isPathInsideOrEqual(parent: string, child: string): boolean {
  const p = comparablePath(parent);
  const c = comparablePath(child);
  if (p === c) return true;
  return c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

export function samePath(a: string, b: string): boolean {
  return comparablePath(a) === comparablePath(b);
}

export function candidateKey(folderUri: string, rootPath: string): string {
  return `${folderUri}|${comparablePath(rootPath)}`;
}

export function makeCandidate(input: {
  folder: WorkspaceFolderInput;
  rootPath: string;
  anchorRoot?: string | null;
  gitRoot?: string | null;
  declaredId?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  source?: ProjectCandidateSource;
  isRoot?: boolean;
}): ProjectCandidate {
  const rootPath = path.resolve(input.rootPath);
  return {
    key: candidateKey(input.folder.uri, rootPath),
    folderUri: input.folder.uri,
    folderName: input.folder.name,
    folderPath: input.folder.fsPath,
    rootPath,
    anchorRoot: input.anchorRoot ?? null,
    gitRoot: input.gitRoot ?? null,
    declaredId: input.declaredId ?? null,
    projectId: input.projectId ?? null,
    projectName: input.projectName ?? null,
    source: input.source ?? 'folder',
    isRoot: input.isRoot ?? comparablePath(rootPath) === comparablePath(input.folder.fsPath),
  };
}

/** Add a candidate, merging identity fields when the same folder/root already exists. */
export function upsertCandidate(
  candidates: ProjectCandidate[],
  candidate: ProjectCandidate,
): ProjectCandidate[] {
  const index = candidates.findIndex((item) => item.key === candidate.key);
  if (index < 0) {
    candidates.push(candidate);
    return candidates;
  }
  const existing = candidates[index];
  candidates[index] = {
    ...existing,
    anchorRoot: existing.anchorRoot ?? candidate.anchorRoot,
    gitRoot: existing.gitRoot ?? candidate.gitRoot,
    declaredId: existing.declaredId ?? candidate.declaredId,
    projectId: existing.projectId ?? candidate.projectId,
    projectName: existing.projectName ?? candidate.projectName,
    source: existing.source === 'folder' ? candidate.source : existing.source,
  };
  return candidates;
}

/** Build folder-root and registered-project candidates for every workspace folder. */
export function buildCandidates(
  folders: WorkspaceFolderInput[],
  folderInfo: Map<string, FolderProjectInfo>,
  registered: RegisteredProjectInput[],
): ProjectCandidate[] {
  const candidates: ProjectCandidate[] = [];
  for (const folder of folders) {
    const info = folderInfo.get(folder.uri) ?? {
      anchorRoot: null,
      gitRoot: null,
      declaredId: null,
    };
    upsertCandidate(
      candidates,
      makeCandidate({
        folder,
        rootPath: info.anchorRoot ?? info.gitRoot ?? folder.fsPath,
        anchorRoot: info.anchorRoot,
        gitRoot: info.gitRoot,
        declaredId: info.declaredId,
        source: 'folder',
        isRoot: true,
      }),
    );
    for (const project of registered) {
      for (const localPath of project.localPaths) {
        if (!isPathInsideOrEqual(folder.fsPath, localPath)) continue;
        upsertCandidate(
          candidates,
          makeCandidate({
            folder,
            rootPath: localPath,
            projectId: project.id,
            projectName: project.name,
            source: 'registered',
          }),
        );
      }
    }
  }
  return candidates;
}

/** Deepest candidate whose root contains the path. */
export function deepestCandidateForPath(
  candidates: readonly ProjectCandidate[],
  filePath: string,
  folderUri?: string,
): ProjectCandidate | undefined {
  const normalized = comparablePath(filePath);
  let best: ProjectCandidate | undefined;
  for (const candidate of candidates) {
    if (folderUri && candidate.folderUri !== folderUri) continue;
    if (!isPathInsideOrEqual(candidate.rootPath, normalized)) continue;
    if (!best || comparablePath(candidate.rootPath).length > comparablePath(best.rootPath).length) {
      best = candidate;
    }
  }
  return best;
}

/** Workspace folder with the deepest root containing the file. */
export function folderForPath(
  folders: readonly WorkspaceFolderInput[],
  filePath: string,
): WorkspaceFolderInput | undefined {
  let best: WorkspaceFolderInput | undefined;
  for (const folder of folders) {
    if (!isPathInsideOrEqual(folder.fsPath, filePath)) continue;
    if (!best || comparablePath(folder.fsPath).length > comparablePath(best.fsPath).length) {
      best = folder;
    }
  }
  return best;
}

export interface ResolveCandidateInput {
  candidates: readonly ProjectCandidate[];
  folders: readonly WorkspaceFolderInput[];
  activeFilePath?: string;
  pinned?: PinnedProject | null;
  pinnedFolderUri?: string;
}

/**
 * Pick the active candidate:
 * pinned project > legacy pinned folder root > deepest candidate containing the active file >
 * first candidate with an anchor/Git root > first candidate.
 */
export function resolveActiveCandidate(input: ResolveCandidateInput): ProjectCandidate | undefined {
  const candidates = input.candidates;
  if (candidates.length === 0) return undefined;

  if (input.pinned) {
    const pinned = candidates.find(
      (candidate) =>
        candidate.folderUri === input.pinned?.folderUri &&
        samePath(candidate.rootPath, input.pinned?.rootPath ?? ''),
    );
    if (pinned) return pinned;
  }

  // 兼容旧 pin folder：旧语义是 folder 锁定优先于活动编辑器。
  const preferredFolderUri = input.pinnedFolderUri;
  if (preferredFolderUri) {
    const folderRoot = candidates.find(
      (candidate) => candidate.folderUri === preferredFolderUri && candidate.isRoot,
    );
    if (folderRoot) return folderRoot;
  }

  if (input.activeFilePath) {
    const folder = folderForPath(input.folders, input.activeFilePath);
    const active = deepestCandidateForPath(candidates, input.activeFilePath, folder?.uri);
    if (active) return active;
  }

  return (
    candidates.find(
      (candidate) => candidate.anchorRoot || candidate.gitRoot || candidate.projectId,
    ) ?? candidates[0]
  );
}

/** 活动项目的展示短名：项目名 > 候选名 > 根目录名（任务视图标题与状态栏共用同一口径）。 */
export function projectDisplayName(input: {
  projectName?: string | null;
  candidateName?: string | null;
  rootPath?: string | null;
}): string | undefined {
  const named = input.projectName?.trim() || input.candidateName?.trim();
  if (named) return named;
  const rootPath = input.rootPath?.trim();
  return rootPath ? path.basename(rootPath) : undefined;
}

/**
 * 任务面板顶部「当前项目」条目（面板内容顶部而非标题行——标题行宽度有限会被截断）。
 * 仅任务范围为当前项目且存在活动项目时产出。
 */
export interface TasksProjectHeader {
  name: string;
  projectId?: string;
  /** 有锚点但尚未注册：图标保持中性、描述标注未注册。 */
  unregistered: boolean;
  /** 工作区内多个项目时才允许点击切换。 */
  canSwitch: boolean;
}

export function tasksProjectHeader(input: {
  scope: 'all' | 'project';
  projectId?: string | null;
  projectName?: string | null;
  candidateName?: string | null;
  rootPath?: string | null;
  canSwitch?: boolean;
}): TasksProjectHeader | undefined {
  if (input.scope !== 'project') return undefined;
  const name = projectDisplayName(input);
  if (!name) return undefined;
  const projectId = input.projectId ?? undefined;
  return {
    name,
    projectId,
    unregistered: !projectId,
    canSwitch: Boolean(input.canSwitch),
  };
}

/**
 * 工作区内是否存在多个可切换的 Lattice 项目。
 * 只统计有项目身份证据的候选（已注册 projectId / lattice.json 锚点 / 声明的 legacy ID），
 * 纯 folder 根（没有任何锚点与注册）不算项目；同一根目录的多种候选（folder 根 + 已注册）
 * 合并为同一项目——folder 根候选的 projectId 是懒解析的，这里以根目录对齐。
 */
export function hasMultipleProjectCandidates(candidates: readonly ProjectCandidate[]): boolean {
  const projectByRoot = new Map<string, string>();
  const roots = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.projectId && !candidate.anchorRoot && !candidate.declaredId) continue;
    const rootKey = comparablePath(candidate.rootPath);
    roots.add(rootKey);
    if (candidate.projectId) projectByRoot.set(rootKey, candidate.projectId);
  }
  const projectKeys = new Set<string>();
  for (const rootKey of roots) projectKeys.add(projectByRoot.get(rootKey) ?? rootKey);
  return projectKeys.size > 1;
}

/** Stable sort key for switch pickers: folder order, root before nested, then path. */
export function compareCandidates(
  a: ProjectCandidate,
  b: ProjectCandidate,
  folderOrder: readonly string[],
): number {
  const ai = folderOrder.indexOf(a.folderUri);
  const bi = folderOrder.indexOf(b.folderUri);
  if (ai !== bi)
    return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi);
  if (a.isRoot !== b.isRoot) return a.isRoot ? -1 : 1;
  return comparablePath(a.rootPath).localeCompare(comparablePath(b.rootPath));
}
