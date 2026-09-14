/**
 * CLI `--json` 出口声明表 —— 每个有 JSON 出口的命令一条，是**选项注册与文档校验的单一真源**。
 *
 * 存在理由：一个命令的 `--json` 行为此前分散在三方手写（选项 hint 18 处、翻页注册 10 处、
 * hub 与分片文档清单 9 份），彼此无机械约束 → 已实证 6 类漂移（代码有文档无 / 文档有代码无 /
 * 字段名过期 / 清单漏项 / 选项措辞不一致 / hint 与实现脱节）。声明表把能派生的降为 1 份副本
 * （选项由 `index.ts` 的 walker 遍历注册），不能派生的（文档散文、action 里的投影调用）由
 * `packages/cli/scripts/check-projection-doc-sync.mjs` 机械校验。
 *
 * `kind` 五档决定该命令的 `--json` 形态与选项：
 *
 * | kind | 含义 | 自动注册的选项 | 投影入口（action 内自行调用） |
 * |---|---|---|---|
 * | `table` | list 类：翻页 + 列式表 `{cols,rows}` | `--json-full` + `--page` + `--page-size` | `projectTable` |
 * | `list` | 数组出口，不翻页（如相关性排序结果） | `--json-full` | `projectList` |
 * | `item` | 单对象 / 报告类出口 | `--json-full` | `projectItem`（可嵌套 `projectList` 各段） |
 * | `detail` | 只跑 L1 去重复表示，保留完整精度与正文 | 无（声明了也与默认输出无差异 = 死选项） | `dedupeItem` |
 * | `raw` | 有 JSON 出口但不走投影层（输出极小 / 写命令返回值） | 无 | `outputJson` 直接序列化 |
 *
 * `detail` 与 `raw` **必须**写 `note`（记录"为何不投影 / 为何不设逃生阀"这一已评估事实，
 * 防止后来者把"没接投影"误读成"忘了接"）；`table`/`list`/`item` **必须**写 `fullHint`
 * （判别联合在编译期钉死这两条，写错即 tsc 报错）。
 *
 * 文案约束（`ai-doc-writing-style`）：hint 只陈述当前行为，不写改动历史；限定语绑定作用域
 * （"两种模式都已去除"要点明是去重层，避免被读成 `--json-full` 也压缩）。
 */

/** hub `command-reference.md` 路由表里的 6 个职责域分片 */
export type CommandDocShard =
  | 'cli-context-search.md'
  | 'cli-project.md'
  | 'cli-task.md'
  | 'cli-spec.md'
  | 'cli-sync-user.md'
  | 'cli-system.md';

/** 走瘦身层的命令：`--json-full` 是它的逃生阀，必须给 hint 文案 */
interface ProjectedEntry {
  /** 命令全路径（空格分隔，与 `--help` 层级一致，不含参数占位符） */
  command: string;
  kind: 'table' | 'list' | 'item';
  doc: CommandDocShard;
  /** `--json-full` 的帮助文案（由 walker 注册，不在命令文件手写） */
  fullHint: string;
}

/** 不走瘦身层的命令：禁止声明 `--json-full`，必须写明已评估理由 */
interface PlainEntry {
  command: string;
  kind: 'detail' | 'raw';
  doc: CommandDocShard;
  note: string;
}

export type ProjectionEntry = ProjectedEntry | PlainEntry;

export const PROJECTION_MANIFEST: readonly ProjectionEntry[] = [
  /* ─── 上下文与检索（cli-context-search.md） ─── */
  {
    command: 'context',
    kind: 'item',
    doc: 'cli-context-search.md',
    fullHint:
      'JSON 输出未投影对象（完整 querySearch meta 含 RAG 内部打分/调试字段、各段为对象数组不做列式与压缩）；默认 --json 各段为列式表 {cols,rows}。spec content 两者均不含，正文走 spec show',
  },
  {
    command: 'search',
    kind: 'list',
    doc: 'cli-context-search.md',
    fullHint:
      'JSON 输出原始结果数组（完整 meta 含内部调试字段、meta 不拍平、不做列式）；默认 --json 为列式表 {cols,rows}',
  },
  {
    command: 'status',
    kind: 'item',
    doc: 'cli-context-search.md',
    fullHint:
      'JSON 输出未投影的原始对象（完整时间戳、activeTasks 保留完整 referencedSpecs、不做列式）；默认 --json 走投影层',
  },

  /* ─── 项目管理（cli-project.md） ─── */
  {
    command: 'project list',
    kind: 'table',
    doc: 'cli-project.md',
    fullHint:
      'JSON 输出原始对象数组（保留完整 git_first_commit 与完整时间戳、不做列式）；默认 --json 为列式表 {cols,rows}，只留解析后的 camelCase 字段。与解析版同值的 snake_case 原始 DB 列属重复表示，两种模式都已去除',
  },
  {
    command: 'project relation list',
    kind: 'table',
    doc: 'cli-project.md',
    fullHint: 'JSON 输出原始对象数组（不做列式/压缩；默认 --json 为列式表 {cols,rows}）',
  },
  {
    command: 'project profile check',
    kind: 'item',
    doc: 'cli-project.md',
    fullHint:
      'JSON 输出原始结果（分组条目保留 status 字段、不做列式/压缩）；默认 --json 各分组为列式表 {cols,rows}，status 由分组键表达故省略',
  },
  {
    command: 'project info',
    kind: 'detail',
    doc: 'cli-project.md',
    note: 'detail：保留完整精度（完整 git_first_commit、relations 与 taskIds 明细）；等于 [id] 的 ids 属重复表示，已去除',
  },
  {
    command: 'project where',
    kind: 'detail',
    doc: 'cli-project.md',
    note: 'detail：保留完整精度与空值字段；exact 与 project list 行同 shape，输出的绝对路径可直接喂回其他命令',
  },
  {
    command: 'project register',
    kind: 'raw',
    doc: 'cli-project.md',
    note: '写命令，返回注册结果（成功/跳过清单），无列表数据可投影',
  },
  {
    command: 'project profile show',
    kind: 'raw',
    doc: 'cli-project.md',
    note: '画像全量是设计内的完整输入（1cd3 第三轮判定 detail-by-design，不裁字段）',
  },
  {
    command: 'project profile brief',
    kind: 'raw',
    doc: 'cli-project.md',
    note: '输出极小（实测 0.2K token），投影无收益',
  },
  {
    command: 'project profile tags show',
    kind: 'raw',
    doc: 'cli-project.md',
    note: '输出极小（tags 数组 + tags.json 路径）',
  },

  /* ─── 任务生命周期（cli-task.md） ─── */
  {
    command: 'task list',
    kind: 'table',
    doc: 'cli-task.md',
    fullHint:
      'JSON 输出原始对象数组（完整 referencedSpecs 明细与时间戳、不做列式；默认 --json 为列式表 {cols,rows}，referencedSpecs 降为 id 数组）',
  },
  {
    command: 'task progress',
    kind: 'table',
    doc: 'cli-task.md',
    fullHint: 'JSON 输出原始对象数组（完整时间戳、不做列式；默认 --json 为列式表 {cols,rows}）',
  },
  {
    command: 'fast-start log list',
    kind: 'table',
    doc: 'cli-task.md',
    fullHint: 'JSON 输出原始对象数组（完整时间戳、不做列式；默认 --json 为列式表 {cols,rows}）',
  },
  {
    command: 'fast-start log search',
    kind: 'table',
    doc: 'cli-task.md',
    fullHint: 'JSON 输出原始对象数组（完整时间戳、不做列式；默认 --json 为列式表 {cols,rows}）',
  },
  {
    command: 'task info',
    kind: 'detail',
    doc: 'cli-task.md',
    note: 'detail：保留完整精度与正文（prd 全文、ISO 时间戳、图视图）；与 tree 全等的 descendants、与 meta 全等的单条 lineage 属重复表示，已去除',
  },
  {
    command: 'fast-start log show',
    kind: 'detail',
    doc: 'cli-task.md',
    note: 'detail：保留完整 message 与 files 全文、完整 ISO 时间戳',
  },
  {
    command: 'task tree',
    kind: 'raw',
    doc: 'cli-task.md',
    note: '输出即树视图本身，实测 <1.5K token（1cd3 第七轮判定小、不投影）',
  },
  {
    command: 'task lineage',
    kind: 'raw',
    doc: 'cli-task.md',
    note: '输出即链路视图本身，实测 0.6K token',
  },
  {
    command: 'task checkpoint',
    kind: 'raw',
    doc: 'cli-task.md',
    note: '写命令，返回创建的 checkpoint 条目',
  },
  {
    command: 'task associate',
    kind: 'raw',
    doc: 'cli-task.md',
    note: '写命令，返回关联结果（recognized / unrecognized / scopePaths）',
  },
  {
    command: 'fast-start log add',
    kind: 'raw',
    doc: 'cli-task.md',
    note: '写命令，返回创建的日志条目',
  },
  {
    command: 'fast-start log stats',
    kind: 'raw',
    doc: 'cli-task.md',
    note: '输出极小（实测 0.06K token 的计数字段）',
  },

  /* ─── 规范管理（cli-spec.md） ─── */
  {
    command: 'spec list',
    kind: 'table',
    doc: 'cli-spec.md',
    fullHint:
      'JSON 输出原始分组对象（含每个 spec 的 content 全文、不做列式）；默认 --json 剥离 content（正文走 spec show）且每个分组的 specs 为列式表 {cols,rows}',
  },
  {
    command: 'spec template registry list',
    kind: 'table',
    doc: 'cli-spec.md',
    fullHint: 'JSON 输出原始对象数组（不做列式/压缩；默认 --json 为列式表 {cols,rows}）',
  },
  {
    command: 'spec conflicts',
    kind: 'list',
    doc: 'cli-spec.md',
    fullHint:
      'JSON 输出原始冲突数组（fileName + 嵌套 levels）；默认 --json 扁平化为列式表 {cols,rows}，每个层级一行',
  },
  {
    command: 'spec template list',
    kind: 'list',
    doc: 'cli-spec.md',
    fullHint: 'JSON 输出原始模板对象数组（不做列式/压缩）；默认 --json 为列式表 {cols,rows}',
  },
  {
    command: 'spec lint',
    kind: 'list',
    doc: 'cli-spec.md',
    fullHint: 'JSON 输出原始报告对象数组（不做列式/压缩）；默认 --json 为列式表 {cols,rows}',
  },
  {
    command: 'spec suggest-description',
    kind: 'item',
    doc: 'cli-spec.md',
    fullHint: 'JSON 的 specs 输出原始对象数组（不做列式）；默认为列式表 {cols,rows}',
  },
  {
    command: 'spec show',
    kind: 'detail',
    doc: 'cli-spec.md',
    note: 'detail：保留完整精度与正文（--detail 时含 content）；fileName 与退化为 basename 的 relativePath 属重复表示，已去除',
  },
  {
    command: 'spec migrate',
    kind: 'raw',
    doc: 'cli-spec.md',
    note: '写命令，返回迁移结果（changed / skipped 清单）',
  },
  {
    command: 'spec export',
    kind: 'raw',
    doc: 'cli-spec.md',
    note: '报告型输出（导出结果 + missingDescriptions），非列表数据',
  },

  /* ─── 同步与多用户（cli-sync-user.md） ─── */
  {
    command: 'user list',
    kind: 'table',
    doc: 'cli-sync-user.md',
    fullHint: 'JSON 输出原始对象数组（不做列式/压缩；默认 --json 为列式表 {cols,rows}）',
  },
  {
    command: 'user current',
    kind: 'raw',
    doc: 'cli-sync-user.md',
    note: '输出单个 JSON 字符串（人读通道输出裸值供 shell 捕获）',
  },
  {
    command: 'sync domain list',
    kind: 'raw',
    doc: 'cli-sync-user.md',
    note: '输出极小（域条目数组，实测个位数 token）',
  },

  /* ─── 安装与系统维护（cli-system.md） ─── */
  {
    command: 'trash list',
    kind: 'table',
    doc: 'cli-system.md',
    fullHint: 'JSON 输出原始对象数组（不做列式/压缩；默认 --json 为列式表 {cols,rows}）',
  },
  {
    command: 'doctor',
    kind: 'raw',
    doc: 'cli-system.md',
    note: '报告型输出（诊断条目 + 修复建议），实测 0.8K token；报告类命令不接翻页',
  },
  {
    command: 'rag status',
    kind: 'raw',
    doc: 'cli-system.md',
    note: '输出极小（实测 0.2K token 的索引计数）',
  },
  {
    command: 'config get',
    kind: 'raw',
    doc: 'cli-system.md',
    note: '输出单个配置值（JSON 标量）',
  },
  {
    command: 'config show',
    kind: 'raw',
    doc: 'cli-system.md',
    note: '输出极小（实测 0.1K token 的配置对象）',
  },
];

/** 按命令全路径查声明；未声明的命令返回 undefined（校验脚本据此报"漏声明"） */
export function findProjectionEntry(commandPath: string): ProjectionEntry | undefined {
  return PROJECTION_MANIFEST.find((entry) => entry.command === commandPath);
}

/**
 * 该命令的 `--json-full` hint；`detail` / `raw` 返回 undefined（walker 据此**不注册**该选项，
 * 避免声明了却与默认输出无差异的死选项）。
 */
export function jsonFullHintFor(commandPath: string): string | undefined {
  const entry = findProjectionEntry(commandPath);
  if (!entry) return undefined;
  // 正向逐值判定（判别联合对否定式检查不做 narrowing）
  return entry.kind === 'table' || entry.kind === 'list' || entry.kind === 'item'
    ? entry.fullHint
    : undefined;
}

/** 接翻页的命令（`kind = 'table'`）：walker 据此注册 `--page` / `--page-size` */
export function isPaginatedCommand(commandPath: string): boolean {
  return findProjectionEntry(commandPath)?.kind === 'table';
}
