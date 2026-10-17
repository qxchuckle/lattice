/**
 * LatticeDataService —— VSCode 宿主的数据服务适配器。
 *
 * 分层（详见 docs/architecture.md）：
 *   core（领域+存储+端口） → services（用例实现，多宿主共享） → 本适配器（宿主职责） → 视图/桥
 *
 * 本适配器只做三件事：
 * 1. DB 生命周期（绑定 node:sqlite 驱动、懒 initDb、根变更重置）；
 * 2. core/services 领域对象 → 扩展内部行模型（../cli/types.ts，视图层零改动）；
 * 3. 扩展特有能力（诊断信息、冲突检测的 cwd 推断）。
 * 一切"组合与降级"（虚拟合并、文件回退、跨用户、写操作校验）都在 @qcqx/lattice-services。
 */
import * as lattice from '@qcqx/lattice-services';
import type { SpecWithScope, TaskDetail } from '@qcqx/lattice-services';
import {
  CORE_VERSION,
  closeDb,
  getBoundDatabaseDriver,
  initDb,
  resolveDatabaseDriver,
  useNodeSqliteDriver,
} from '@qcqx/lattice-core';
import type {
  CheckpointEntry,
  ProjectMeta,
  SearchResult,
  TaskMeta,
  TrashMeta,
} from '@qcqx/lattice-core';
import {
  ConflictRow,
  CheckpointRow,
  DoctorReportRow,
  ProjectRow,
  ProjectWhereResult,
  RelationRow,
  SearchRow,
  SpecGroups,
  SpecRow,
  TaskRow,
  TrashRow,
  mapDoctorReport,
} from '../cli/types';

// ── core 对象 → 扩展行模型 ──

function toProjectRow(meta: ProjectMeta): ProjectRow {
  return {
    id: meta.id ?? meta.ids?.[0] ?? '',
    ids: meta.ids ?? [],
    name: meta.name ?? '',
    description: meta.description ?? null,
    localPaths: meta.localPaths ?? [],
    gitRemotes: meta.gitRemotes ?? [],
    packageNames: meta.packageNames ?? [],
    created: meta.created,
    updated: meta.updated ?? null,
    groups: meta.groups?.join(',') ?? null,
    tags: meta.tags?.join(',') ?? null,
  };
}

function toRelationRow(relation: {
  id: string;
  type: string;
  projectA: string;
  projectB: string;
  description?: string;
  createdBy?: string;
  createdFromTaskId?: string;
}): RelationRow {
  return {
    id: relation.id,
    type: relation.type ?? 'related',
    projectA: relation.projectA,
    projectB: relation.projectB,
    description: relation.description,
    createdBy: relation.createdBy,
    createdFromTaskId: relation.createdFromTaskId,
  };
}

function toTaskRow(meta: TaskMeta): TaskRow {
  return {
    id: meta.id,
    title: meta.title,
    status: meta.status,
    projects: meta.projects ?? [],
    parentTaskId: meta.parentTaskId,
    scopePaths: (meta.scopePaths ?? []).map((path) => ({
      path: path.path,
      note: path.note,
      addedAt: path.addedAt,
    })),
    referencedSpecs: (meta.referencedSpecs ?? []).map((ref) => ({
      id: ref.id,
      relativePath: ref.relativePath,
      scope: ref.scope,
      projectId: ref.projectId,
    })),
    created: meta.created,
    updated: meta.updated,
  };
}

function toSpecRow(found: SpecWithScope): SpecRow {
  const { spec, scope, projectId } = found;
  return {
    id: spec.frontmatter.id ?? spec.fileName,
    title: spec.frontmatter.title ?? spec.fileName,
    description: spec.frontmatter.description ?? null,
    tags: spec.frontmatter.tags ?? [],
    filePath: spec.filePath,
    scope,
    projectId,
    updated: spec.frontmatter.updated,
  };
}

function toCheckpointRow(entry: CheckpointEntry): CheckpointRow {
  return {
    id: entry.id,
    time: entry.time,
    type: entry.type,
    title: entry.title,
    message: entry.message,
  };
}

function toTrashRow(meta: TrashMeta): TrashRow {
  return {
    id: meta.id,
    type: meta.type,
    title: meta.title,
    entityId: meta.entityId,
    trashedAt: meta.trashedAt,
    originalPath: meta.originalPath,
  };
}

function toSearchRow(result: SearchResult): SearchRow {
  const meta = (result.meta ?? {}) as Record<string, unknown>;
  const asString = (value: unknown): string | undefined =>
    typeof value === 'string' ? value : undefined;
  const projectIds = Array.isArray(meta.projectIds)
    ? (meta.projectIds as unknown[]).filter((id): id is string => typeof id === 'string')
    : [];
  return {
    type: result.type,
    title: result.title,
    snippet: result.snippet,
    filePath: asString(meta.filePath),
    projectIds,
    specId: asString(meta.specId),
    taskId: asString(meta.taskId),
    checkpointId: asString(meta.checkpointId),
    relationId: asString(meta.relationId),
    weakMatch: meta.weakMatch === true,
    semanticRank: typeof meta.semanticRank === 'number' ? meta.semanticRank : undefined,
    matchedVia: meta.matchedVia,
  };
}

export interface TaskDetailBundle {
  task: TaskRow | null;
  progress: CheckpointRow[];
  tree: TaskDetail['tree'];
  lineage: TaskRow[];
}

/**
 * 宿主数据服务：委托 @qcqx/lattice-services，附加扩展行模型与 DB 生命周期。
 */
export class LatticeDataService {
  private dbReady: Promise<boolean> | null = null;
  private dbError: string | null = null;

  constructor(
    private readonly getConflictsCwd?: () => string | undefined,
    private readonly userScope?: { readonly browseUser: string | undefined },
  ) {}

  // ── DB 生命周期（宿主职责）──

  /**
   * 懒初始化数据库：
   * 1. 优先绑定 node:sqlite（Electron 内置，无 ABI 问题）
   * 2. 老运行时回退自动探测（better-sqlite3：CLI/web/测试环境）
   * 返回是否可用；不可用时 services 层自动回退文件真源。
   */
  private ensureDb(): Promise<boolean> {
    if (!this.dbReady) {
      this.dbReady = (async () => {
        try {
          const nodeSqlite = await useNodeSqliteDriver();
          if (!nodeSqlite) await resolveDatabaseDriver();
          await initDb();
          return true;
        } catch (error) {
          this.dbError = error instanceof Error ? error.message : String(error);
          return false;
        }
      })();
    }
    return this.dbReady;
  }

  /** 后台预热 DB（激活时 fire-and-forget；失败静默，走文件真源）。 */
  async warmDb(): Promise<boolean> {
    return this.ensureDb();
  }

  /** 数据根变更后重置 DB 与运行态（配置变更时调用）。 */
  async resetDb(): Promise<void> {
    try {
      closeDb();
    } catch {
      // ignore
    }
    this.dbReady = null;
    this.dbError = null;
  }

  dispose(): void {
    try {
      closeDb();
    } catch {
      // ignore
    }
  }

  dbStatus(): { driver: string; available: boolean; error: string | null } {
    return {
      driver: getBoundDatabaseDriver()?.name ?? 'unresolved',
      available: this.dbReady !== null,
      error: this.dbError,
    };
  }

  // ── 宿主信息 ──

  async version(): Promise<string> {
    return CORE_VERSION;
  }

  async executablePath(): Promise<string> {
    const ok = await this.ensureDb();
    const driver = getBoundDatabaseDriver()?.name ?? 'unresolved';
    return ok
      ? `in-process core (${driver})`
      : `in-process core (db unavailable: ${this.dbError ?? 'unknown'})`;
  }

  // ── 用户 ──

  async username(): Promise<string> {
    return this.userScope?.browseUser ?? lattice.currentUsername();
  }

  /**
   * 只读浏览模式：拦截写入（数据面兜底；命令层另有引导文案）。
   * 文案与 core 错误保持一致（本模块保持 vscode-free，单测直接导入）。
   */
  private assertWritable(): void {
    const browse = this.userScope?.browseUser;
    if (browse) {
      throw new Error(`只读浏览用户「${browse}」期间不可修改；退出只读浏览后再试。`);
    }
  }

  // ── 项目 ──

  async projectList(): Promise<{ projects: ProjectRow[]; relations: RelationRow[] }> {
    await this.ensureDb();
    const username = await this.username();
    const [metas, relations] = await Promise.all([
      lattice.listProjects(username),
      lattice.listRelations(username),
    ]);
    return { projects: metas.map(toProjectRow), relations: relations.map(toRelationRow) };
  }

  async projectWhere(dir: string): Promise<ProjectWhereResult> {
    await this.ensureDb();
    const username = await this.username();
    const { exact, prefixMatches } = await lattice.findProjectsByPath(username, dir);
    return {
      exact: exact ? toProjectRow(exact) : null,
      prefixMatches: prefixMatches.map(toProjectRow),
    };
  }

  async projectUpdate(
    id: string,
    updates: { name?: string; description?: string; tags?: string[] },
  ): Promise<void> {
    this.assertWritable();
    await this.ensureDb();
    const username = await this.username();
    const updated = await lattice.updateProject(username, id, updates);
    if (!updated) throw new Error(`未找到项目: ${id}`);
  }

  // ── 任务 ──

  async taskList(): Promise<TaskRow[]> {
    const username = await this.username();
    return (await lattice.listTasks(username)).map(toTaskRow);
  }

  async taskInfo(id: string): Promise<{ meta: TaskRow | null; prd: string }> {
    const username = await this.username();
    const info = await lattice.getTaskInfo(username, id);
    return { meta: info.meta ? toTaskRow(info.meta) : null, prd: info.prd };
  }

  async taskProgress(id: string, opts: { last?: number } = {}): Promise<CheckpointRow[]> {
    const username = await this.username();
    return (await lattice.listCheckpoints(username, id, { last: opts.last })).map(toCheckpointRow);
  }

  async taskCheckpointDetail(taskId: string, checkpointId: string): Promise<CheckpointRow | null> {
    const username = await this.username();
    const entry = await lattice.getTaskCheckpoint(username, taskId, checkpointId);
    return entry ? toCheckpointRow(entry) : null;
  }

  async taskDetailBundle(id: string): Promise<TaskDetailBundle> {
    await this.ensureDb();
    const username = await this.username();
    const detail = await lattice.getTaskDetail(username, id);
    return {
      task: detail.task ? toTaskRow(detail.task) : null,
      progress: detail.progress.map(toCheckpointRow),
      tree: detail.tree,
      lineage: detail.lineage.map(toTaskRow),
    };
  }

  async taskCreate(
    title: string,
    opts: { projectIds?: string[]; parentId?: string; cwd?: string } = {},
  ): Promise<string> {
    this.assertWritable();
    const username = await this.username();
    const meta = await lattice.createTask(username, title, {
      projects: opts.projectIds,
      parentTaskId: opts.parentId,
    });
    return meta.id;
  }

  async taskSetStatus(
    id: string,
    action: 'start' | 'complete' | 'archive' | 'reopen',
  ): Promise<void> {
    this.assertWritable();
    const username = await this.username();
    await lattice.setTaskStatus(username, id, action);
  }

  async taskUpdateTitle(id: string, title: string): Promise<void> {
    this.assertWritable();
    const username = await this.username();
    await lattice.updateTaskTitle(username, id, title);
  }

  async taskDelete(id: string): Promise<void> {
    this.assertWritable();
    const username = await this.username();
    await lattice.deleteTask(username, id);
  }

  async taskCheckpoint(
    id: string,
    opts: { type: string; title: string; message: string },
  ): Promise<void> {
    this.assertWritable();
    const username = await this.username();
    await lattice.addTaskCheckpoint(username, id, opts);
  }

  async taskAssociate(id: string, opts: { projectId?: string; paths?: string[] }): Promise<void> {
    this.assertWritable();
    await this.ensureDb();
    const username = await this.username();
    await lattice.associateTask(username, id, opts);
  }

  async taskRefSpec(
    id: string,
    specIds: string[],
    opts: { projectId?: string | null } = {},
  ): Promise<void> {
    this.assertWritable();
    const username = await this.username();
    await lattice.addTaskSpecRefs(username, id, specIds, opts);
  }

  async taskUnrefSpec(id: string, specId: string): Promise<void> {
    this.assertWritable();
    const username = await this.username();
    await lattice.removeTaskSpecRefs(username, id, [specId]);
  }

  // ── 关系 ──

  async relationAdd(
    projectA: string,
    projectB: string,
    opts: { type?: string; description?: string; taskId?: string } = {},
  ): Promise<void> {
    this.assertWritable();
    await this.ensureDb();
    const username = await this.username();
    await lattice.addRelation(username, projectA, projectB, opts);
  }

  async relationRemove(relationId: string): Promise<void> {
    this.assertWritable();
    await this.ensureDb();
    const username = await this.username();
    await lattice.removeRelation(username, relationId);
  }

  // ── Spec ──

  async specList(): Promise<SpecGroups> {
    await this.ensureDb();
    const username = await this.username();
    const specs = (await lattice.listSpecs(username)).map(toSpecRow);
    return {
      global: specs.filter((row) => row.scope === 'global'),
      user: specs.filter((row) => row.scope === 'user'),
      project: specs.filter((row) => row.scope === 'project'),
    };
  }

  async specConflicts(cwd?: string): Promise<ConflictRow[]> {
    await this.ensureDb();
    const username = await this.username();
    let projectId = '';
    const target = cwd ?? this.getConflictsCwd?.();
    if (target) {
      try {
        projectId = (await lattice.findProjectsByPath(username, target)).exact?.id ?? '';
      } catch {
        projectId = '';
      }
    }
    const conflicts = await lattice.detectConflicts(username, projectId);
    return conflicts.flatMap((conflict) =>
      conflict.levels.map((level) => ({
        fileName: conflict.fileName,
        scope: level.scope,
        specId: level.specId ?? '',
        filePath: level.filePath,
        snippet: level.snippet,
      })),
    );
  }

  async specShow(idOrName: string): Promise<SpecRow | null> {
    await this.ensureDb();
    const username = await this.username();
    const found = await lattice.findSpec(username, idOrName);
    return found ? toSpecRow(found) : null;
  }

  async specMigrate(_cwd?: string, _signal?: AbortSignal): Promise<unknown> {
    this.assertWritable();
    return lattice.migrateSpecs({ scope: 'all' });
  }

  // ── 搜索 / 上下文 ──

  async search(
    query: string,
    opts: { types?: string[]; limit?: number; signal?: AbortSignal } = {},
  ): Promise<SearchRow[]> {
    await this.ensureDb();
    const username = await this.username();
    const results = await lattice.search(username, query, {
      types: opts.types,
      limit: opts.limit,
    });
    return results.map(toSearchRow);
  }

  async contextForTask(taskId: string, query?: string): Promise<unknown> {
    await this.ensureDb();
    const username = await this.username();
    if (query) {
      return lattice.search(username, query);
    }
    return lattice.getTaskContext(username, taskId);
  }

  async contextForProject(projectId?: string, query?: string): Promise<unknown> {
    await this.ensureDb();
    const username = await this.username();
    if (query) {
      return lattice.search(username, query, { projectId });
    }
    if (!projectId) {
      return {
        projectSpecs: [],
        userSpecs: [],
        globalSpecs: [],
        cascadedSpecs: [],
        activeTasks: [],
        relatedProjects: [],
      };
    }
    return lattice.getProjectContextBundle(username, projectId);
  }

  // ── 维护 ──

  async ragStatus(): Promise<Record<string, unknown>> {
    if (!(await this.ensureDb())) throw new Error(`数据库不可用: ${this.dbError ?? 'unknown'}`);
    return lattice.getRagStatus() as unknown as Record<string, unknown>;
  }

  async doctor(opts: { fix?: boolean; signal?: AbortSignal } = {}): Promise<DoctorReportRow> {
    if (opts.fix) this.assertWritable();
    if (!(await this.ensureDb())) throw new Error(`数据库不可用: ${this.dbError ?? 'unknown'}`);
    const report = await lattice.runDoctor({ fix: opts.fix });
    return mapDoctorReport(report as unknown);
  }

  async ragIndex(
    action: 'update' | 'rebuild',
    opts: { onProgress?: Parameters<typeof lattice.updateRag>[1]; signal?: AbortSignal } = {},
  ): Promise<number> {
    this.assertWritable();
    if (!(await this.ensureDb())) throw new Error(`数据库不可用: ${this.dbError ?? 'unknown'}`);
    return lattice.updateRag(action, opts.onProgress);
  }

  // ── 回收站 ──

  async trashList(): Promise<TrashRow[]> {
    const username = await this.username();
    return (await lattice.listTrash(username)).map(toTrashRow);
  }

  async trashRestore(entryId: string): Promise<void> {
    this.assertWritable();
    const username = await this.username();
    await lattice.restoreTrash(username, entryId);
  }

  async trashPurge(entryId: string): Promise<void> {
    this.assertWritable();
    await lattice.purgeTrash(entryId);
  }
}
