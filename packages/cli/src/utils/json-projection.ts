import type { ParsedSpec, SearchResult, TaskMeta } from '@qcqx/lattice-core';

/**
 * CLI `--json` 输出投影层。
 *
 * 默认 `--json` 只保留对 AI / 脚本消费有用的字段，去除 RAG 内部打分/调试字段与冗余重复；
 * `--json-full` 由各命令输出未经投影的原始全量。
 *
 * 硬约束（详见任务 2026-09-11-1cd3 design.md）：
 * - 不截断数组条目、不裁剪相关信息字段，只删「无关字段」（内部打分/调试）与「冗余重复」；
 * - 只在 CLI 输出层投影，不改 core 数据结构（web 直调 core 消费全量，改 CLI 输出零 web 风险）。
 */

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
 * search 与 context 的 querySearch 共用。
 */
export function cleanSearchResults(results: SearchResult[]): unknown[] {
  return results.map((r) => {
    const meta = (r.meta ?? {}) as Record<string, unknown>;
    const cleanMeta: Record<string, unknown> = {};
    for (const key of Object.keys(meta)) {
      if (!SEARCH_META_FIELDS_KEEP.has(key)) continue;
      const val = meta[key];
      if (val === null || val === undefined) continue;
      if (key === 'matchedSections' && Array.isArray(val)) {
        const paths = (val as Array<{ headingPath?: unknown }>)
          .map((s) => s?.headingPath)
          .filter((p): p is string => typeof p === 'string' && p.length > 0);
        if (paths.length > 0) cleanMeta.matchedSections = paths;
        continue;
      }
      cleanMeta[key] = typeof val === 'number' ? round(val) : val;
    }
    return {
      type: r.type,
      title: r.title,
      snippet: r.snippet,
      score: round(r.score ?? 0),
      meta: cleanMeta,
    };
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
 * project list 投影：ProjectRow 的原始 snake_case JSON 字符串列与解析后的 camelCase
 * 数组字段重复（local_path↔localPaths / git_remote↔gitRemotes /
 * package_names↔packageNames / monorepo_packages↔monorepoPackages），去掉原始列。
 * 纯去重、零信息丢失（解析版携带同样内容）；`--json-full` 保留原始列。
 */
const PROJECT_RAW_DUP_COLUMNS = [
  'local_path',
  'git_remote',
  'package_names',
  'monorepo_packages',
] as const;

export function stripProjectRawColumns(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const col of PROJECT_RAW_DUP_COLUMNS) delete out[col];
  return out;
}
