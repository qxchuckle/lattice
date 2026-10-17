/**
 * CLI `--json` 投影形态解析工具。
 * 约定（spec-gm2b5wvr）：列表默认输出列式表 {cols, rows}，取值必须按列名对齐，
 * 禁止硬编码列位置；detail 命令为对象/数组；空结果为空列式表。所有解析容忍缺列。
 */

export interface ColumnTable {
  cols: string[];
  rows: unknown[][];
}

export type Row = Record<string, unknown>;

export function isColumnTable(value: unknown): value is ColumnTable {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.cols) && Array.isArray(v.rows) && v.cols.every((c) => typeof c === 'string')
  );
}

/** 把任意载荷归一化为对象数组：对象数组 / 列式表 / 单对象 / null。 */
export function toRows(payload: unknown): Row[] {
  if (payload === null || payload === undefined) return [];
  if (Array.isArray(payload)) {
    return payload
      .filter((x): x is Row => x !== null && typeof x === 'object' && !Array.isArray(x))
      .map((x) => x as Row);
  }
  if (isColumnTable(payload)) {
    const { cols, rows } = payload;
    return rows.map((r) => {
      const obj: Row = {};
      cols.forEach((c, i) => {
        obj[c] = Array.isArray(r) ? r[i] : undefined;
      });
      return obj;
    });
  }
  if (typeof payload === 'object') return [payload as Row];
  return [];
}

/** 仅接受「对象数组」形态（用于内联明细，如 project list --json-full 的 relations）。 */
export function objArray(value: unknown): Row[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is Row => x !== null && typeof x === 'object' && !Array.isArray(x));
}

export function firstRow(payload: unknown): Row | undefined {
  return toRows(payload)[0];
}

export function str(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

export function strOr(value: unknown, fallback: string): string {
  return str(value) ?? fallback;
}

export function num(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

export function bool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

export function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}

/** 截断长文本（用于 description/tooltip，不用于数据）。 */
export function truncate(text: string | undefined, max: number): string {
  if (!text) return '';
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length > max ? `${single.slice(0, max)}…` : single;
}
