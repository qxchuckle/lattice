# CLI 命令参数参考

查阅式字典路由。按命令类别转对应子文档；不知该调哪个命令 → 读流程文档（[task-workflows.md] / [spec-workflows.md] / [project-context.md] / [project-discovery.md]）。

## 通用约定

`-f, --force` 跳过二次确认。AI 调用以下命令**必须**加 `-f`/`--force`：

| 命令 | 确认内容 |
|---|---|
| `ltc init` | 是否下载 embedding 模型 |
| `ltc uninject` | 清除注入（删目录/文件、移除标记块） |
| `ltc unlink` | 取消项目注册 |
| `ltc project remove <id>` | 删除项目数据 |
| `ltc project relation remove <a> <b>` | 删除项目关系 |
| `ltc task delete <id>` | 彻底删除任务 |
| `ltc user remove <name>` | 删除用户 |
| `ltc fast-start log clear` | 清空日志 |

`--json`：所有**叶子**命令均接受，**父命令一律不接受**（选项兜底只补叶子）。父命令里实际会踩到的是自带 action 的两个——`ltc sync --json` / `ltc config --json` 报 `unknown option` 到 stderr 并退出 1，规避是调子命令（`ltc sync domain list --json` / `ltc config show --json`）；不给父命令补 `--json` 是因为 commander 里祖先声明的同名选项会**遮蔽**后代，补了会让 `sync domain list --json` / `config get <key> --json` 的 `opts().json` 变 undefined、JSON 出口静默失效。

按命令有无 JSON 数据出口分两种行为：**有**出口 → 返回 JSON；**无**出口 → 成功路径仍输出人读文本（stdout、退出码 0，与不带 `--json` 逐字相同），失败路径进 machine 模式（提示走 stderr、退出码 1，见下段）。`--json` 是 machine 模式开关而非投影开关：写命令多数没有 `-q`，它是这些命令唯一的 machine 入口。语义例外：`config set --json` 是将输入 value 按 JSON 解析，非输出格式控制（见 [cli-system.md#ltc-config]）。

machine 模式（`--json` / `-q`）下的**失败与空态**：提示走 **stderr** + 退出码 **1**，stdout 保持空（绝不吐人读文本）；「成功但结果为空」仍给合法空载荷（`{cols:[],rows:[]}`、`{total:0,...}`）。因此 `$(ltc ... --json)` 与管道永不会捕到非数据字节，失败可由退出码识别。人读模式下这些提示仍在 stdout、退出码不变。

`--json-format`：凡接受 `--json` 的命令均自动接受（`config set` 除外——其 `--json` 是输入解析语义），改**排版**为缩进格式化（默认单行压缩），不改字段与 shape。

`--json-full`：关闭下表的**瘦身层**——恢复被省略的空值字段、完整 ISO 时间戳、RAG 内部打分/调试 meta、detail 正文（`spec list` 的 content）、`task list` 的 referencedSpecs 明细、画像检查条目的 `status`，且不转列式表。它**不恢复重复表示**——去重层两种模式都生效。单独给出（不带 `--json`）等同 `--json --json-full`。适用命令：`context` · `search` · `status` · `project list` · `project relation list` · `project profile check` · `task list` · `task progress` · `fast-start log list` · `fast-start log search` · `spec list` · `spec template registry list` · `spec conflicts` · `spec template list` · `spec lint` · `spec suggest-description` · `user list` · `trash list`。

`--json` 输出经两层正交处理：

| 层 | 作用 | `--json-full` 下 |
|---|---|---|
| **去重复表示** | 删「同一信息在载荷内的第二份拷贝」，判据严格到**值全等或可由兄弟字段机械还原**：`fileName` = basename(`filePath`)；`relativePath` 退化为 basename 时（含子目录时保留——它是 scope 内身份与跨层冲突键）；原始 snake_case DB 列与解析后数组同值时（`local_path`↔`localPaths` 等四对）；`ids` 等于 `[id]` 时；`matchedVia` 删 `docType`（可由路径段推出）、有 `tasks` 数组时删 `docTitle`/`docPath`/`taskId`（皆其派生）；`snippet` 与 `filePath`/`title` 同值；`task info` 中与 `tree` 全等的 `descendants`、与 `meta` 全等的单条 `lineage` | **同样生效**（信息零损失，无需逃生阀） |
| **瘦身** | 省略 null / 空数组 / 空串 / 空对象；ISO 时间戳降到日期；丢 RAG 内部打分与调试字段；detail 归位（`spec list` 去 content、`project list` 去 `git_first_commit`——其前 16 位已在 `id` 里，余下 24 位可从 git/DB 取回）；对象数组编码为列式表 `{cols, rows}` | 关闭 |

**归类铁律**：「有损但可从别处取回」一律归**瘦身层**，不进去重层——去重层的判据必须严到值全等或机械可还原，否则逃生阀形同虚设（例如完整 40 位 sha 只有前 16 位在 `id` 里、单任务 `matchedVia.docTitle` 需 `task info` 取回，两者都属瘦身层）。

列式表：字段名整份只声明一次，`rows` 每行按 `cols` 顺序取值、缺失为 `null`，空结果集 `{cols:[],rows:[]}`；取值按 `cols` 下标对齐，**勿硬编码列位置**（列序随字段出现顺序变化）。`project list --with-relations` 特殊：关系明细在**顶层 `relations` 表**里整份只出现一次，行内 `relations` 列降为关系 id 数组。detail 命令（`task info` / `spec show` / `project info` / `project where` / `fast-start log show`）只做去重复表示、保留完整精度与正文，故不设 `--json-full`。

`--page <n>` / `--page-size <n>`：**list 类命令通用翻页**（`task list` / `task progress` / `project list` / `project relation list` / `spec list` / `spec template registry list` / `user list` / `trash list` / `fast-start log list` / `fast-start log search`）。默认不传 = 输出全部；传 `--page-size` 则窗口化，`--json` 在列式表上并列分页元数据 `{cols, rows, page, pageSize, total, totalPages}`（带 total/totalPages，翻页可达全部、信息不丢）。翻页在既有过滤（`--last`/`--project`/`--type` 等）之后生效。`--json-full` 与 `--page-size` 并用时不转列式，分页载荷为 `{entries, page, pageSize, total, totalPages}`。`spec list` 特殊：默认按 scope 分组、每组 `specs` 各自成表，翻页时扁平化为单一 spec 表（每条带 scope 列）。`search` 不接入翻页，其数量杠杆是 `--limit` 系参数。

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
