import { LatticeDataService } from '../data/service';
import { ViewSearchTarget } from '../state/view-search';
import { SnapshotStore } from '../state/snapshot';
import { type ViewSearchPreviewRow, type ViewSearchState } from './view-search-logic';
import { VIEW_SEARCH_TARGET_CONFIG } from './view-search-targets';
import type { ProjectsProvider } from './projects';
import type { SpecsProvider } from './specs';
import type { TasksProvider } from './tasks';

/**
 * 视图搜索实时预览服务：组合三 provider 的过滤管道（与树严格同源），
 * 本地名称匹配同步即时；全文命中（FTS）异步并入（调用方防抖 + AbortSignal）。
 */
export interface ViewSearchPreviewResult {
  query: string;
  /** 截断后的预览行（名称命中在前、仅全文命中在后）。 */
  rows: ViewSearchPreviewRow[];
  /** 截断前的总命中数（用于「N 条结果」文案）。 */
  total: number;
}

/** 预览上限（design.md §2.1）。 */
export const VIEW_SEARCH_PREVIEW_LIMIT = 50;

export class ViewSearchPreviewService {
  constructor(
    private readonly data: LatticeDataService,
    private readonly snapshot: SnapshotStore,
    private readonly providers: {
      tasks: TasksProvider;
      specs: SpecsProvider;
      projects: ProjectsProvider;
    },
  ) {}

  /** 打开选择器前确保对应分区已加载。 */
  async ensure(target: ViewSearchTarget): Promise<void> {
    if (target === 'tasks') await this.snapshot.ensure(['tasks', 'projects', 'user']);
    else if (target === 'specs')
      await this.snapshot.ensure(['specs', 'conflicts', 'tasks', 'projects']);
    else await this.snapshot.ensure(['projects', 'tasks', 'specs', 'user']);
  }

  /** 本地名称类字段命中（同步，零延迟）。 */
  local(target: ViewSearchTarget, query: string): ViewSearchPreviewResult {
    return this.build(target, query, []);
  }

  /** 全文命中 id（FTS）：任务覆盖 PRD/设计/检查点正文，规范覆盖 spec 正文，项目覆盖元数据。 */
  async contentIds(
    target: ViewSearchTarget,
    query: string,
    signal: AbortSignal,
  ): Promise<string[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const config = VIEW_SEARCH_TARGET_CONFIG[target];
    const rows = await this.data.search(trimmed, {
      types: config.ftsTypes,
      limit: 200,
      signal,
    });
    return [...new Set(rows.flatMap((row) => config.collectIds(row)))];
  }

  /** 并入全文命中后的预览（与 local 同管道，仅 contentIds 不同）。 */
  withContent(
    target: ViewSearchTarget,
    query: string,
    contentIds: string[],
  ): ViewSearchPreviewResult {
    return this.build(target, query, contentIds);
  }

  private build(
    target: ViewSearchTarget,
    query: string,
    contentIds: string[],
  ): ViewSearchPreviewResult {
    const state: ViewSearchState = { query, contentIds };
    const rows =
      target === 'tasks'
        ? this.providers.tasks.preview(state)
        : target === 'specs'
          ? this.providers.specs.preview(state)
          : this.providers.projects.preview(state);
    // 名称命中优先（contentOnly 排序降级），稳定排序保持 provider 内自然顺序
    const sorted = [...rows].sort((a, b) => Number(a.contentOnly) - Number(b.contentOnly));
    return {
      query,
      rows: sorted.slice(0, VIEW_SEARCH_PREVIEW_LIMIT),
      total: sorted.length,
    };
  }
}
