import type { ParsedSpec, SearchResult, TaskMeta } from '@qcqx/lattice-core';
import { paginate, paginationEntries, paginationMeta, type PaginationOptions } from './pagination';

/**
 * CLI `--json` 输出投影层。两层正交：
 *
 * - **L1 去重复表示（`dedupeItem`）——两种模式都生效，含 `--json-full`**：删掉「同一信息在
 *   载荷内的第二份拷贝」，判据是**可由同对象内另一字段机械还原**（basename / JSON.parse /
 *   id 前缀 / 路径段 / 值完全相同）。信息零损失，故不设逃生阀。
 * - **L2 瘦身投影（`compactItem` + 各 `strip*` + `toTable`）——仅默认 `--json`**：省略空值、
 *   ISO 时间戳降日期、丢 RAG 内部打分/调试字段、detail 归位（如 spec content）、列式编码。
 *   这些是「省略独立信息但可从别处取回」，故 `--json-full` 是其逃生阀。
 *
 * 硬约束（详见任务 2026-09-11-1cd3 design.md）：
 * - 不截断数组条目、不裁剪相关信息字段；
 * - 只在 CLI 输出层投影，不改 core 数据结构（web 直调 core 消费全量，改 CLI 输出零 web 风险）。
 */

/* ─── L1：去重复表示（两种模式都生效，含 --json-full） ─── */

/** ProjectRow 的原始 snake_case JSON 字符串列 ↔ 解析后的 camelCase 数组（同值双份） */
const RAW_PARSED_PAIRS: readonly (readonly [string, string])[] = [
  ['local_path', 'localPaths'],
  ['git_remote', 'gitRemotes'],
  ['package_names', 'packageNames'],
  ['monorepo_packages', 'monorepoPackages'],
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 原始 JSON 字符串列是否与解析后的数组同值（同值即纯重复，可删） */
function rawEqualsParsed(raw: unknown, parsed: unknown): boolean {
  if (typeof raw !== 'string' || !Array.isArray(parsed)) return false;
  try {
    return JSON.stringify(JSON.parse(raw)) === JSON.stringify(parsed);
  } catch {
    return false;
  }
}

/**
 * 取「同对象内的 filePath」；找不到时向**直接子对象**下探一层——仅供 `snippet` 同值判定使用
 * （搜索结果在 `--json-full` 下 filePath 位于嵌套的 `meta` 里，默认模式已拍平到顶层）。
 * `fileName` / `relativePath` 的判定**不下探**：它们所属的 ParsedSpec 形态里 filePath 恒为兄弟字段，
 * 下探会让「顶层 fileName + 子对象 filePath」这类无关组合被误判为重复。
 */
function nestedFilePath(obj: Record<string, unknown>): string | null {
  if (typeof obj.filePath === 'string') return obj.filePath;
  for (const val of Object.values(obj)) {
    if (isPlainObject(val) && typeof val.filePath === 'string') return val.filePath;
  }
  return null;
}

/** `matchedVia` 内部去重：docType 可由 docPath 的路径段推出；有 `tasks` 数组时其余字段都是它的派生 */
function dedupeMatchedVia(mv: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...mv };
  delete out.docType;
  if (Array.isArray(out.tasks) && out.tasks.length > 0) {
    // docTitle = tasks[].taskTitle 的 join、docPath/taskId = tasks[0] 的字段 → 全部可由 tasks 还原
    delete out.docTitle;
    delete out.docPath;
    delete out.taskId;
  }
  return out;
}

/**
 * 删除「同一信息在同一对象内的第二份拷贝」。判据严格：**值完全相同、或可由兄弟字段机械还原**才删，
 * 递归进数组与嵌套对象。信息零损失，故 `--json-full` 也生效、不设逃生阀。
 *
 * | 规则 | 依据 |
 * |---|---|
 * | `fileName` 等于 `basename(filePath)` 时删 | `fileName` 定义即 basename，零信息 |
 * | `relativePath` 等于 `basename(filePath)` 时删 | 此时与 fileName 同值、可由 filePath 还原；**不等时保留**——含子目录的 relativePath 是 scope 内身份（`spec conflicts` 的跨层冲突键、域 namespace 键），不可机械还原 |
 * | 原始 snake_case JSON 串列与解析后数组同值时删 | `local_path` ↔ `localPaths` 等四对，实测逐条相等 |
 * | `ids` 等于 `[id]` 时删 | 单 id 项目的两份写法（合并项目 `ids` 多于一个时保留） |
 * | `matchedVia` 内部：删 `docType`；有 `tasks` 时删 `docTitle`/`docPath`/`taskId` | docType 可由 docPath 路径段推出；后三者是 `tasks` 的派生（join / 首元素）。**无 `tasks` 时保留 `docTitle`**——它是完整任务标题，docPath 里只有截断 slug，不可机械还原 |
 * | `snippet` 与 `filePath` / `title` 同值时删 | 同一字符串重复出现（project 类搜索结果）；filePath 允许在直接子对象里 |
 * | `lineage` 与 `meta` 全等、`descendants` 与 `tree` 全等时删 | 由调用方在载荷层判定（跨键比较，见 `task info`） |
 *
 * **不属于本层**（信息有损、只是"可从别处取回" → 归 L2 或命令级投影）：`git_first_commit`
 * 的完整 40 位 sha（`id` 只含前 16 位）、单任务 `matchedVia.docTitle`（需 `task info` 取回）。
 */
export function dedupeItem(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dedupeItem);
  if (!isPlainObject(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) out[key] = dedupeItem(val);

  const filePath = typeof out.filePath === 'string' ? out.filePath : null;
  if (filePath) {
    const base = filePath.split('/').pop();
    if (out.fileName === base) delete out.fileName;
    if (out.relativePath === base) delete out.relativePath;
  }
  for (const [raw, parsed] of RAW_PARSED_PAIRS) {
    if (raw in out && rawEqualsParsed(out[raw], out[parsed])) delete out[raw];
  }
  if (Array.isArray(out.ids) && out.ids.length === 1 && out.ids[0] === out.id) delete out.ids;
  if (isPlainObject(out.matchedVia)) out.matchedVia = dedupeMatchedVia(out.matchedVia);
  const snippetPath = filePath ?? nestedFilePath(out);
  if (
    typeof out.snippet === 'string' &&
    (out.snippet === snippetPath || out.snippet === out.title)
  ) {
    delete out.snippet;
  }
  return out;
}

/* ─── L2：瘦身投影（仅默认 --json；--json-full 是其逃生阀） ─── */

/**
 * 搜索结果 meta 白名单：保留消费方据以行动的字段（定位 / 引用 / 相关性 / 溯源）。
 * 其余为 RAG 排序中间量（finalScore / ftsRank / fusionScore / *Boost / *Weight /
 * keywords / domainTerms / scopeTerms / headings / matchedKeywords / scopeKey /
 * docKind / domain / duplicateCount / sources 等），默认丢弃。
 *
 * `matchedSections` 在白名单内，但投影时只保留 headingPath（见 cleanSearchResults）。
 */
export const SEARCH_META_FIELDS_KEEP = new Set<string>([
  'filePath',
  'specId',
  'taskId',
  'checkpointId',
  'relationId',
  'username',
  'projectIds',
  'source', // ='task-ref' 等命中溯源语义（rag-architecture-conventions）
  'matchedVia', // 经由任务关联发现的溯源
  'duplicates', // 同名折叠副本
  'weakMatch',
  'normalizedScore',
  'semanticRank',
  'semanticDistance',
  'matchedSections',
]);

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * 搜索结果投影：裁掉 meta 中的 RAG 打分/调试字段；matchedSections 只留 headingPath
 * （内层 snippet 与顶层 snippet 冗余、headingLevel/distance 属调试信号）。
 * 保留的 meta 字段**拍平到顶层**（列式表需要扁平列；`meta` 包裹层每行重复一次纯属开销）。
 *
 * `matchedVia` 折叠与同值 `snippet` 删除属**纯重复**，由 L1 `dedupeItem` 统一处理（两种模式都生效），
 * 此处不重复实现。search 与 context 的 querySearch 共用。
 */
export function cleanSearchResults(results: SearchResult[]): Record<string, unknown>[] {
  return results.map((r) => {
    const meta = (r.meta ?? {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {
      type: r.type,
      title: r.title,
      snippet: r.snippet,
      score: round(r.score ?? 0),
    };
    for (const key of Object.keys(meta)) {
      if (!SEARCH_META_FIELDS_KEEP.has(key) || key in out) continue;
      const val = meta[key];
      if (val === null || val === undefined) continue;
      if (key === 'matchedSections' && Array.isArray(val)) {
        const paths = (val as Array<{ headingPath?: unknown }>)
          .map((s) => s?.headingPath)
          .filter((p): p is string => typeof p === 'string' && p.length > 0);
        if (paths.length > 0) out[key] = paths;
        continue;
      }
      out[key] = typeof val === 'number' ? round(val) : val;
    }
    return out;
  });
}

/**
 * spec 投影：剥离 content 全文（正文属 detail，走 `spec show` / `--json-full`），
 * 保留 title / filePath / id / description / tags / scope。
 * 坏 spec 的 parseError 保留——展示类消费方须显式携带解析失败信息，不得静默丢弃
 * （spec-io-yaml-conventions：不得伪装成 `[缺失摘要]`）。
 */
export function stripSpecContent(spec: ParsedSpec, scope?: string): Record<string, unknown> {
  const { id, title, description, tags } = spec.frontmatter;
  return {
    title: title ?? spec.fileName,
    filePath: spec.filePath,
    ...(id ? { id } : {}),
    ...(description ? { description } : {}),
    ...(tags?.length ? { tags } : {}),
    ...(scope ? { scope } : {}),
    ...(spec.parseError ? { parseError: spec.parseError } : {}),
  };
}

/** spec 数组投影 */
export function stripSpecs(specs: ParsedSpec[], scope?: string): Record<string, unknown>[] {
  return specs.map((s) => stripSpecContent(s, scope));
}

/**
 * 任务投影：referencedSpecs 降为纯 id 数组（relativePath / scope / projectId / firstReadAt
 * 属 detail，走 `task info` / `--json-full`）；其余字段（含 scopePaths）保留，条目不截断。
 */
export function stripTaskMeta<T extends TaskMeta>(task: T): Record<string, unknown> {
  const { referencedSpecs, ...rest } = task;
  return {
    ...rest,
    ...(referencedSpecs?.length ? { referencedSpecs: referencedSpecs.map((s) => s.id) } : {}),
  };
}

/** 任务数组投影 */
export function stripTaskList<T extends TaskMeta>(tasks: T[]): Record<string, unknown>[] {
  return tasks.map((t) => stripTaskMeta(t));
}

/**
 * 删掉条目的指定字段——`strip*` 的实现原语。
 * 具名 wrapper 保留（不直接到处调 omitFields），因为它们承载「这个字段为什么可省」的说明。
 *
 * 注：`project list` 的原始 DB 列 / `git_first_commit`、spec 类的 `fileName` / 退化 `relativePath`
 * 都属**纯重复表示**，已由 L1 `dedupeItem` 条件化处理（两种模式都生效），不再各写一个 strip 函数。
 */
function omitFields<T>(items: T[], keys: readonly string[]): Record<string, unknown>[] {
  return items.map((item) => {
    const out: Record<string, unknown> = { ...(item as Record<string, unknown>) };
    for (const key of keys) delete out[key];
    return out;
  });
}

/**
 * L2：`git_first_commit` 的完整 40 位 sha 中，前 16 位已含于 `id`（形如 `git:<sha16>`）；
 * 余下 24 位属可从 git 仓库 / DB 取回的 detail → **仅默认 `--json` 省略，`--json-full` 保留**。
 * 归 L2 而非 L1：这不是「可由兄弟字段机械还原」（id 只含前缀），是有损但可别处取回。
 */
export function stripDerivableSha(row: Record<string, unknown>): Record<string, unknown> {
  const { id, git_first_commit: sha } = row;
  if (
    typeof id === 'string' &&
    id.startsWith('git:') &&
    typeof sha === 'string' &&
    sha.startsWith(id.slice(4))
  ) {
    delete row.git_first_commit;
  }
  return row;
}

/**
 * 画像检查条目投影：`status` 与所在分组键同义（`stale`→'stale' / `noProfile`→'no-profile' /
 * `warnings`→'warning'），属结构性冗余，删；`reasons` 保留（stale / warnings 的判定依据）。
 * 单项目模式（`project profile check --project`）不适用——那里没有分组键，status 是有效信息。
 */
export function stripProfileStatus<T>(items: T[]): Record<string, unknown>[] {
  return omitFields(items, ['status']);
}

/* ─── 条目压缩 + 列式表（TOON 的表格思想：字段名只声明一次） ─── */

/** 完整 ISO 时间戳（17 token/个）；list/search 只需日粒度（8 token/个） */
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function isEmptyValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0) ||
    (isPlainObject(value) && Object.keys(value).length === 0)
  );
}

function compactValue(value: unknown): unknown {
  if (typeof value === 'string') return ISO_DATETIME.test(value) ? value.slice(0, 10) : value;
  if (Array.isArray(value)) return value.map(compactValue);
  if (isPlainObject(value)) return compactItem(value);
  return value;
}

/**
 * 条目级压缩（所有投影命令共用），只删冗余、不删信息：
 * - 省略 null / 空串 / 空数组 / 空对象（缺省即空；列式表中仍会作为 null 占位）；
 * - ISO 时间戳降到日期（完整精度见 `--json-full` 与 detail 命令）。
 *
 * **递归进嵌套对象与数组**：project 的 `relations`、task 的 `scopePaths` 这类嵌套结构同样
 * 受这两条规则约束——只压一层会让压缩随数据形状静默失效（实测曾有 658 个完整 ISO 漏网）。
 *
 * 注意：不要对**已含列式表**的载荷再套本函数——`{cols:[],rows:[]}` 的空 `rows` 会被当空值删掉。
 * 列式化（`toTable`）永远是最后一步。
 */
export function compactItem(item: unknown): unknown {
  if (!isPlainObject(item)) return compactValue(item);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    if (isEmptyValue(value)) continue;
    const compacted = compactValue(value);
    if (isEmptyValue(compacted)) continue;
    out[key] = compacted;
  }
  return out;
}

export interface JsonTable {
  cols: string[];
  rows: unknown[][];
}

/**
 * 对象数组 → 列式表 `{cols, rows}`：字段名整份输出只声明一次，行按 cols 顺序取值，
 * 缺失值为 null；空数组 → `{cols:[],rows:[]}`。
 * 条目非纯对象时原样返回（列式无法表达）。shape 一律可预测，不设行数下限——
 * 小数组省下的 token 远不如「同一命令永远同一种 shape」值钱（消费方无需分支处理）。
 */
export function toTable(items: unknown[]): JsonTable | unknown[] {
  if (!items.every(isPlainObject)) return items;
  const cols: string[] = [];
  for (const item of items) {
    for (const key of Object.keys(item as Record<string, unknown>)) {
      if (!cols.includes(key)) cols.push(key);
    }
  }
  const rows = (items as Record<string, unknown>[]).map((item) =>
    cols.map((c) => (isEmptyValue(item[c]) ? null : item[c])),
  );
  return { cols, rows };
}

/** 无翻页场景（search / context 各段数组）：L1 去重 →（默认模式再加）L2 压缩 + 列式表 */
export function projectList(items: unknown[], opts: { jsonFull?: boolean } = {}): unknown {
  const deduped = items.map(dedupeItem);
  if (opts.jsonFull) return deduped;
  return toTable(deduped.map(compactItem));
}

/** 单对象出口（detail / 报告类命令，如 `status`、`project profile check --project`）：L1 去重 →（默认模式再加）L2 压缩 */
export function projectItem(item: unknown, opts: { jsonFull?: boolean } = {}): unknown {
  const deduped = dedupeItem(item);
  return opts.jsonFull ? deduped : compactItem(deduped);
}

/**
 * list 类场景：L1 去重 →（默认模式再加）L2 压缩 → 翻页 → 列式表；
 * 分页时表头与分页元数据并列。`--json-full` 只做 L1（去重复表示）+ 翻页，不做 L2。
 */
export function projectTable(
  items: unknown[],
  opts: PaginationOptions & { jsonFull?: boolean },
): unknown {
  const deduped = items.map(dedupeItem);
  if (opts.jsonFull) return paginate(deduped, opts);
  const paged = paginate(deduped.map(compactItem), opts);
  const table = toTable(paginationEntries(paged));
  const meta = paginationMeta(paged);
  if (!meta) return table;
  return Array.isArray(table) ? { entries: table, ...meta } : { ...table, ...meta };
}
