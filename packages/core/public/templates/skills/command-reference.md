# CLI 命令参数参考

查阅式字典。不知该调哪个命令 → 读流程文档（[task-workflows.md](task-workflows.md) / [spec-workflows.md](spec-workflows.md) / [project-context.md](project-context.md) / [project-discovery.md](project-discovery.md)）。

## 通用约定：`-f, --force` 跳过二次确认

AI 调用以下命令**必须**加 `-f`/`--force`：

| 命令 | 确认内容 |
|---|---|
| `ltc init` | 是否下载 embedding 模型 |
| `ltc unlink` | 取消项目注册 |
| `ltc project remove <id>` | 删除项目数据 |
| `ltc project relation remove <a> <b>` | 删除项目关系 |
| `ltc task delete <id>` | 彻底删除任务 |
| `ltc user remove <name>` | 删除用户 |
| `ltc fast-start log clear` | 清空日志 |

## `ltc init`

初始化 `~/.lattice/`。

- `-f, --force`：跳过确认
- `--username <name>`：指定用户名
- `--git [boolean]`：启用 Git 管理（默认开启）
- `--git-remote <url>`：Git 远程仓库
- `--scan-dirs <dirs>`：扫描目录（逗号分隔）
- `--registry-template <urls>`：拉取模板仓库

### `ltc init scan`

扫描本地 git 项目并注册（写扫描缓存、有交互配置）。

- `--dirs <dirs>`：扫描目录（逗号分隔）；不传用配置 `scanDirs`
- `--auto`：使用配置中 `scanDirs`，跳过交互

## `ltc status`

- `--global`：全局状态
- `--json`

## `ltc context`

- `--task <id>`：按任务获取上下文
- `--project <id>`：按项目获取
- `--query <text>`：语义查询（**AI 必须带**，传入当前主题/意图）
- `--current-user`：仅当前用户
- `--json`

> 嵌套项目自动继承祖先 spec。级联：`当前 > 父级 > 祖先 > 用户级 > 全局`。

## `ltc search <query>`

- `--type <type>`：`spec`/`task`/`project`/`checkpoint`/`relation`
- `--project <id>`
- `--users <names>`：逗号分隔
- `--current-user`
- `--limit <n>`：默认 10
- `--no-rerank`
- `--json`：AI 优先带上

## `ltc link`

> ⚠️ AI 不得自动调用。面向用户的注册命令。

- `--name <name>` / `--description <desc>` / `--groups <groups>` / `--tags <tags>`
- `--template <templates>`：应用 spec 模板（逗号分隔或 `all`）
- `--restore <id>`：重新绑定已有项目
- `--force-new`：强制新建
- `-y, --yes`：非交互（检测到候选仅警告并新建）

## `ltc unlink`

- `--force` / `--remove-data`（同时删除项目数据）

## `ltc project`

### `ltc project list`

- `--group` / `--tag` / `--has-git` / `--orphaned` / `--with-relations` / `--json` / `--json-format`
- `--search <keyword>`：大小写不敏感匹配（名称/ID/路径/Git/包名/分组/标签）+ RAG 语义回退
- `--keyword-only`：跳过语义搜索

### `ltc project where <path>`

查询路径属于哪个已注册项目（精确+父目录前缀+ID 匹配）。`--json`

### `ltc project info <id>`

`--json`

### `ltc project update <id>`

`--name` / `--description` / `--groups` / `--tags`

### `ltc project remove <id>`

`--force`

### `ltc project relation list [id]`

- `--current-user` / `--user <users>`（互斥）/ `--json`
- 默认聚合所有用户（其他用户标注 `[username]`）

### `ltc project relation add <project-a> <project-b>`

- `--type <type>`：默认 `related`（forked-from/depends-on/shares-component/nested-in/related）
- `--description <desc>`
- `--from-task <taskId>` / `--ai-inferred`

### `ltc project relation remove <relation-id>`

`--force`

### `ltc project merge <from> <to>`

物理合并（事务操作）。`-f, --force`

### `ltc project profile check`

`--project <id>` / `--json`

### `ltc project profile brief <id>`

`--json`

### `ltc project profile done <id>`

标记画像完成（自动写 cache + 同步 + rag update）。

### `ltc project profile show <id>`

`--json`

### `ltc project profile path <id>`

输出 profile 目录路径。

### `ltc project profile tags show <id>` / `tags set <id> --tags "a,b"` / `tags add` / `tags remove`

## `ltc task`

### `ltc task list`

- `--status <status>`：`planning`/`in_progress`/`completed`/`archived`/`all`
- `--project <id>` / `--current`
- `--all-user` / `--user <users>`（互斥，需搭配 `--project`/`--current`）
- `--json`

### `ltc task create <title>`

- `-p, --project <ids...>` / `--current` / `--parent <id>`
- `--current`：写入类——用户提供了路径/语义描述时必须先 `ltc project where`/`ltc project list --search` 定位，定位到用 `--project <id>`

### `ltc task info <id>`

- `--lineage` / `--tree` / `--descendants` / `--json`

### `ltc task update <id>`

- `--title` / `--status` / `-p, --project <ids...>` / `--add-project` / `--remove-project` / `--clear-projects` / `--add-current-project` / `--parent <id>` / `--clear-parent`

### `ltc task tree <id>` / `ltc task lineage <id>`

`--descendants` / `--json`

### `ltc task start <id>` / `complete <id>` / `archive <id>` / `reopen <id>`

### `ltc task delete <id>`

`-f, --force`。有子任务时拒绝删除。

### `ltc task checkpoint <id>`

- `--type <type>`：必填。`context`/`correction`/`constraint`/`assumption`/`followup`/`note`/`decision`/`pivot`/`milestone`/`issue`/`summary`
- `--title <title>`：必填
- `-m, --message <message>`
- `--json`

### `ltc task progress <id>`

- `--last <n>` / `--type <type>` / `--id <checkpointId>` / `--json`

### `ltc task associate <id>`

- `-p, --project <ids...>` / `--current` / `--paths <paths...>` / `--note <note>`
- `--remove-path <path>` / `--remove-project <id>` / `--clear-paths` / `--json`

### `ltc task ref-spec <task-id> <spec...>` / `unref-spec <task-id> <spec-id...>`

## `ltc spec`

### `ltc spec list`

- `--scope <scope>`：`project`/`user`/`global`
- `--tag <tag>` / `--json`

### `ltc spec show <file>`

- `--user <username>` / `--detail`（显示完整内容）

### `ltc spec conflicts`

### `ltc spec init <relative-path>`

- `--scope` / `--title`（必填）/ `--description` / `--tags` / `--force`

### `ltc spec set <file>`

- `--scope` / `--title` / `--description` / `--add-tag` / `--rm-tag` / `--id`

### `ltc spec migrate [name]`

批量迁移（补 id/刷新 updated/补 title）。`--scope`（默认 all）/ `--dry-run` / `--json` / `--json-format`

## `ltc spec template`

`list` / `apply <name>` / `pull <repo>` / `sync [--repo]` / `sync-builtins [--template <names>] [--all]`

### `ltc spec template registry`

`list [--json]` / `remove <repo>`

## `ltc scan`

简单扫描（不写缓存、不交互）。`--dirs <dirs>`

## `ltc sync`

`--pull` / `--push`

## `ltc user`

`list` / `current` / `switch <name>` / `create <name>` / `rename <old> <new>` / `remove <name> [--force]`

## `ltc config`

`show [--json] [--scope] [--diff-defaults]` / `get <key> [--json] [--scope]` / `set <key> <value> [--json] [--scope]` / `unset <key> [--scope]`

## `ltc doctor`

- `--fix` / `--migrate` / `--rebuild-fingerprints` / `--recheck-scope-paths` / `--json`

## `ltc rag`

`status [--json]` / `update`（增量）/ `rebuild`（全量）

## `ltc trash`

`list [--type]` / `restore <id>` / `purge [id] [-f] [--all]`

## `ltc web`

`-p, --port <port>`（默认 3000）/ `--no-open`

## `ltc fast-start`

### `ltc fast-start log add <title>`

- `-m, --message`（必填）/ `--files <files...>` / `--cwd <dir>` / `--project <id>` / `--json`

### `ltc fast-start log list`

`--last <n>` / `--project <id>` / `--current` / `--json`

### `ltc fast-start log search <query>`

`--last <n>` / `--project <id>` / `--current` / `--json`

### `ltc fast-start log show <id>` / `stats`

`--json`

### `ltc fast-start log clear`

`-f, --force`
