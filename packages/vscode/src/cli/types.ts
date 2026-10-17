import { Row, bool, num, objArray, str, strArray } from './parsers';

// ── 行类型与容错映射（字段来源见 design.md §4.3 数据契约表） ──

export interface ProjectRow {
  id: string;
  /** 全部可匹配 id 集合（虚拟合并；core ProjectMeta.ids 透传） */
  ids?: string[];
  name: string;
  description: string | null;
  localPaths: string[];
  gitRemotes: string[];
  packageNames: string[];
  created?: string;
  updated?: string | null;
  groups: string | null;
  tags: string | null;
}

export function mapProjectRow(r: Row): ProjectRow {
  return {
    id: str(r.id) ?? '',
    name: str(r.name) ?? str(r.id) ?? '',
    description: str(r.description) ?? null,
    localPaths: strArray(r.localPaths),
    gitRemotes: strArray(r.gitRemotes),
    packageNames: strArray(r.packageNames),
    created: str(r.created),
    updated: str(r.updated) ?? null,
    groups: str(r.groups) ?? null,
    tags: str(r.tags) ?? null,
  };
}

export interface RelationRow {
  id: string;
  type: string;
  projectA: string;
  projectB: string;
  description?: string;
  createdBy?: string;
  createdFromTaskId?: string;
}

export function mapRelationRow(r: Row): RelationRow {
  return {
    id: str(r.id) ?? '',
    type: str(r.type) ?? 'related',
    projectA: str(r.projectA) ?? str(r.project_a) ?? '',
    projectB: str(r.projectB) ?? str(r.project_b) ?? '',
    description: str(r.description),
    createdBy: str(r.createdBy) ?? str(r.created_by),
    createdFromTaskId: str(r.createdFromTaskId) ?? str(r.created_from_task_id),
  };
}

export interface ScopePathRow {
  path: string;
  note?: string;
  addedAt?: string;
}

export interface ReferencedSpecRow {
  id?: string;
  relativePath?: string;
  scope?: string;
  projectId?: string;
}

export interface TaskRow {
  id: string;
  title: string;
  status: string;
  projects: string[];
  parentTaskId?: string;
  scopePaths: ScopePathRow[];
  referencedSpecs: ReferencedSpecRow[];
  created?: string;
  updated?: string;
}

export function mapTaskRow(r: Row): TaskRow {
  return {
    id: str(r.id) ?? '',
    title: str(r.title) ?? '',
    status: str(r.status) ?? 'planning',
    projects: strArray(r.projects),
    parentTaskId: str(r.parentTaskId),
    scopePaths: objArray(r.scopePaths).map((o) => ({
      path: str(o.path) ?? '',
      note: str(o.note),
      addedAt: str(o.addedAt),
    })),
    referencedSpecs: objArray(r.referencedSpecs).map((o) => ({
      id: str(o.id),
      relativePath: str(o.relativePath),
      scope: str(o.scope),
      projectId: str(o.projectId),
    })),
    created: str(r.created),
    updated: str(r.updated),
  };
}

export type SpecScope = 'global' | 'user' | 'project';

export interface SpecRow {
  id: string;
  title: string;
  description: string | null;
  tags: string[];
  filePath: string;
  scope: SpecScope;
  projectId?: string;
  updated?: string;
}

export function mapSpecRow(r: Row, scope: SpecScope): SpecRow {
  const filePath = str(r.filePath) ?? '';
  const projectId =
    scope === 'project' ? (filePath.match(/\/projects\/([^/]+)\//)?.[1] ?? undefined) : undefined;
  return {
    id: str(r.id) ?? '',
    title: str(r.title) ?? '',
    description: str(r.description) ?? null,
    tags: strArray(r.tags),
    filePath,
    scope,
    projectId,
    updated: str(r.updated),
  };
}

export interface SpecGroups {
  global: SpecRow[];
  user: SpecRow[];
  project: SpecRow[];
}

export interface ConflictRow {
  fileName: string;
  scope: string;
  specId: string;
  filePath: string;
  snippet?: string;
}

export function mapConflictRow(r: Row): ConflictRow {
  return {
    fileName: str(r.fileName) ?? '',
    scope: str(r.scope) ?? '',
    specId: str(r.specId) ?? '',
    filePath: str(r.filePath) ?? '',
    snippet: str(r.snippet),
  };
}

export interface SearchRow {
  type: string;
  title: string;
  snippet?: string;
  filePath?: string;
  projectIds: string[];
  specId?: string;
  taskId?: string;
  checkpointId?: string;
  relationId?: string;
  weakMatch: boolean;
  semanticRank?: number;
  matchedVia?: unknown;
}

export function mapSearchRow(r: Row): SearchRow {
  return {
    type: str(r.type) ?? '',
    title: str(r.title) ?? '',
    snippet: str(r.snippet),
    filePath: str(r.filePath),
    projectIds: strArray(r.projectIds),
    specId: str(r.specId),
    taskId: str(r.taskId),
    checkpointId: str(r.checkpointId),
    relationId: str(r.relationId),
    weakMatch: bool(r.weakMatch) ?? false,
    semanticRank: num(r.semanticRank),
    matchedVia: r.matchedVia,
  };
}

export interface CheckpointRow {
  id: string;
  time?: string;
  type?: string;
  title?: string;
  message?: string;
}

export function mapCheckpointRow(r: Row): CheckpointRow {
  return {
    id: str(r.id) ?? '',
    time: str(r.time),
    type: str(r.type),
    title: str(r.title),
    message: str(r.message),
  };
}

export interface TrashRow {
  id: string;
  type: string;
  title: string;
  entityId: string;
  trashedAt?: string;
  originalPath?: string;
}

export function mapTrashRow(r: Row): TrashRow {
  return {
    id: str(r.id) ?? '',
    type: str(r.type) ?? '',
    title: str(r.title) ?? '',
    entityId: str(r.entityId) ?? '',
    trashedAt: str(r.trashedAt),
    originalPath: str(r.originalPath),
  };
}

export interface DoctorEntryRow {
  item: string;
  status: string;
  message?: string;
  fix?: string;
}

export interface DoctorReportRow {
  total: number;
  healthy: number;
  stale: number;
  error: number;
  repaired: number;
  entries: DoctorEntryRow[];
}

export function mapDoctorReport(payload: unknown): DoctorReportRow {
  const r = (payload ?? {}) as Row;
  return {
    total: num(r.total) ?? 0,
    healthy: num(r.healthy) ?? 0,
    stale: num(r.stale) ?? 0,
    error: num(r.error) ?? 0,
    repaired: num(r.repaired) ?? 0,
    entries: objArray(r.entries).map((e) => ({
      item: str(e.item) ?? '',
      status: str(e.status) ?? '',
      message: str(e.message),
      fix: str(e.fix),
    })),
  };
}

export interface ProjectWhereResult {
  exact: ProjectRow | null;
  prefixMatches: ProjectRow[];
}
