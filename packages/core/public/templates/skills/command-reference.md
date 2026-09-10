# CLI 命令参数参考

查阅式字典。不知该调哪个命令 → 读流程文档（[task-workflows.md] / [spec-workflows.md] / [project-context.md] / [project-discovery.md]）。

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

## `ltc uninject`

清除 `ltc init` 注入到外部 AI 客户端的文档副作用（**不动 `~/.lattice` 数据**）。默认先全量排查、打印将删清单，确认后执行。

- `-f, --force`：跳过确认直接清除（AI 调用必须带）
- `--tool <ids>`：仅清指定平台（逗号分隔，如 `qoder,cursor`）
- `--dry-run`：只报告将清除的内容，不执行

清除规则：`skills/lattice`、`commands/lattice`、Codex `skills/lattice-*` 整目录删；`agents/lattice-*.md` 按 bundled 名单删（保留用户自定义 agent）；rules 文件（`lattice.mdc` / `CLAUDE.md` / `AGENT.md` / `AGENTS.md`）移除 `<!-- LATTICE:BEGIN/END -->` 标记块——删块后为空则删文件、否则保留用户内容。以全量排查为唯一真源，`init-meta.json` 仅作提示，清除正确性不依赖它。

## `ltc status`

- `--global`：全局状态
- `--json`

## `ltc context`

- `--task <id>`：按任务获取上下文
- `--project <id>`：按项目获取
- `--query <text>`：语义查询（**AI 必须带**，传入当前主题/意图）
- `--current-user`：仅当前用户
- `--json`

嵌套项目自动继承祖先 spec。级联：`当前 > 父级 > 祖先 > 用户级 > 全局`。

## `ltc search <query>`

- `--type <type>`：`spec`/`task`/`project`/`checkpoint`/`relation`
- `--project <id>`
- `--users <names>`：逗号分隔
- `--current-user`
- `--limit <n>`：默认 10
- `--no-rerank`
- `--json`：AI 优先带上

## `ltc link`

**⚠️ AI 不得自动调用。面向用户的注册命令。**

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

- `ref-spec` 的 `<spec...>` **推荐传 spec ID**（`spec-xxxxxxxx`，全局唯一）：按 ID 解析覆盖 global + user + **全部已注册项目**的项目级 spec，可跨项目关联任意项目的项目级 spec；也支持文件名 / 标题模糊 / glob（这三者限 cwd 项目 + user + global）。
- 命中 project 级 spec 时，`referencedSpecs` 会记录其归属 `projectId`，供跨项目反查物理路径（search enrichment）。
- `unref-spec` 参数为 spec ID。

## `ltc spec`

### `ltc spec list`

- `--scope <scope>`：`project`/`user`/`global`
- `--tag <tag>` / `--json`

### `ltc spec show <file>`

- `<file>` **推荐传 spec ID**（全局唯一）：跨 global + user + **全部已注册项目**精确查看，**不受 cwd 限制**（含未在工作区打开、但已注册的其他项目的 spec）。
- 传名称 / 标题 / glob：项目级范围限 **cwd 项目**（+ user + global 层级）——名称跨项目会同名歧义，故收窄；要跨项目查看请改用 spec ID。
- `--user <username>` / `--detail`（显示完整内容）

### `ltc spec conflicts`

### `ltc spec init <relative-path>`

- `--scope` / `--title`（必填）/ `--description` / `--tags` / `--force`

### `ltc spec set <file>`

- `--scope` / `--title` / `--description` / `--add-tag` / `--rm-tag` / `--id`
- `<file>` 支持完整路径：跨项目/任意位置的 spec 直接写回原文件，不受 cwd 所在项目限制

### `ltc spec suggest-description`

列出缺少 `description` 的 spec 并展示上下文帮助补写。project 级覆盖**全部已注册项目**（与 `spec export` 视角一致，不限于 cwd 所在项目）。

- `--scope <scope>`（`all` 默认 / `global` / `user` / `project`=全部项目）/ `--limit <n>` / `--json`（含 `level` + `projectName`）
- 修复提示为 `spec set` 绝对路径命令，可直接跨项目落盘

### `ltc spec lint [file]`

校验 spec frontmatter 完整性（id/title 为 error，description/updated/tags 为 warning；有 error 时退出码非 0）。

- `<file>` 支持模糊匹配与 glob；`--scope` 限定层级
- `--all` 批量扫描（project 级覆盖全部已注册项目）/ `--json`

### `ltc spec migrate [name]`

批量迁移（补 id/刷新 updated/补 title）。`--scope`（默认 all）/ `--dry-run` / `--json` / `--json-format`

### `ltc spec export`

导出 spec 为标准 Agent Skills 目录结构（`SKILL.md` 入口 + `manifest.yaml` hash 清单 + `global/` + `user/` + `<项目名>/` 一层平铺）。文件名加 `<user>__` 前缀；SKILL.md 目录按层级分节，项目级逐项目小节并附包名/git 匹配信息，检测到环境依赖时生成"使用注意"段（引导使用方 AI 灵活处理 ltc/本机路径，不改写正文）；重复导出 hash 对比仅重写变更；警告四类（本机路径/ltc 引用/悬空引用/敏感信息）+ 缺 description 清单只报告不改写。

- `--filter <kw>`（可多次）：tags/文件名/标题/description；项目级含所属项目元数据
- `--tag <tag>`（可多次）/ `--project <id|name>`（可多次）/ `--scope <level>`（默认 all）
- `--user <name>`（可多次；`all`=全部用户；默认当前用户）
- `--name`（skill 名，默认 lattice-specs）/ `--description`（覆盖自动生成）
- `-o, --output <dir>`（默认 `~/.lattice/.cache/export-spec/<skill名>/`，公共文件夹按名分子目录，同名覆盖）
- `--clean`（仅限含本工具 manifest.yaml 的目录）/ `--strict`（警告升错误）/ `--json`
- `--verify <dir>`：不导出，仅校验目录与 manifest 一致性

## `ltc spec template`

`list` / `apply <name>` / `pull <repo>` / `sync [--repo]` / `sync-builtins [--template <names>] [--all]`

### `ltc spec template registry`

`list [--json]` / `remove <repo>`

## `ltc scan`

简单扫描（不写缓存、不交互）。`--dirs <dirs>`

## `ltc sync`

双轨同步：origin 单仓（一个用户多机器间全量）+ 域（经验包多用户协作）。`--pull` / `--push`（origin 单仓专用）/ `--only <origin|domains>`（只执行一轨）/ `--json`（域同步结果结构化输出）。

默认先 origin（若启用 git）再逐域：全部域 pull（use=off 也保持镜像新鲜）+ 有 routes/有指纹的域 push。

### `ltc sync domain`（域 = 经验包：多用户协作）

- `join <remote> [--branch <name>] [--label <备注>] [--route <rule>]... [--use trusted|reference|off] [--peek]`：关联域（默认 trusted、无 routes = 只读消费；--peek 预览内容后不关联）。join 输出内容摘要（N 用户 · M 项目 · K spec + 全局 spec 标题）与安全警告（含同名用户数据/全局 spec 将生效）
- `unlink <hash>`：解除关联（配置+镜像+指纹全清理，主数据毫发无伤）
- `list [--json]`：域列表（数组顺序 = 读时遥蔽优先级；pushState 派生态：只读消费/全量推送/选择性推送 N 条）
- `route add <hash> <rule>` / `route remove <hash> <rule>`：推送白名单增删

**routes 语法**（每域每用户自主，存 config-local.json 的 `sync.domains`）：

- `"*"`：全量推送（仅限四类白名单内容：`users/<me>/{projects,tasks,spec}` + 全局 `spec/`；config/.cache/.trash 等永不入域）
- `project:<glob>`：项目匹配（项目全部 ids + name，minimatch；命中 → 项目目录 + 关联任务 + 项目 spec 随行）
- `user-spec:<glob>` / `global-spec:<glob>`：用户级/全局 spec 相对路径匹配

**域身份** = `sha256(remote#branch)` 前 16 位；一切身份运算恒用 hash，label 仅本机备注。镜像在 `~/.lattice/.sync-domains/<hash>/`（独立 git 仓，各机独立 clone，不经本仓同步）。

**核心语义（v3 读时合并）**：

- pull 止步镜像，**永不落盘主目录**；读时经统一数据源 Provider 合并（spec list/show、search、rag、context）
- 遮蔽：本地主数据 > 域（域间按配置数组序）；键 = spec 同命名空间相对路径 / 任务 id / 项目契约 ID；域数据一律只读（写操作命中域对象报"域只读"）
- `use` 三档消费策略：`trusted` = 读取+约束生效（默认）；`reference` = 只读不注入约束；`off` = 只同步镜像不读取
- push 白名单增量式：只覆盖自己的贡献集 + 基线指纹退出传播（`~/.lattice/.cache/sync-baseline/<hash>.json`；丢失则保守不删）；**别人的内容永不因我 push 被删**
- 冲突（镜像有未推送 commit 且远端分叉）：pull --rebase 失败自动 abort 逃生 + 冲突清单，主数据零污染
- `ltc spec show <name> --source <hash8>`：直读被遥蔽的域版本

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
