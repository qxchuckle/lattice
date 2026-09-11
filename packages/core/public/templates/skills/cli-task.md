# CLI 参数：任务生命周期

`ltc task` / `ltc fast-start` 参数。通用约定（`--force`/`--json`）见 [command-reference.md#通用约定]；任务流程见 [task-workflows.md]，fast-start 流程见 [fast-start-workflows.md]。

## `ltc task`

管理跨项目任务。

### `ltc task list`

列出任务（按状态 / 项目 / 用户过滤）。

- `--status <status>`：`planning`/`in_progress`/`completed`/`archived`/`all`
- `--project <id>` / `--current`
- `--all-user` / `--user <users>`（互斥，需搭配 `--project`/`--current`）
- `--json`

### `ltc task create <title>`

创建任务。

- `-p, --project <ids...>` / `--current` / `--parent <id>` / `-q, --quiet`（只输出任务 ID，便于 `ID=$(ltc task create ... -q) && ltc task start "$ID"` 串联）
- `--current`：写入类——用户提供了路径/语义描述时必须先 `ltc project where`/`ltc project list --search` 定位，定位到用 `--project <id>`

### `ltc task info <id>`

查看任务详情（元数据 + 关联 + 引用 spec）。

- `--lineage` / `--tree` / `--descendants` / `--json`

### `ltc task update <id>`

更新任务元数据（标题 / 状态 / 项目关联 / 父任务）。

- `--title` / `--status` / `-p, --project <ids...>` / `--add-project` / `--remove-project` / `--clear-projects` / `--add-current-project` / `--parent <id>` / `--clear-parent`

### `ltc task tree <id>` / `ltc task lineage <id>`

`tree` 查看任务树（子任务）/ `lineage` 查看父任务链路。`--descendants` / `--json`

### `ltc task start <id>` / `complete <id>` / `archive <id>` / `reopen <id>`

状态流转：`start` 设为 in_progress / `complete` 设为 completed / `archive` 归档 / `reopen` 重新打开并设为 in_progress。

### `ltc task delete <id>`

删除任务（移入垃圾桶，可恢复）。`-f, --force`。有子任务时拒绝删除。

### `ltc task checkpoint <id>`

添加任务检查点记录（追加型过程日志；type 语义见 [task-workflows.md#checkpoint 类型]）。

- `--type <type>`：必填。`context`/`correction`/`constraint`/`assumption`/`followup`/`note`/`decision`/`pivot`/`milestone`/`issue`/`summary`
- `--title <title>`：必填
- `-m, --message <message>`
- `--json`

### `ltc task progress <id>`

查看任务进展记录（checkpoint 历史）。

- `--last <n>` / `--type <type>` / `--id <checkpointId>` / `--json`

### `ltc task associate <id>`

维护任务的项目 / 路径关联（写入 task.json 结构化元数据；机器可读唯一来源）。

- `-p, --project <ids...>` / `--current` / `--paths <paths...>` / `--note <note>`
- `--remove-path <path>` / `--remove-project <id>` / `--clear-paths` / `--json`

### `ltc task ref-spec <task-id> <spec...>` / `unref-spec <task-id> <spec-id...>`

关联 / 取消关联任务引用的 spec。

- `ref-spec` 的 `<spec...>` **推荐传 spec ID**（`spec-xxxxxxxx`，全局唯一）：按 ID 解析覆盖 global + user + **全部已注册项目**的项目级 spec，可跨项目关联任意项目的项目级 spec；也支持文件名 / 标题模糊 / glob（这三者限 cwd 项目 + user + global）。
- 命中 project 级 spec 时，`referencedSpecs` 会记录其归属 `projectId`，供跨项目反查物理路径（search enrichment）。
- `unref-spec` 参数为 spec ID。

## `ltc fast-start`

fast-start 轻量模式日志（不走完整任务周期时的过程记录）。

### `ltc fast-start log add <title>`

添加一条 fast-start 日志。

- `-m, --message`（必填）/ `--files <files...>` / `--cwd <dir>` / `--project <id>` / `--json`

### `ltc fast-start log list`

列出 fast-start 日志。`--last <n>` / `--project <id>` / `--current` / `--json`

### `ltc fast-start log search <query>`

关键词搜索 fast-start 日志（标题 / 内容 / 文件 / 目录）。`--last <n>` / `--project <id>` / `--current` / `--json`

### `ltc fast-start log show <id>` / `stats`

`show` 查看单条日志 / `stats` 查看日志统计。`--json`

### `ltc fast-start log clear`

清空所有 fast-start 日志。`-f, --force`
