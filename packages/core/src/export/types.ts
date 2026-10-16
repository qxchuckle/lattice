/**
 * 知识导出（`ltc export`）类型定义。
 *
 * 面向未来导出类型扩展：资源类型走 kinds 注册式收集器，新增类型 = 加收集器 + 文档，
 * 引擎与命令面不动。详见任务 2026-10-16-25d8 design.md / prd.md。
 */
import type { TaskStatus } from '../types';

/** 导出资源类型（可扩展） */
export type ExportKind = 'spec' | 'task';

/** spec 层级过滤（all = 不过滤；global/user/project 可组合为集合） */
export type SpecExportScope = 'global' | 'user' | 'project' | 'all';

/** 任务导出深度 */
export type TaskExportDepth = 'digest' | 'prd' | 'full';

/** 导出参数（CLI 与 API 共用；不含 execUser） */
export interface ExportOptions {
  /** 资源类型；缺省 = 全部已注册类型（当前 spec + task） */
  kinds?: ExportKind[];

  // ── spec 专属 ──
  /** 层级过滤（可组合：global / user / project；含 'all' 或缺省 = 不过滤） */
  scope?: SpecExportScope[];
  /** 精确 tag 白名单（可多个，任一命中） */
  tags?: string[];
  /** 精确 tag 黑名单（命中即剔除，排除优先） */
  excludeTags?: string[];
  /** 精确条目：spec id / 文件名（无通配 = 前缀匹配；含通配符 = glob 整串匹配） */
  specs?: string[];
  excludeSpecs?: string[];

  // ── task 专属 ──
  /** 任务 id 白名单（无通配 = 前缀匹配；含通配符 = glob 整串匹配） */
  tasks?: string[];
  excludeTasks?: string[];
  /** 任务状态；缺省 ['archived']；含 'all' 时视为不过滤 */
  taskStatuses?: (TaskStatus | 'all')[];
  /** 时间窗（按 created，YYYY-MM-DD，UTC 日期边界，双端 inclusive） */
  taskSince?: string;
  taskUntil?: string;
  /** 任务深度；缺省 digest */
  taskDepth?: TaskExportDepth;

  // ── 通用（spec + task） ──
  /** 关键词白名单（可多个，任一命中）：spec 元数据+项目元数据；task 标题/PRD/设计档案/过程记录 */
  filters?: string[];
  /** 关键词黑名单（命中即剔除） */
  excludeFilters?: string[];
  /** 项目白名单：id/name/文件夹名/包名/git remote（非通配=大小写不敏感子串；含通配符 = glob 整串匹配、`*` 含 `/`） */
  projects?: string[];
  excludeProjects?: string[];
  /** 用户白名单（可多个；'all' = 全部用户）；缺省由 CLI 传当前用户 */
  users?: string[];
  /** 用户黑名单 */
  excludeUsers?: string[];

  // ── 产物 ──
  /** skill 名（SKILL.md frontmatter name），默认 lattice-knowledge */
  skillName?: string;
  /** 覆盖自动生成的 description */
  description?: string;
  /** 输出目录，默认 ~/.lattice/.cache/export-skill/<skill名>/ */
  outputDir?: string;
  /** 清空目标目录后重导（不限是否本工具产物；与 overwrite / prune 互斥） */
  clean?: boolean;
  /** 目标目录非空且非本工具管理时覆盖合并写入（同名路径覆盖、其余保留；与 clean 互斥） */
  overwrite?: boolean;
  /** 删除旧 manifest 记录、本次未导出的陈旧文件（含清空的目录；与 clean 互斥） */
  prune?: boolean;
  /** 只预演：筛选/统计/警告，不写盘（不执行 clean/prune） */
  dryRun?: boolean;
}

/** 运行时参数：补 execUser 与 CLI 解析后的缺省值 */
export interface ExportRunOptions extends ExportOptions {
  /** 执行导出的用户（users 缺省时仅导出其数据；global spec 前缀记该用户） */
  execUser?: string;
}

// ─── 产物 / manifest ───

export interface ExportFileSource {
  kind: 'spec' | 'task' | 'meta';
  level?: 'global' | 'user' | 'project';
  user: string;
  specId?: string;
  taskId?: string;
  status?: TaskStatus;
  updated?: string;
  projectId?: string;
}

export interface ExportFileEntry {
  path: string;
  hash: string;
  title: string;
  source: ExportFileSource;
  /** 生成文件标记（SKILL.md 等，非源文档） */
  generated?: boolean;
}

export interface ExportManifest {
  exportedAt: string;
  tool: 'lattice-export';
  version: 2;
  name: string;
  stats: { global: number; user: number; project: number; tasks: number };
  files: ExportFileEntry[];
}

export type ExportWarningType =
  | 'local-path'
  | 'lattice-path'
  | 'ltc-ref'
  | 'dangling-ref'
  | 'sensitive';

export interface ExportWarning {
  file: string;
  type: ExportWarningType;
  message: string;
}

/** 项目过滤命中透明：每个过滤值实际命中的项目 */
export interface ExportProjectMatch {
  filter: 'include' | 'exclude';
  value: string;
  /** 命中的项目显示名（未命中为空数组） */
  projects: string[];
}

export interface ExportStats {
  /** 收集器产出（已按用户/层级/状态等基础口径收集） */
  scannedSpecs: number;
  scannedTasks: number;
  /** 被维度筛选剔除 */
  excludedSpecs: number;
  excludedTasks: number;
  /** 最终导出 */
  exportedSpecs: number;
  exportedTasks: number;
}

export interface ExportResult {
  outputDir: string;
  dryRun: boolean;
  manifest: ExportManifest;
  /** 本次写入的文件（新增或内容变更） */
  written: string[];
  /** hash 未变而跳过写入的文件 */
  skipped: string[];
  /** prune 删除的陈旧文件（dry-run 时为空） */
  deleted: string[];
  /** prune 目标清单（dry-run 时为「将删除」，非 dry-run 时与 deleted 同源） */
  wouldDelete: string[];
  warnings: ExportWarning[];
  /** 缺 description 的导出 spec（specId 供直接 ref-spec/set） */
  missingDescriptions: { path: string; specId?: string }[];
  stats: ExportStats;
  projectMatches: ExportProjectMatch[];
  /** 被选中但结果为空、章节显示「无」的资源类型 */
  emptyKinds: ExportKind[];
}

// ─── 校验 ───

export interface ExportVerifyIssue {
  path: string;
  type: 'hash-mismatch' | 'missing' | 'extra';
  message: string;
}

export interface ExportVerifyResult {
  dir: string;
  ok: boolean;
  checked: number;
  issues: ExportVerifyIssue[];
}
