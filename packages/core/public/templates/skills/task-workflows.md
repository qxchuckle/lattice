# 任务工作流

任务全生命周期：创建/起手/实施期循环/checkpoint/归档。硬约束见 [lattice-rules.md](lattice-rules.md)；spec 见 [spec-workflows.md](spec-workflows.md)。

## 任务目录结构

```
~/.lattice/users/<username>/tasks/<task-id>/
├── task.json       # 元数据唯一来源（id/title/status/projects/scopePaths）
├── prd.md          # 当前最佳认知快照，边做边修订（无 YAML frontmatter）
├── progress.yaml   # 追加型过程日志（11 类 checkpoint）
└── design.md       # 方案讨论档案（被否决方案的唯一承载点）
```

PRD 管"应该是什么"，progress 管"发生了什么"，design 管"怎么讨论出来的"。

## 任务模式：design vs implementation

`design（讨论）→ start（实施）→ design（中途）→ 实施 → archive`

- **design**：只读+分析，禁改业务代码，讨论写入 design.md
- **implementation**：start 后默认
- 未显式 design 但出现方案讨论 → 主动追加 design.md
- design 退出时 → 结论段精简为核心决策（→ [lattice-rules.md §二](lattice-rules.md#二design-模式约束)）

## 命令参数非任务 ID 时：标题归纳与查重

0. **项目定位（必做）**：有路径 → `ltc project where <path>`；有语义 → `ltc project list --search <kw>`；定位到 → `--project <id>`，无 → `--current`
1. 归纳简洁标题
2. 查重：`ltc task list --current` + `ltc search "<标题>" --type task --json`
3. 有相似 in_progress → 列候选给用户确认
4. `ltc task create "<标题>" [--current | --project <id>] [--parent <id>]`

## 父子任务

```bash
ltc task create "<title>" --parent <parent-id>
ltc task lineage <id> / ltc task tree <id> [--descendants]
ltc task update <id> --parent <id> / --clear-parent
```

## task start 后的起手动作

**必须委派 `lattice-task-start` subagent（不支持时退化串行）。**

```bash
ltc task start <task-id> && ltc context --task <task-id> --query "<主题>"
```

1. 按主题全文读取 spec（→ [spec-workflows.md](spec-workflows.md#按任务主题全文读取相关-spec)）：context 列表选读 + `ltc search` 补漏
2. 参考近似历史任务 PRD
3. 完善 PRD（目标、约束、方案、文件索引）
4. 有 design.md → 先 read
5. 输出整体确认（ID + 状态 + 标题 + 关联项目 + 父任务 + 关键约束）

## 实施期循环（每轮用户输入到来时）

```
用户输入 → ①PRD硬触发？→ ②spec选读？→ ③写代码 → ④checkpoint
```

### ① PRD 硬触发（T1~T8）

命中 → 先改 PRD → decision/pivot checkpoint → 才继续。

| # | 触发条件 |
|---|----------|
| T1 | 新需求/修改需求/推翻方案 |
| T2 | 采用/否决技术方案 |
| T3 | 新增/移除修改文件 |
| T4 | 单轮改 ≥3 业务文件 |
| T5 | 意外兼容性/边界/迁移问题 |
| T6 | 新依赖/模块边界/跨包调用 |
| T7 | 准备打 milestone |
| T8 | PRD 写入路径/包名/spec 但 task.json 未同步 |

### ② spec 选读（每轮必检）

触发条件（任一）：本轮主题词首次出现 · 用户提"规范/约定/历史/类似/跨项目" · 涉及层级判定 · 未涉及的模块边界/跨包 · 实现困难需查历史

### ③ 写代码前锚点

改 ≥3 业务文件 → 先 `read_file prd.md` 校对文件索引。缺失 → T3 先改 PRD。

### ④ checkpoint 前 PRD 自检

确认：改动文件在索引中 · 决策写入「当前方案」· 无未同步硬触发。未过 → 先改 PRD。

## checkpoint 类型

```bash
ltc task checkpoint <task-id> --type <type> --title "<标题>" -m "<内容>"
```

| type | 触发 | 格式 |
|---|---|---|
| `context` | 用户给出背景/规则/约束 | 原样或概述+引言 |
| `correction` | AI 犯错（用户指出/自发现） | **三段**：做错什么·为何错·正确做法 |
| `constraint` | 用户施加硬约束 | 明确"必须/不要" |
| `assumption` | AI 关键假设 | 推断内容 + 被推翻影响 |
| `followup` | 应做但延后 | 为何现在不做 |
| `note` | 客观事实 / 3 轮无 checkpoint 兜底 | 注明来源 |
| `decision` | 拍板选项 | 决策+理由 |
| `pivot` | 方向整体推翻 | 旧→新+原因 |
| `milestone` | 阶段成果验证通过 | — |
| `issue` | 非 AI 错误（环境/依赖） | — |
| `summary` | 归档前总结 | — |

**选型**：用户开口 → 用户输入类；AI 推断 → AI 判断类；客观事件 → 进程事件类；多语义 → 拆多条。

被否决方案 → design.md。查看：`ltc task progress <id> [--last N] [--type <type>]`

## 项目关联同步

| 场景 | 命令 |
|---|---|
| 当前目录项目 | `ltc task associate <id> --current` |
| 其他已注册项目 | `ltc task associate <id> --project <pid>` |
| 非注册路径 | `ltc task associate <id> --paths <path>` |

定位项目 ID：`ltc project where <path>` / `ltc project list --search <kw>`。发现新路径/项目当轮执行。

### spec 引用 + 元数据一致性

```bash
ltc task ref-spec <task-id> <spec-name>
ltc task unref-spec <task-id> <spec-id>
```

task.json 结构化字段是机器可读元数据唯一来源。PRD 写入路径/项目/spec → 同时 CLI 记录（T8）。

### 项目间关系

```bash
ltc project relation add <a> <b> --type <type> --description "证据" --ai-inferred --from-task <task-id>
```

| 现象 | 类型 |
|------|------|
| 共享 first commit / fork | `forked-from` |
| dependencies 引用 | `depends-on` |
| 共用 monorepo 包 | `shares-component` |
| 同组织无强证据 | `related` |

## 归档

**必须委派 `lattice-task-archive` subagent（不支持时退化串行）。**

### 前置采集（必做，未读就写总结 = 遗漏）

```bash
ltc task info <id> && ltc task progress <id> && ltc task progress <id> --type correction && ltc task progress <id> --type constraint && ltc task progress <id> --type context
```

另需：read design.md + `git diff --stat`

### 流程

```bash
# 1. 前置采集 → 2. 补 PRD（最终方案+总结+遗留）→ 3. summary checkpoint
ltc task checkpoint <id> --type summary --title "..." -m "..."
# 4. complete + archive
ltc task complete <id> && ltc task archive <id>
# 5. ltc rag update → 6. 二次审阅 + spec 沉淀判定
```

### 二次审阅

对照 progress：决策全在 PRD/checkpoint · 无遗漏改动 · 经验沉淀（→ [spec-workflows.md#沉淀判定](spec-workflows.md#沉淀判定)） · 项目关系补记。遗漏 → 立即补 + `ltc rag update`。

### 空参数归档推断

`ltc task list --current` + `ltc search "<主题>" --type task --json`。in_progress 仅 1 个且匹配 → 直接归档；多候选 → 列给用户。

## 输出原则

**精简**：不复述 CLI 输出、不罗列命令、不贴 JSON。

**不静默**：关键节点立即输出——创建后（标题+ID+项目）· 状态切换 · 关联变化 · 相似任务（列候选）· 归档完成（结果+要点）。

进入实施前补整体确认：ID + 状态 + 标题 + 关联项目 + 父任务 + 关键约束。
