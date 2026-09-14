# CLI 命令参数参考

查阅式字典路由。按命令类别转对应子文档；不知该调哪个命令 → 读流程文档（[task-workflows.md] / [spec-workflows.md] / [project-context.md] / [project-discovery.md]）。

## 通用约定

`-f, --force` 跳过二次确认。AI 调用以下命令**必须**加 `-f`/`--force`（否则命令卡在交互确认）：

| 命令 | 确认内容 |
|---|---|
| `ltc init` | 扫描目录 + 是否下载 embedding 模型 |
| `ltc init scan` | 扫描目录（或 `--auto` 跳过交互） |
| `ltc uninject` | 清除注入（删目录/文件、移除标记块） |
| `ltc unlink` | 取消项目注册 |
| `ltc project relation remove <a> <b>` | 删除项目关系 |
| `ltc project merge <from> <to>` | 合并项目（不可撤销） |
| `ltc user rename <old> <new>` | 重命名用户（改数据库 + 文件系统） |
| `ltc user remove <name>` | 删除用户及其所有数据 |
| `ltc trash purge [id]` / `--all` | 彻底删除垃圾桶内容（不可恢复） |
| `ltc fast-start log clear` | 清空日志 |

`ltc project remove <id>` / `ltc task delete <id>` 是软删除（移入垃圾桶、可 `ltc trash restore` 恢复），**无确认提示、无需 `-f`**。

`--json`：所有**叶子**命令接受，**父命令不接受**（如 `ltc sync` / `ltc config`）。对父命令用 `--json` 报 `unknown option` 到 stderr、退出 1——规避：改调子命令（`ltc sync domain list --json` / `ltc config show --json`）。

命令**有** JSON 出口 → 返回 JSON；**无**出口 → 成功仍输出人读文本（stdout、退出码 0），失败进 machine 模式（stderr、退出码 1，见下段）。语义例外：`config set --json` 是把输入 value 按 JSON 解析，非输出格式控制（见 [cli-system.md#ltc-config]）。

**位置参数以 `-` 开头**：**含空格**的自由文本（标题、查询等）已自动按位置参数解析，**无需 `--`**（`ltc search "--json 开头的查询" --json` 正常），选项仍可放其后。仍需 `--` 的两种：**值恰好等于某已注册选项**（`ltc search -- "--json"` 搜字面量，不加 `--` 会被当选项吃掉并报 `missing required argument`）、**值以 `-` 开头且不含空格**（`ltc task create -- "--fix"`）。用 `--` 时所有选项必须放它前面（`ltc search -- "q" --json` 报 `too many arguments`）。拼错选项仍报 `unknown option`，不会被当位置参数吃掉。

machine 模式（`--json` / `-q`）**失败与空态**：失败 → 提示走 **stderr** + 退出码 **1**、stdout 保持空（绝不吐人读文本）；成功但结果为空 → 仍给合法空载荷（`{cols:[],rows:[]}`、`{total:0,...}`）。故 `$(ltc ... --json)` 与管道永不会捕到非数据字节，失败由退出码识别。人读模式下这些提示仍在 stdout、退出码不变。

`--json-format`：凡接受 `--json` 的命令均自动接受（`config set` 除外——其 `--json` 是输入解析语义），改**排版**为缩进格式化（默认单行压缩），不改字段与 shape。

`--json-full`：关闭**瘦身层**——恢复被省略的空值字段、完整 ISO 时间戳、RAG 内部打分/调试 meta、detail 正文（`spec list` 的 content）、`task list` 的 referencedSpecs 明细、画像检查条目的 `status`，且不转列式表。它**不恢复重复表示**——去重层两种模式都生效（删的是可由兄弟字段机械还原的冗余拷贝，信息零损失）。单独给出（不带 `--json`）等同 `--json --json-full`。适用命令：`context` · `search` · `status` · `project list` · `project relation list` · `project profile check` · `task list` · `task progress` · `fast-start log list` · `fast-start log search` · `spec list` · `spec template registry list` · `spec conflicts` · `spec template list` · `spec lint` · `spec suggest-description` · `user list` · `trash list`。

列式表：字段名整份只声明一次，`rows` 每行按 `cols` 顺序取值、缺失为 `null`，空结果集 `{cols:[],rows:[]}`；取值按 `cols` 下标对齐，**勿硬编码列位置**（列序随字段出现顺序变化）。`project list --with-relations` 特殊：关系明细在**顶层 `relations` 表**里整份只出现一次，行内 `relations` 列降为关系 id 数组。detail 命令（`task info` / `spec show` / `project info` / `project where` / `fast-start log show`）只做去重复表示、保留完整精度与正文，故不设 `--json-full`。

`--page <n>` / `--page-size <n>`：**list 类命令通用翻页**（`task list` / `task progress` / `project list` / `project relation list` / `spec list` / `spec template registry list` / `user list` / `trash list` / `fast-start log list` / `fast-start log search`）。默认不传 = 输出全部；传 `--page-size` 则窗口化，`--json` 在列式表上并列分页元数据 `{cols, rows, page, pageSize, total, totalPages}`。翻页在既有过滤（`--last`/`--project`/`--type` 等）之后生效；`--json-full` 与 `--page-size` 并用时不转列式，分页载荷为 `{entries, page, pageSize, total, totalPages}`。`spec list` 特殊：默认按 scope 分组、每组 `specs` 各自成表，翻页时扁平化为单一 spec 表（每条带 scope 列）。`search` 不接入翻页，其数量杠杆是 `--limit` 系参数。

## 命令分类路由

通用约定（`--force`/`--json`）适用于全部命令。按类别读参数字典：

| 类别 | 涵盖命令 | 参数字典 |
|---|---|---|
| 上下文与检索 | `status` / `context` / `search` | [cli-context-search.md] |
| 项目管理 | `project`（含 relation / profile）/ `link` / `unlink` / `scan` | [cli-project.md] |
| 任务生命周期 | `task`（含 checkpoint / progress / associate / ref-spec）/ `fast-start` | [cli-task.md] |
| 规范管理 | `spec`（含 list / show / set / lint / migrate / export）/ `spec template` | [cli-spec.md] |
| 同步与多用户 | `sync`（含 domain）/ `user` | [cli-sync-user.md] |
| 安装与系统维护 | `init` / `uninject` / `config` / `doctor` / `rag` / `trash` / `web` | [cli-system.md] |
