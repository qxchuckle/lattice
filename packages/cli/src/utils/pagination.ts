/**
 * list 类命令通用翻页能力（CLI 输出层）。
 *
 * 默认不翻页 = 输出全部；传 `--page-size` 才窗口化，并附 `{page, pageSize, total, totalPages}`
 * 元数据，消费方据此可翻遍全部（翻页 ≠ 截断，信息完整可达）。
 *
 * 本模块只负责窗口切分与人读渲染；`--json` 的输出 shape 由 json-projection 的
 * `projectTable` 决定（列式表 `{cols, rows}` 与分页元数据并列）。`--page` / `--page-size`
 * 选项由 `index.ts` 的 walker 按 projection-manifest 的 `kind = 'table'` 派生注册，
 * 命令文件不手写。
 *
 * 翻页在命令既有过滤（`--last`/`--project`/`--limit` 等）之后组合：filter → paginate。
 */

export interface PaginationOptions {
  page?: number;
  pageSize?: number;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> extends PaginationMeta {
  entries: T[];
}

/** paginate 返回：未分页是原数组，分页是带元数据的窗口对象 */
export type MaybePaginated<T> = T[] | Paginated<T>;

/** 未传 pageSize → 原样返回全部数组；传了 → 返回带元数据的分页窗口 */
export function paginate<T>(items: T[], opts: PaginationOptions): MaybePaginated<T> {
  const pageSize = opts.pageSize && opts.pageSize > 0 ? opts.pageSize : 0;
  if (pageSize === 0) return items;
  const total = items.length;
  const page = Math.max(1, opts.page ?? 1);
  const start = (page - 1) * pageSize;
  return {
    entries: items.slice(start, start + pageSize),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** 从 paginate 结果取要展示的条目（分页时是本页，否则全部） */
export function paginationEntries<T>(result: MaybePaginated<T>): T[] {
  return Array.isArray(result) ? result : result.entries;
}

/** 分页时返回人读脚注，未分页返回 undefined */
export function paginationNote<T>(result: MaybePaginated<T>): string | undefined {
  if (Array.isArray(result)) return undefined;
  return `第 ${result.page}/${result.totalPages} 页 · 本页 ${result.entries.length} 条 · 共 ${result.total} 条`;
}

/** 分页元数据（未分页返回 undefined）；供 JSON 输出与表头并列 */
export function paginationMeta<T>(result: MaybePaginated<T>): PaginationMeta | undefined {
  if (Array.isArray(result)) return undefined;
  const { page, pageSize, total, totalPages } = result;
  return { page, pageSize, total, totalPages };
}
