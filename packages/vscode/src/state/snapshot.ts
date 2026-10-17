import { LatticeDataService } from '../data/service';
import { ConflictRow, ProjectRow, RelationRow, SpecGroups, SpecRow, TaskRow } from '../cli/types';
import { Emitter } from '../util/emitter';
import { normalizeLegacyId, stripIdPrefix } from '../util/paths';

export type SnapshotSection = 'user' | 'projects' | 'tasks' | 'specs' | 'conflicts';

/** 失败冷却（ms）：防止「视图刷新 → ensure → 失败 → 事件 → 再刷新」的忙循环。 */
const FAILURE_COOLDOWN_MS = 10_000;

export interface SnapshotState {
  username: string | null;
  projects: ProjectRow[];
  relations: RelationRow[];
  tasks: TaskRow[];
  specs: SpecGroups;
  conflicts: ConflictRow[];
  loaded: Record<SnapshotSection, boolean>;
  errors: Partial<Record<SnapshotSection, string>>;
}

export interface SnapshotOptions {
  data: LatticeDataService;
  getConflictsCwd?: () => string | undefined;
  onError?: (section: SnapshotSection, error: Error) => void;
}

/** 分区快照缓存：懒加载 + 单飞 + 失效重载 + 派生索引（design.md §4.2）。 */
export class SnapshotStore {
  private state: SnapshotState = {
    username: null,
    projects: [],
    relations: [],
    tasks: [],
    specs: { global: [], user: [], project: [] },
    conflicts: [],
    loaded: { user: false, projects: false, tasks: false, specs: false, conflicts: false },
    errors: {},
  };
  private inflight = new Map<SnapshotSection, Promise<void>>();
  private lastAttemptAt: Partial<Record<SnapshotSection, number>> = {};
  private changeEmitter = new Emitter<SnapshotSection[]>();
  private generation = 0;

  private projectAliases = new Map<string, ProjectRow>();
  private taskIndex = new Map<string, TaskRow>();
  private specIndex = new Map<string, SpecRow>();

  constructor(private readonly options: SnapshotOptions) {}

  get data(): Readonly<SnapshotState> {
    return this.state;
  }

  get gen(): number {
    return this.generation;
  }

  get onDidChange(): (listener: (sections: SnapshotSection[]) => void) => { dispose(): void } {
    return this.changeEmitter.event;
  }

  /** 确保指定分区已加载（默认只加载未加载过的；force 强制重载）。失败不抛错，仅记录（视图显示空态）。 */
  async ensure(sections: SnapshotSection[], opts: { force?: boolean } = {}): Promise<void> {
    const now = Date.now();
    const pending = sections.filter((s) => {
      if (!opts.force && this.state.loaded[s]) return false;
      if (!opts.force && this.state.errors[s] !== undefined) {
        const last = this.lastAttemptAt[s] ?? 0;
        if (now - last < FAILURE_COOLDOWN_MS) return false;
      }
      return true;
    });
    await Promise.all(pending.map((s) => this.loadSection(s)));
  }

  /** 失效分区并主动重载（写操作后调用，避免等 watcher）。 */
  async invalidate(sections: SnapshotSection[], opts: { reload?: boolean } = {}): Promise<void> {
    for (const s of sections) this.state.loaded[s] = false;
    if (opts.reload === false) {
      this.generation++;
      this.changeEmitter.fire(sections);
      return;
    }
    await this.ensure(sections, { force: true });
  }

  private loadSection(section: SnapshotSection): Promise<void> {
    const existing = this.inflight.get(section);
    if (existing) return existing;
    this.lastAttemptAt[section] = Date.now();
    const task = this.doLoad(section).finally(() => this.inflight.delete(section));
    this.inflight.set(section, task);
    return task;
  }

  private async doLoad(section: SnapshotSection): Promise<void> {
    try {
      switch (section) {
        case 'user': {
          this.state.username = await this.options.data.username();
          break;
        }
        case 'projects': {
          const { projects, relations } = await this.options.data.projectList();
          this.state.projects = projects;
          this.state.relations = relations;
          this.rebuildProjectIndex();
          break;
        }
        case 'tasks': {
          this.state.tasks = await this.options.data.taskList();
          this.rebuildTaskIndex();
          break;
        }
        case 'specs': {
          this.state.specs = await this.options.data.specList();
          this.rebuildSpecIndex();
          break;
        }
        case 'conflicts': {
          this.state.conflicts = await this.options.data.specConflicts(
            this.options.getConflictsCwd?.(),
          );
          break;
        }
      }
      this.state.loaded[section] = true;
      delete this.state.errors[section];
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.state.errors[section] = err.message;
      this.options.onError?.(section, err);
    }
    this.generation++;
    this.changeEmitter.fire([section]);
  }

  // ── 派生索引与查询 ──

  private rebuildProjectIndex(): void {
    this.projectAliases.clear();
    for (const project of this.state.projects) {
      if (project.id) {
        this.projectAliases.set(project.id, project);
        this.projectAliases.set(stripIdPrefix(project.id), project);
      }
    }
  }

  private rebuildTaskIndex(): void {
    this.taskIndex.clear();
    for (const task of this.state.tasks) this.taskIndex.set(task.id, task);
  }

  private rebuildSpecIndex(): void {
    this.specIndex.clear();
    const all = [...this.state.specs.project, ...this.state.specs.user, ...this.state.specs.global];
    for (const spec of all) {
      if (spec.id && !this.specIndex.has(spec.id)) this.specIndex.set(spec.id, spec);
    }
  }

  /** 任一 id 形态（带/不带前缀）→ 项目行。 */
  findProject(anyId: string | undefined): ProjectRow | undefined {
    if (!anyId) return undefined;
    return this.projectAliases.get(anyId) ?? this.projectAliases.get(normalizeLegacyId(anyId));
  }

  canonicalProjectId(anyId: string | undefined): string | undefined {
    return this.findProject(anyId)?.id ?? anyId;
  }

  taskById(id: string | undefined): TaskRow | undefined {
    return id ? this.taskIndex.get(id) : undefined;
  }

  specById(id: string | undefined): SpecRow | undefined {
    return id ? this.specIndex.get(id) : undefined;
  }

  get allSpecs(): SpecRow[] {
    return [...this.state.specs.project, ...this.state.specs.user, ...this.state.specs.global];
  }

  tasksForProject(projectId: string | undefined): TaskRow[] {
    if (!projectId) return [];
    const canonical = this.canonicalProjectId(projectId);
    return this.state.tasks.filter((t) =>
      t.projects.some((p) => this.canonicalProjectId(p) === canonical),
    );
  }

  activeTasksForProject(projectId: string | undefined): TaskRow[] {
    return this.tasksForProject(projectId).filter((t) => t.status === 'in_progress');
  }

  childrenOf(taskId: string): TaskRow[] {
    return this.state.tasks.filter((t) => t.parentTaskId === taskId);
  }

  tasksReferencingSpec(specId: string | undefined): TaskRow[] {
    if (!specId) return [];
    return this.state.tasks.filter((t) => t.referencedSpecs.some((r) => r.id === specId));
  }

  projectSpecs(projectId: string | undefined): SpecRow[] {
    if (!projectId) return [];
    const canonical = this.canonicalProjectId(projectId);
    return this.state.specs.project.filter((s) => s.projectId === canonical);
  }

  relationsForProject(projectId: string | undefined): RelationRow[] {
    if (!projectId) return [];
    const canonical = this.canonicalProjectId(projectId);
    return this.state.relations.filter(
      (r) =>
        this.canonicalProjectId(r.projectA) === canonical ||
        this.canonicalProjectId(r.projectB) === canonical,
    );
  }

  relationPeer(relation: RelationRow, projectId: string | undefined): string {
    const canonical = this.canonicalProjectId(projectId);
    return this.canonicalProjectId(relation.projectA) === canonical
      ? relation.projectB
      : relation.projectA;
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}
