import type { Command } from 'commander';

/**
 * list 类命令通用翻页能力（CLI 输出层）。
 *
 * 默认不翻页 = 输出全部（向后兼容，`--json` 仍是数组）；传 `--page-size` 才窗口化，
 * `--json` 返回 `{ entries, page, pageSize, total, totalPages }`——带 total/totalPages
 * 元数据，消费方据此可翻遍全部（翻页 ≠ 截断，信息完整可达）。
 *
 * 翻页在命令既有过滤（`--last`/`--project`/`--limit` 等）之后组合：filter → paginate。
 */

export interface PaginationOptions {
  page?: number;
  pageSize?: number;
}

export interface Paginated<T> {
  entries: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** paginate 返回：未分页是原数组，分页是带元数据的窗口对象 */
export type MaybePaginated<T> = T[] | Paginated<T>;

/** 给 list 类命令注册统一翻页参数（默认不传 = 输出全部） */
export function withPaginationOptions<C extends Command>(cmd: C): C {
  return cmd
    .option('--page <n>', '页码（1-based，配合 --page-size；默认输出全部）', parseInt)
    .option('--page-size <n>', '每页条数（不传则一次输出全部）', parseInt);
}

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
