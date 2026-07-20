# CLI 命令参数参考

> **本文权威范围**：Lattice CLI 主要命令、位置参数、选项参数的字典（`init` / `status` / `context` / `search` / `link` / `unlink` / `project` / `task` / `spec` / `scan` / `sync` / `user` / `config` / `doctor` / `rag` / `trash` / `fast-start` / `web`）+ 需要 `-f / --force` 跳过二次确认的命令清单。
>
> **使用方式**：本文是 *查阅式* 参考，仅在你已经从流程文档选定要调的命令、但需要查询它的参数拼写 / 默认值 / 互斥选项时才读。**不要把本文作为从 0 起步的学习入口**。
>
> **什么时候不该读本文**：
> - 不知道该调哪个命令 → 读流程文档（[task-workflows.md](task-workflows.md) / [spec-workflows.md](spec-workflows.md) / [project-context.md](project-context.md) / [project-discovery.md](project-discovery.md)）
> - 想了解什么时候该打 checkpoint → [task-workflows.md#checkpoint-类型与触发条件](task-workflows.md#checkpoint-类型与触发条件)
> - 想了解什么时候该动 spec → [spec-workflows.md#沉淀判定](spec-workflows.md#沉淀判定)
> - 想了解项目身份识别 / 多路径绑定 / 项目关系 → [project-discovery.md](project-discovery.md)
>
> 本文不复述强制规则（以 lattice-rules.md 为准）与输出原则（以 SKILL.md 为准）。

## 通用约定：`-f, --force` 跳过二次确认

以下命令包含交互式二次确认，**AI / Agent 调用时必须加 `-f` / `--force`**，否则会阻塞等待用户输入：

| 命令 | 确认内容 |
|---|---|
| `ltc init` | 是否下载 embedding 模型 |
| `ltc unlink` | 确认取消项目注册 |
| `ltc project remove <id>` | 确认删除项目数据 |
| `ltc project relation remove <a> <b>` | 确认删除项目关系 |
| `ltc task delete <id>` | 确认彻底删除任务 |
| `ltc user remove <name>` | 确认删除用户 |
| `ltc fast-start log clear` | 确认清空所有 fast-start 日志 |

## `ltc init`

初始化 `~/.lattice/`。

- `-f, --force`：跳过确认（如是否下载模型）
- `--username <name>`：指定用户名
- `--git [boolean]`：是否启用 Git 管理，默认开启
- `--git-remote <url>`：配置 Git 远程仓库
- `--scan-dirs <dirs>`：初始化时写入扫描目录，逗号分隔
- `--registry-template <urls>`：初始化时拉取模板仓库并写入全局 `registryTemplates`

### `ltc init scan`

扫描本地 git 项目并注册到 Lattice（可独立使用，也可在 `ltc init` 主流程末尾交互式触发）。**写入扫描缓存**。

- `-f, --force`：跳过确认
- `--dirs <dirs>`：扫描目录，逗号分隔；不传则使用配置中的 `scanDirs`，都无则交互式询问并写入配置
- `--auto`：使用配置中的 `scanDirs`，跳过交互

> **与 `ltc scan` 的区别**：`init scan` 写扫描缓存、有初始化检查、支持交互式配置输入、有确认步骤。常规扫描推荐使用本命令。

## `ltc status`

显示状态。

- `--global`：显示全局状态，而不是当前项目状态
- `--json`：以 JSON 输出

> **嵌套项目信息**：项目模式下会自动检测并显示祖先项目嵌套关系和 spec 级联优先级。

## `ltc context`

获取项目或任务上下文。

- `--task <id>`：按任务 ID 获取上下文
- `--project <id>`：按项目 ID 获取上下文
- `--json`：以 JSON 输出

> **嵌套项目继承**：当前项目处于另一个已注册 Lattice 项目的子目录时，会自动继承祖先项目的 spec。级联优先级：`当前项目 > 直接父级 > 更远祖先 > 用户级 > 全局级`。

## `ltc search <query>`

搜索 spec、任务、项目、检查点和关联关系。

- `<query>`：搜索词
- `--type <type>`：限制类型为 `spec` / `task` / `project` / `checkpoint` / `relation`
- `--project <id>`：限制到指定项目
- `--users <names>`：限制到指定用户，逗号分隔
- `--current-user`：只搜索当前用户内容
- `--limit <n>`：返回结果数量，默认 `10`
- `--no-rerank`：关闭轻量 rerank
- `--json`：以 JSON 输出；AI / Agent 调用时优先带上，便于读取完整元数据后再推理

> **多用户搜索**：默认搜索所有用户内容，结果中始终显示来源用户名。用 `--current-user` 限制为当前用户，或用 `--users` 指定用户。

> **搜索结果增强**：当结果类型为 `checkpoint` 时，`meta` 中会包含 `taskId`、`checkpointId`；当结果类型为 `relation` 时，`meta` 中会包含 `projectA`、`projectB`。

## `ltc link`

将当前目录注册为 Lattice 项目（通过 ID 匹配查找已注册项目，根据匹配结果走不同分支）。

> ⚠️ **AI 不得自动调用**。`ltc link` 是面向用户的命令，主要用于非 Git 项目和本地文件夹项目；Git 项目通过 `ltc scan` 自动发现，一般无需 link。AI 发现目录未注册时告知用户，由用户自行执行。

- `--name <name>`：手动指定项目名
- `--description <desc>`：项目描述
- `--groups <groups>`：项目分组，逗号分隔
- `--tags <tags>`：项目标签，逗号分隔
- `--template <templates>`：应用 spec 模板，逗号分隔，或传 `all`
- `--restore <id>`：直接重新绑定到已有项目 id（不交互）
- `--force-new`：强制创建新项目，跳过 ID 匹配
- `-y, --yes`：检测到候选时仅警告并创建新项目（非交互模式）

> **嵌套项目自动检测**：link 完成后会自动向上查找父级 `lattice.json`，若发现已注册的父项目则自动创建 `nested-in` 关系（`createdBy=auto`）。子项目运行 `ltc context` 时会自动继承祖先项目的 spec。

## `ltc unlink`

解除当前目录和 Lattice 项目的绑定。

- `--force`：跳过二次确认
- `--remove-data`：同时删除 Lattice 中的项目数据（关系与指纹会联动清理，仍可通过 trash restore 恢复）

## `ltc project`

项目管理。

### `ltc project list`

- `--group <group>`：按分组过滤
- `--tag <tag>`：按标签过滤
- `--search <keyword>`：按关键词搜索（大小写不敏感，匹配名称/ID/路径/Git/包名/分组/标签），默认附带 RAG 语义搜索（项目元数据 + 任务文档 PRD/checkpoint/design/spec 反查）
- `--keyword-only`：仅使用关键词匹配，跳过语义搜索
- `--has-git`：只显示含 git remote 的项目
- `--orphaned`：只显示所有 localPaths 都已失效的项目
- `--with-relations`：附带显示项目关系
- `--json`：以 JSON 输出
- `--json-format`：JSON 输出时使用格式化（默认压缩）

> **查找本地项目优先使用 `ltc project list --search <keyword>`**，支持按名称、ID、路径、Git remote、包名、分组、标签做大小写不敏感匹配。关键词未命中时自动回退到 RAG 语义搜索（项目元数据语义 + 任务文档 PRD/checkpoint/design/spec 通过 `projectIds` 反查关联项目，跨语言、语义等价词）；加 `--keyword-only` 可跳过语义搜索。

### `ltc project where <path>`

> 语义与触发条件：见 [project-discovery.md#进入未知目录时](project-discovery.md#进入未知目录时)。

查询指定路径属于哪个已注册项目（含父目录前缀匹配与 ID 回退）。

- `<path>`：要查询的路径，可相对可绝对
- `--json`：以 JSON 输出

### `ltc project info <id>`

- `<id>`：项目 ID
- `--json`：以 JSON 输出

### `ltc project update <id>`

- `<id>`：项目 ID
- `--name <name>`：更新项目名
- `--description <desc>`：更新描述
- `--groups <groups>`：更新分组，逗号分隔
- `--tags <tags>`：更新标签，逗号分隔

### `ltc project remove <id>`

- `<id>`：项目 ID
- `--force`：跳过确认

### `ltc project relation list [id]`

- `[id]`：可选，指定项目 ID 只看该项目的关系；不传则列出所有关系
- `--current-user`：仅显示当前用户定义的关系（不聚合其他用户）
- `--user <users>`：仅显示指定用户定义的关系，逗号分隔多个用户名
- `--json`：以 JSON 输出

> **跨用户聚合**：默认聚合所有用户定义的关系（来自其他用户的关系会标注 `[username]`）。`--current-user` 和 `--user` 互斥，不能同时使用。

### `ltc project relation add <project-a> <project-b>`

> 语义与触发条件：见 [project-discovery.md#项目关系含-ai-推断](project-discovery.md#项目关系含-ai-推断)。AI 推断的关系必须带 `--ai-inferred` + `--from-task`。

- `<project-a>`：项目 A的 ID
- `<project-b>`：项目 B 的 ID
- `--type <type>`：关系类型，默认 `related`（常用：forked-from / depends-on / shares-component / nested-in / related）
- `--description <desc>`：关系描述
- `--from-task <taskId>`：记录关系推断来源任务 ID
- `--ai-inferred`：标记为 AI 推断的关系（`createdBy=ai-inferred`）

### `ltc project relation remove <relation-id>`

- `<relation-id>`：关系的唯一 id（可从 `ltc project relation list` 返回中获得）
- `--force`：跳过确认

### `ltc project merge <from> <to>`

将两个项目物理合并为一个（`from` → `to`）：任务、spec、scopePaths 转移到 `to`，`from` 移入垃圾桶。事务操作，失败回滚。

- `<from>`：源项目 ID
- `<to>`：目标项目 ID
- `-f, --force`：跳过确认

> **虚拟合并 vs 物理合并**：IDs 有交集的项目在查询层自动虚拟合并（零物理操作），通常无需手动 merge。`merge` 用于需要真正消除重复项目的场景。

## `ltc task`

任务管理。

### `ltc task list`

- `--status <status>`：按 `planning` / `in_progress` / `completed` / `archived` / `all` 过滤
- `--project <id>`：按项目 ID 过滤
- `--current`：按当前目录对应的项目过滤（读取类：与当前目录无关时用 `--project <id>`）
- `--all-user`：聚合所有用户的任务（需搭配 `--project` 或 `--current`）
- `--user <users>`：聚合指定用户的任务，逗号分隔（需搭配 `--project` 或 `--current`）
- `--json`：以 JSON 输出

> **跨用户聚合**：`--all-user` 和 `--user` 互斥，不能同时使用。来自其他用户的任务会标注 `[username]`。不存在的用户名会报错并列出可用用户。

### `ltc task create <title>`

- `<title>`：任务标题
- `-p, --project <ids...>`：关联一个或多个项目 ID
- `--current`：自动关联当前目录对应项目（写入类：用户提供了路径/语义描述时必须先 `ltc project where` / `ltc project list --search` 定位，见 task-workflows.md「命令参数不是任务 ID 时」第 0 步）
- `--parent <id>`：指定父任务 ID，支持完整 ID 或前缀匹配

### `ltc task info <id>`

- `<id>`：任务 ID
- `--lineage`：显示父任务链路
- `--tree`：显示当前任务所在的整颗任务树
- `--descendants`：显示当前任务作为根的后代任务树
- `--json`：以 JSON 输出

### `ltc task update <id>`

- `<id>`：任务 ID，支持前缀匹配
- `--title <title>`：更新任务标题
- `--status <status>`：更新任务状态，支持 `planning` / `in_progress` / `completed` / `archived`
- `-p, --project <ids...>`：覆盖关联项目 ID 列表
- `--add-project <ids...>`：追加关联项目 ID
- `--remove-project <ids...>`：移除关联项目 ID
- `--clear-projects`：清空关联项目
- `--add-current-project`：将当前目录对应项目加入关联项目
- `--parent <id>`：修改父任务 ID，支持完整 ID 或前缀匹配
- `--clear-parent`：清空父任务

### `ltc task tree <id>`

- `<id>`：任务 ID，支持前缀匹配
- `--descendants`：只显示当前任务作为根的后代树
- `--json`：以 JSON 输出任务树

### `ltc task lineage <id>`

- `<id>`：任务 ID，支持前缀匹配
- `--json`：以 JSON 输出父任务链路

### `ltc task start <id>`

- `<id>`：将任务切到 `in_progress`

### `ltc task complete <id>`

- `<id>`：将任务切到 `completed`

### `ltc task archive <id>`

- `<id>`：归档任务

### `ltc task reopen <id>`

- `<id>`：重新打开任务，并将状态设为 `in_progress`

### `ltc task delete <id>`

- `<id>`：彻底删除任务及其数据（包括 PRD、关联项目链接）
- `-f, --force`：跳过确认
- 如果任务仍有子任务，会拒绝删除

### `ltc task checkpoint <id>`

> 语义与触发条件：见 [task-workflows.md#checkpoint-类型与触发条件](task-workflows.md#checkpoint-类型与触发条件)。

- `<id>`：任务 ID，支持前缀匹配
- `--type <type>`：检查点类型，必填。可选值：`context` / `correction` / `constraint` / `assumption` / `followup` / `note` / `decision` / `pivot` / `milestone` / `issue` / `summary`
- `--title <title>`：检查点标题，必填
- `-m, --message <message>`：检查点内容，可选
- `--json`：以 JSON 输出创建的检查点

### `ltc task progress <id>`

- `<id>`：任务 ID，支持前缀匹配
- `--last <n>`：只显示最近 N 条
- `--type <type>`：按类型过滤（context / correction / constraint / assumption / followup / note / decision / pivot / milestone / issue / summary）
- `--id <checkpointId>`：查看指定检查点的详细内容
- `--json`：以 JSON 输出

### `ltc task associate <id>`

> 语义与触发条件：见 [project-discovery.md#任务的项目集合与路径集合](project-discovery.md#任务的项目集合与路径集合) 与 [task-workflows.md#项目关联同步](task-workflows.md#项目关联同步)。

为任务关联项目或路径（路径智能识别：high 置信度则进 projects，否则进 scopePaths）。

- `<id>`：任务 ID，支持前缀匹配
- `-p, --project <ids...>`：追加关联项目 ID
- `--current`：追加当前目录对应的项目（写入类：用户提供了路径/语义描述时必须先 `ltc project where` / `ltc project list --search` 定位，见 task-workflows.md「项目关联同步」）
- `--paths <paths...>`：追加额外路径（可多个，其中命中已注册项目的会自动进 projects）
- `--note <note>`：赋予本次新增 scopePath 的备注
- `--remove-path <path>`：从 scopePaths 中移除指定路径
- `--remove-project <id>`：从 projects 中移除指定项目
- `--clear-paths`：清空任务的 scopePaths
- `--json`：以 JSON 输出

### `ltc task ref-spec <task-id> <spec...>`

> 语义与触发条件：见 [task-workflows.md#spec-引用同步](task-workflows.md#spec-引用同步)。

为任务添加 spec 引用（支持文件名、标题模糊匹配和 glob）。

- `<task-id>`：任务 ID，支持前缀匹配
- `<spec...>`：spec 文件名 / 标题（可多个）

### `ltc task unref-spec <task-id> <spec-id...>`

- `<task-id>`：任务 ID，支持前缀匹配
- `<spec-id...>`：spec ID（可多个）

## `ltc spec`

Spec 管理。

### `ltc spec list`

> 语义与触发条件：见 [spec-workflows.md#按任务主题精读相关-spec](spec-workflows.md#按任务主题精读相关-spec)。

- `--scope <scope>`：限制层级为 `project` / `user` / `global`
- `--tag <tag>`：按标签过滤
- `--json`：以 JSON 输出

> **适用范围校验**：命令会自动检测 user/global 级 spec 是否包含 `## 适用范围` 声明，缺失时输出警告。

### `ltc spec show <file>`

- `<file>`：spec 文件路径或名称（支持模糊匹配）
- `--user <username>`：查看指定用户的 spec（而非当前用户）
- `--detail`：显示完整内容（默认只显示摘要）

> **跨用户查看**：`--user` 允许查看其他用户为同一项目定义的 spec。不存在的用户名会报错并列出可用用户。

### `ltc spec conflicts`

- 无参数，用于检测多层级同名 spec 冲突

### `ltc spec init <relative-path>`

创建 spec 文件（仅写 frontmatter + 占位标题；正文由 AI 用 search_replace 编辑）。

- `<relative-path>`：spec 文件相对路径
- `--scope <scope>`：层级（`project` / `user` / `global`），默认 `project`（当前在项目内时）
- `--title <title>`：标题（必填）
- `--description <description>`：摘要
- `--tags <tags>`：标签，逗号分隔
- `--force`：若文件已存在则覆盖

### `ltc spec set <file>`

修改 spec frontmatter（支持模糊匹配和 glob）。

- `<file>`：spec 文件路径或名称
- `--scope <scope>`：限定层级（`project` / `user` / `global`）
- `--title <title>`：新标题
- `--description <description>`：新摘要（覆盖整个 description 字段）
- `--add-tag <tag>`：新增标签（可重复使用）
- `--rm-tag <tag>`：移除标签（可重复使用）
- `--id <id>`：强制指定 id（一般不需要，谨慎使用）

### `ltc spec migrate [name]`

批量迁移历史 spec：自动补 id / 刷新 updated / 补 title（不自动补 description，仅报告缺失）。

- `[name]`：可选，指定要迁移的 spec 名称（支持 fileName / relativePath / title 模糊匹配）；省略则批量全部
- `--scope <scope>`：限定层级（`all` / `global` / `user` / `project`），默认 `all`
- `--dry-run`：仅报告不写入
- `--json`：以 JSON 输出
- `--json-format`：JSON 输出时使用格式化（默认压缩）

## `ltc spec template`

模板管理。

### `ltc spec template list`

- 无参数，列出可用模板

### `ltc spec template apply <name>`

- `<name>`：模板名

### `ltc spec template pull <repo>`

- `<repo>`：模板仓库地址

### `ltc spec template sync`

- `--repo <repo>`：只同步指定仓库

### `ltc spec template sync-builtins`

同步内置 spec 模板到全局模板目录。

- `--template <names>`：同步指定内置模板（逗号分隔）
- `--all`：同步全部内置模板

## `ltc spec template registry`

模板仓库管理。

### `ltc spec template registry list`

- `--json`：以 JSON 输出

### `ltc spec template registry remove <repo>`

- `<repo>`：模板仓库地址

## `ltc scan`

扫描目录并注册项目（简单一次性扫描，不写扫描缓存、不交互）。

- `--dirs <dirs>`：显式指定扫描目录，逗号分隔；不传则使用配置中的 `scanDirs`，都无则报错退出

> **与 `ltc init scan` 的区别**：`ltc scan` 是早期简单实现，不写扫描缓存、不支持交互式配置、无确认步骤。常规扫描推荐使用 `ltc init scan`。

## `ltc sync`

同步 `~/.lattice/` Git 仓库。

- `--pull`：仅拉取
- `--push`：仅推送

## `ltc user`

用户管理。

### `ltc user list`

- 无参数

### `ltc user current`

- 无参数

### `ltc user switch <name>`

- `<name>`：切换到指定用户

### `ltc user create <name>`

- `<name>`：创建用户

### `ltc user rename <oldName> <newName>`

- `<oldName>`：旧用户名
- `<newName>`：新用户名

### `ltc user remove <name>`

- `<name>`：待删除用户名
- `--force`：跳过确认

## `ltc config`

配置管理。

### 顶层 `ltc config`

- `--scope <scope>`：配置范围，`global` 或 `local`，默认 `global`
- `--diff-defaults`：只显示和默认值不同的项

### `ltc config show`

- `--json`：以 JSON 输出
- `--scope <scope>`：配置范围，`global` 或 `local`
- `--diff-defaults`：只显示差异项

### `ltc config get <key>`

- `<key>`：点路径配置键
- `--json`：以 JSON 输出
- `--scope <scope>`：配置范围，`global` 或 `local`

### `ltc config set <key> <value>`

- `<key>`：点路径配置键
- `<value>`：配置值
- `--json`：按 JSON 解析 `value`
- `--scope <scope>`：配置范围，`global` 或 `local`

### `ltc config unset <key>`

- `<key>`：点路径配置键
- `--scope <scope>`：配置范围，`global` 或 `local`

## `ltc doctor`

检查当前安装和索引状态。

- `--fix`：自动修复安全可修复的问题
- `--migrate`：一次性迁移旧版项目数据（单字符串 localPath / gitRemote 升级为 localPaths / gitRemotes 数组，并清理 legacy 字段），同时回填 db 缺失项目
- `--rebuild-fingerprints`：重新采集所有项目的指纹
- `--recheck-scope-paths`：重新检查任务 scopePaths 是否已升格为已注册项目
- `--json`：以 JSON 输出

## `ltc rag`

RAG 索引管理。

### `ltc rag status`

- `--json`：以 JSON 输出

### `ltc rag update`

- 无参数，增量更新索引（只处理变更的文档，未变文档跳过）
- 输出新增/更新/删除/跳过的统计
- 如果报错，降级使用 `rag rebuild`

### `ltc rag rebuild`

- 无参数，全量重建索引

## `ltc trash`

垃圾桶管理（软删除的内容可恢复）。

### `ltc trash list`

- `--type <type>`：按类型筛选（`task` / `project` / `spec`）

### `ltc trash restore <id>`

- `<id>`：垃圾桶条目 ID

### `ltc trash purge [id]`

- `[id]`：指定条目 ID；不传则需搭配 `--all`
- `-f, --force`：跳过确认
- `--all`：清空整个垃圾桶（不可恢复）

## `ltc web`

启动 Lattice 可视化 Web 服务（动态加载 `@qcqx/lattice-web`，未安装时提示安装）。

- `-p, --port <port>`：端口号，默认 3000
- `--no-open`：不自动打开浏览器

## `ltc fast-start`

fast-start 轻量模式日志管理。

### `ltc fast-start log add <title>`

> 语义与触发条件：见 [fast-start-workflows.md#轻量日志](fast-start-workflows.md#轻量日志)。

添加一条 fast-start 日志（自动检测当前目录对应的项目）。

- `<title>`：日志标题（简述做了什么）
- `-m, --message <message>`：日志内容，必填
- `--files <files...>`：涉及的文件列表
- `--cwd <dir>`：工作目录（默认当前目录）
- `--project <id>`：手动指定项目 ID（默认自动检测）
- `--json`：以 JSON 输出

### `ltc fast-start log list`

列出 fast-start 日志（跨所有分片文件，按时间排序）。

- `--last <n>`：只显示最近 N 条
- `--project <id>`：按项目 ID 过滤
- `--current`：自动识别当前目录对应的项目并过滤
- `--json`：以 JSON 输出

### `ltc fast-start log search <query>`

关键词搜索 fast-start 日志（搜索范围：标题 / 内容 / 文件 / 目录，不区分大小写）。按时间倒序返回（新→旧）。

- `<query>`：搜索关键词
- `--last <n>`：只返回最近 N 条
- `--project <id>`：按项目 ID 过滤
- `--current`：自动识别当前目录对应的项目并过滤
- `--json`：以 JSON 输出

### `ltc fast-start log show <id>`

查看单条 fast-start 日志。

- `<id>`：日志 ID（格式 `fs_<8hex>`）
- `--json`：以 JSON 输出

### `ltc fast-start log stats`

查看日志统计（总条目数、文件数、当前文件容量）。

- `--json`：以 JSON 输出

### `ltc fast-start log clear`

清空所有 fast-start 日志（不可恢复）。

- `-f, --force`：跳过确认
