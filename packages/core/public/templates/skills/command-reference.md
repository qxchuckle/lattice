# CLI 命令参数参考

本文件用于快速查阅 Lattice CLI 的主要命令、位置参数和选项参数。

## `lattice init`

初始化 `~/.lattice/`。

- `--username <name>`：指定用户名
- `--git [boolean]`：是否启用 Git 管理，默认开启
- `--git-remote <url>`：配置 Git 远程仓库
- `--scan-dirs <dirs>`：初始化时写入扫描目录，逗号分隔
- `--registry-template <urls>`：初始化时拉取模板仓库并写入全局 `registryTemplates`

## `lattice status`

显示状态。

- `--global`：显示全局状态，而不是当前项目状态
- `--json`：以 JSON 输出

## `lattice context`

获取项目或任务上下文。

- `--task <id>`：按任务 ID 获取上下文
- `--project <id>`：按项目 ID 获取上下文
- `--json`：以 JSON 输出

## `lattice search <query>`

搜索 spec、任务或项目。

- `<query>`：搜索词
- `--type <type>`：限制类型为 `spec` / `task` / `project`
- `--project <id>`：限制到指定项目
- `--users <names>`：限制到指定用户，逗号分隔
- `--all-user`：搜索所有用户内容
- `--limit <n>`：返回结果数量，默认 `10`
- `--no-rerank`：关闭轻量 rerank
- `--json`：以 JSON 输出；AI / Agent 调用时优先带上，便于读取完整元数据后再推理

## `lattice link`

将当前目录注册为 Lattice 项目。

- `--name <name>`：手动指定项目名
- `--description <desc>`：项目描述
- `--groups <groups>`：项目分组，逗号分隔
- `--tags <tags>`：项目标签，逗号分隔
- `--template <templates>`：应用 spec 模板，逗号分隔，或传 `all`

## `lattice unlink`

解除当前目录和 Lattice 项目的绑定。

- `--force`：跳过二次确认
- `--remove-data`：同时删除 Lattice 中的项目数据

## `lattice project`

项目管理。

### `lattice project list`

- `--group <group>`：按分组过滤
- `--tag <tag>`：按标签过滤
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

## `lattice task`

任务管理。

### `lattice task list`

- `--status <status>`：按 `planning` / `in_progress` / `completed` / `archived` 过滤
- `--project <id>`：按项目 ID 过滤
- `--current`：自动识别当前目录对应的项目
- `--json`：以 JSON 输出

### `lattice task create <title>`

- `<title>`：任务标题
- `-p, --project <ids...>`：关联一个或多个项目 ID
- `--current`：自动关联当前目录对应项目

### `lattice task info <id>`

- `<id>`：任务 ID
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

### `lattice task start <id>`

- `<id>`：将任务切到 `in_progress`

### `lattice task complete <id>`

- `<id>`：将任务切到 `completed`

### `lattice task archive <id>`

- `<id>`：归档任务

### `lattice task reopen <id>`

- `<id>`：重新打开任务，并将状态设为 `in_progress`

## `lattice spec`

Spec 管理。

### `lattice spec list`

- `--scope <scope>`：限制层级为 `project` / `user` / `global`
- `--tag <tag>`：按标签过滤
- `--json`：以 JSON 输出

### `lattice spec show <file>`

- `<file>`：spec 文件路径

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
- `--json`：以 JSON 输出

## `lattice rag`

RAG 索引管理。

### `lattice rag status`

- `--json`：以 JSON 输出

### `lattice rag rebuild`

- 无参数，重建索引
