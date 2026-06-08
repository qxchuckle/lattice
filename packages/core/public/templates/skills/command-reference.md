# CLI 命令参数参考

本文件是 Lattice CLI 主要命令、位置参数和选项参数的字典。流程性概念见 [SKILL.md](SKILL.md) / [task-workflows.md](task-workflows.md) / [spec-workflows.md](spec-workflows.md) / [project-discovery.md](project-discovery.md)。

## 通用约定：`-f, --force` 跳过二次确认

以下命令包含交互式二次确认，**AI / Agent 调用时必须加 `-f` / `--force`**，否则会阻塞等待用户输入：

| 命令 | 确认内容 |
|---|---|
| `lattice init` | 是否下载 embedding 模型 |
| `lattice unlink` | 确认取消项目注册 |
| `lattice project remove <id>` | 确认删除项目数据 |
| `lattice project relation remove <a> <b>` | 确认删除项目关系 |
| `lattice task delete <id>` | 确认彻底删除任务 |
| `lattice user remove <name>` | 确认删除用户 |

## `lattice init`

初始化 `~/.lattice/`。

- `-f, --force`：跳过确认（如是否下载模型）
- `--username <name>`：指定用户名
- `--git [boolean]`：是否启用 Git 管理，默认开启
- `--git-remote <url>`：配置 Git 远程仓库
- `--scan-dirs <dirs>`：初始化时写入扫描目录，逗号分隔
- `--registry-template <urls>`：初始化时拉取模板仓库并写入全局 `registryTemplates`

## `lattice status`

显示状态。

- `--global`：显示全局状态，而不是当前项目状态
- `--json`：以 JSON 输出

> **嵌套项目信息**：项目模式下会自动检测并显示祖先项目嵌套关系和 spec 级联优先级。

## `lattice context`

获取项目或任务上下文。

- `--task <id>`：按任务 ID 获取上下文
- `--project <id>`：按项目 ID 获取上下文
- `--json`：以 JSON 输出

> **嵌套项目继承**：当前项目处于另一个已注册 Lattice 项目的子目录时，会自动继承祖先项目的 spec。级联优先级：`当前项目 > 直接父级 > 更远祖先 > 用户级 > 全局级`。

## `lattice search <query>`

搜索 spec、任务、项目、检查点和关联关系。

- `<query>`：搜索词
- `--type <type>`：限制类型为 `spec` / `task` / `project` / `checkpoint` / `relation`
- `--project <id>`：限制到指定项目
- `--users <names>`：限制到指定用户，逗号分隔
- `--all-user`：搜索所有用户内容
- `--limit <n>`：返回结果数量，默认 `10`
- `--no-rerank`：关闭轻量 rerank
- `--json`：以 JSON 输出；AI / Agent 调用时优先带上，便于读取完整元数据后再推理

> **搜索结果增强**：当结果类型为 `checkpoint` 时，`meta` 中会包含 `taskId`、`checkpointId`；当结果类型为 `relation` 时，`meta` 中会包含 `projectA`、`projectB`。

## `lattice link`

将当前目录注册为 Lattice 项目（默认会采集指纹并检测重复候选项目，必要时弹出选单）。

- `--name <name>`：手动指定项目名
- `--description <desc>`：项目描述
- `--groups <groups>`：项目分组，逗号分隔
- `--tags <tags>`：项目标签，逗号分隔
- `--template <templates>`：应用 spec 模板，逗号分隔，或传 `all`
- `--restore <id>`：直接重新绑定到已有项目 id（不交互）
- `--force-new`：强制创建新项目，跳过指纹相似检测
- `-y, --yes`：检测到候选时仅警告并创建新项目（非交互模式）

> **嵌套项目自动检测**：link 完成后会自动向上查找父级 `lattice.json`，若发现已注册的父项目则自动创建 `nested-in` 关系（`createdBy=auto`）。子项目运行 `lattice context` 时会自动继承祖先项目的 spec。

## `lattice unlink`

解除当前目录和 Lattice 项目的绑定。

- `--force`：跳过二次确认
- `--remove-data`：同时删除 Lattice 中的项目数据（关系与指纹会联动清理，仍可通过 trash restore 恢复）

## `lattice project`

项目管理。

### `lattice project list`

- `--group <group>`：按分组过滤
- `--tag <tag>`：按标签过滤
- `--has-git`：只显示含 git remote 的项目
- `--orphaned`：只显示所有 localPaths 都已失效的项目
- `--with-relations`：附带显示项目关系
- `--json`：以 JSON 输出

### `lattice project where <path>`

查询指定路径属于哪个项目（含父目录前缀匹配与指纹候选）。

- `<path>`：要查询的路径，可相对可绝对
- `--json`：以 JSON 输出

### `lattice project info <id>`

- `<id>`：项目 ID
- `--json`：以 JSON 输出

### `lattice project update <id>`

- `<id>`：项目 ID
- `--name <name>`：更新项目名
- `--description <desc>`：更新描述
- `--groups <groups>`：更新分组，逗号分隔
- `--tags <tags>`：更新标签，逗号分隔

### `lattice project remove <id>`

- `<id>`：项目 ID
- `--force`：跳过确认

### `lattice project relation list [id]`

- `[id]`：可选，指定项目 ID 只看该项目的关系；不传则列出所有关系
- `--current-user`：仅显示当前用户定义的关系（不聚合其他用户）
- `--user <users>`：仅显示指定用户定义的关系，逗号分隔多个用户名
- `--json`：以 JSON 输出

> **跨用户聚合**：默认聚合所有用户定义的关系（来自其他用户的关系会标注 `[username]`）。`--current-user` 和 `--user` 互斥，不能同时使用。

### `lattice project relation add <project-a> <project-b>`

- `<project-a>`：项目 A的 ID
- `<project-b>`：项目 B 的 ID
- `--type <type>`：关系类型，默认 `related`（常用：forked-from / depends-on / shares-component / nested-in / related）
- `--description <desc>`：关系描述
- `--from-task <taskId>`：记录关系推断来源任务 ID
- `--ai-inferred`：标记为 AI 推断的关系（`createdBy=ai-inferred`）

### `lattice project relation remove <relation-id>`

- `<relation-id>`：关系的唯一 id（可从 `lattice project relation list` 返回中获得）
- `--force`：跳过确认

## `lattice task`

任务管理。

### `lattice task list`

- `--status <status>`：按 `planning` / `in_progress` / `completed` / `archived` 过滤
- `--project <id>`：按项目 ID 过滤
- `--current`：自动识别当前目录对应的项目
- `--all-user`：聚合所有用户的任务（需搭配 `--project` 或 `--current`）
- `--user <users>`：聚合指定用户的任务，逗号分隔（需搭配 `--project` 或 `--current`）
- `--json`：以 JSON 输出

> **跨用户聚合**：`--all-user` 和 `--user` 互斥，不能同时使用。来自其他用户的任务会标注 `[username]`。不存在的用户名会报错并列出可用用户。

### `lattice task create <title>`

- `<title>`：任务标题
- `-p, --project <ids...>`：关联一个或多个项目 ID
- `--current`：自动关联当前目录对应项目
- `--parent <id>`：指定父任务 ID，支持完整 ID 或前缀匹配

### `lattice task info <id>`

- `<id>`：任务 ID
- `--lineage`：显示父任务链路
- `--tree`：显示当前任务所在的整颗任务树
- `--descendants`：显示当前任务作为根的后代任务树
- `--json`：以 JSON 输出

### `lattice task update <id>`

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

### `lattice task tree <id>`

- `<id>`：任务 ID，支持前缀匹配
- `--descendants`：只显示当前任务作为根的后代树
- `--json`：以 JSON 输出任务树

### `lattice task lineage <id>`

- `<id>`：任务 ID，支持前缀匹配
- `--json`：以 JSON 输出父任务链路

### `lattice task start <id>`

- `<id>`：将任务切到 `in_progress`

### `lattice task complete <id>`

- `<id>`：将任务切到 `completed`

### `lattice task archive <id>`

- `<id>`：归档任务

### `lattice task reopen <id>`

- `<id>`：重新打开任务，并将状态设为 `in_progress`

### `lattice task delete <id>`

- `<id>`：彻底删除任务及其数据（包括 PRD、关联项目链接）
- `-f, --force`：跳过确认
- 如果任务仍有子任务，会拒绝删除

### `lattice task checkpoint <id>`

- `<id>`：任务 ID，支持前缀匹配
- `--type <type>`：检查点类型，必填。可选值：`decision` / `issue` / `pivot` / `summary` / `milestone` / `note`
- `--title <title>`：检查点标题，必填
- `-m, --message <message>`：检查点内容，可选
- `--json`：以 JSON 输出创建的检查点

### `lattice task progress <id>`

- `<id>`：任务 ID，支持前缀匹配
- `--last <n>`：只显示最近 N 条
- `--type <type>`：按类型过滤（decision / issue / pivot / summary / milestone / note）
- `--id <checkpointId>`：查看指定检查点的详细内容
- `--json`：以 JSON 输出

### `lattice task associate <id>`

为任务关联项目或路径（路径智能识别：high 置信度则进 projects，否则进 scopePaths）。

- `<id>`：任务 ID，支持前缀匹配
- `-p, --project <ids...>`：追加关联项目 ID
- `--current`：追加当前目录对应的项目
- `--paths <paths...>`：追加额外路径（可多个，其中命中已注册项目的会自动进 projects）
- `--note <note>`：赋予本次新增 scopePath 的备注
- `--remove-path <path>`：从 scopePaths 中移除指定路径
- `--remove-project <id>`：从 projects 中移除指定项目
- `--clear-paths`：清空任务的 scopePaths
- `--json`：以 JSON 输出

## `lattice spec`

Spec 管理。

### `lattice spec list`

- `--scope <scope>`：限制层级为 `project` / `user` / `global`
- `--tag <tag>`：按标签过滤
- `--json`：以 JSON 输出

> **适用范围校验**：命令会自动检测 user/global 级 spec 是否包含 `## 适用范围` 声明，缺失时输出警告。

### `lattice spec show <file>`

- `<file>`：spec 文件路径或名称（支持模糊匹配）
- `--user <username>`：查看指定用户的 spec（而非当前用户）
- `--detail`：显示完整内容（默认只显示摘要）

> **跨用户查看**：`--user` 允许查看其他用户为同一项目定义的 spec。不存在的用户名会报错并列出可用用户。

### `lattice spec conflicts`

- 无参数，用于检测多层级同名 spec 冲突

## `lattice spec template`

模板管理。

### `lattice spec template list`

- 无参数，列出可用模板

### `lattice spec template apply <name>`

- `<name>`：模板名

### `lattice spec template pull <repo>`

- `<repo>`：模板仓库地址

### `lattice spec template sync`

- `--repo <repo>`：只同步指定仓库

## `lattice spec template registry`

模板仓库管理。

### `lattice spec template registry list`

- `--json`：以 JSON 输出

### `lattice spec template registry remove <repo>`

- `<repo>`：模板仓库地址

## `lattice scan`

扫描目录并注册项目。

- `--dirs <dirs>`：显式指定扫描目录，逗号分隔

## `lattice sync`

同步 `~/.lattice/` Git 仓库。

- `--pull`：仅拉取
- `--push`：仅推送

## `lattice user`

用户管理。

### `lattice user list`

- 无参数

### `lattice user current`

- 无参数

### `lattice user switch <name>`

- `<name>`：切换到指定用户

### `lattice user create <name>`

- `<name>`：创建用户

### `lattice user rename <oldName> <newName>`

- `<oldName>`：旧用户名
- `<newName>`：新用户名

### `lattice user remove <name>`

- `<name>`：待删除用户名
- `--force`：跳过确认

## `lattice config`

配置管理。

### 顶层 `lattice config`

- `--scope <scope>`：配置范围，`global` 或 `local`，默认 `global`
- `--diff-defaults`：只显示和默认值不同的项

### `lattice config show`

- `--json`：以 JSON 输出
- `--scope <scope>`：配置范围，`global` 或 `local`
- `--diff-defaults`：只显示差异项

### `lattice config get <key>`

- `<key>`：点路径配置键
- `--json`：以 JSON 输出
- `--scope <scope>`：配置范围，`global` 或 `local`

### `lattice config set <key> <value>`

- `<key>`：点路径配置键
- `<value>`：配置值
- `--json`：按 JSON 解析 `value`
- `--scope <scope>`：配置范围，`global` 或 `local`

### `lattice config unset <key>`

- `<key>`：点路径配置键
- `--scope <scope>`：配置范围，`global` 或 `local`

## `lattice doctor`

检查当前安装和索引状态。

- `--fix`：自动修复安全可修复的问题
- `--migrate`：一次性迁移旧版项目数据（单字符串 localPath / gitRemote 升级为 localPaths / gitRemotes 数组，并清理 legacy 字段），同时回填 db 缺失项目
- `--rebuild-fingerprints`：重新采集所有项目的指纹
- `--recheck-scope-paths`：重新检查任务 scopePaths 是否已升格为已注册项目
- `--json`：以 JSON 输出

## `lattice rag`

RAG 索引管理。

### `lattice rag status`

- `--json`：以 JSON 输出

### `lattice rag update`

- 无参数，增量更新索引（只处理变更的文档，未变文档跳过）
- 输出新增/更新/删除/跳过的统计
- 如果报错，降级使用 `rag rebuild`

### `lattice rag rebuild`

- 无参数，全量重建索引
