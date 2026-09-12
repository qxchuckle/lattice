# CLI 参数：项目管理

`ltc project` / `ltc link` / `ltc unlink` / `ltc scan` 参数。通用约定（`--force`/`--json`）见 [command-reference.md#通用约定]；项目识别/注册/关系流程见 [project-discovery.md]。

## `ltc link`

将当前项目注册到 Lattice（基于 git 指纹 + lattice.json）。

**⚠️ AI 不得自动调用。面向用户的注册命令。**

- `--name <name>` / `--description <desc>` / `--groups <groups>` / `--tags <tags>`
- `--template <templates>`：应用 spec 模板（逗号分隔或 `all`）
- `--restore <id>`：重新绑定已有项目
- `--force-new`：强制新建
- `-y, --yes`：非交互（检测到候选仅警告并新建）

## `ltc unlink`

取消当前项目的 Lattice 注册。

- `--force` / `--remove-data`（同时删除项目数据）

## `ltc project`

管理已注册项目。

### `ltc project list`

列出所有已注册项目（关键词匹配 + RAG 语义回退）。

- `--group` / `--tag` / `--has-git` / `--orphaned` / `--with-relations` / `--json` / `--json-format`
- `--json-full`：关闭瘦身层——保留完整时间戳与空值字段、**保留完整 `git_first_commit`（40 位 sha；`id` 只含前 16 位，余下 24 位属瘦身层省略项）**、`--with-relations` 的行内关系明细，且不转列式表（两层模型见 [command-reference.md#通用约定]）。**重复表示在两种模式下都已去除**：与解析后 camelCase 字段（`localPaths`/`gitRemotes`/`packageNames`/`monorepoPackages`）同值的 snake_case 原始 DB 列、与 `id` 同值的 `ids`
- `--with-relations`：`--json` 下关系明细整份只在**顶层 `relations` 表**出现一次（同一条关系不在两端项目行各存一份），行内 `relations` 列降为关系 id 数组；`--json-full` 保持行内嵌套明细
- `--search <keyword>`：大小写不敏感匹配（名称/ID/路径/Git/包名/分组/标签）+ RAG 语义回退
- `--keyword-only`：跳过语义搜索

### `ltc project where <path>`

查询路径属于哪个已注册项目（精确 + 父目录前缀 + ID 匹配）。`--json` 输出 `{queryPath, exact, prefixMatches}`：`exact` 与 `project list` 行同 shape（解析后的 camelCase 字段，原始 DB 列作为重复表示已去除）。属 **detail 命令**：只跑去重复表示、保留完整精度与空值字段，故不设 `--json-full`。输出的绝对路径可直接喂回 `project where` / `Read` / `jq`（CLI 全链路不做 `~` 缩写）。

### `ltc project register [paths...]`

向上扫描路径的 ID 源（.git / lattice.json）并注册未注册项目（默认 cwd）。规则要求：出现非 cwd 新路径且不会在该路径执行 ltc 时当轮注册（[project-discovery.md#自动注册（守卫）]）。

- `--json` / `--json-format`

### `ltc project info <id>`

查看项目详情。`--json`

### `ltc project update <id>`

更新项目元数据。

`--name` / `--description` / `--groups` / `--tags`

### `ltc project remove <id>`

删除项目数据（移入垃圾桶，可恢复）。`--force`

### `ltc project relation list [id]`

查看项目间关系（默认聚合所有用户定义的关系）。

- `--current-user` / `--user <users>`（互斥）/ `--page <n>` + `--page-size <n>` / `--json`（列式表）/ `--json-format` / `--json-full`
- 默认聚合所有用户（其他用户标注 `[username]`）

### `ltc project relation add <project-a> <project-b>`

创建项目间关系（重复 a/b/type 视为同一条，会更新描述）。

- `--type <type>`：默认 `related`（forked-from/depends-on/shares-component/nested-in/related）
- `--description <desc>`
- `--from-task <taskId>` / `--ai-inferred`

### `ltc project relation remove <relation-id>`

按 id 删除项目间关系（id 见 `relation list`）。`--force`

### `ltc project merge <from> <to>`

将两个项目物理合并为一个（from → to，事务操作）。`-f, --force`

### `ltc project profile check`

检测哪些项目的画像需要更新。`--project <id>` / `--json`（各分组为列式表 `{cols,rows}`，条目省略与分组键同义的 `status`）/ `--json-full`（原始分组数组、保留 `status`）

人读输出首行给摘要（`共 N 个项目：需要更新 a · 已最新 b · 未生成画像 c · 警告 d`），随后 `需要更新` / `警告` 逐项带理由、`未生成画像` 逐项列名；项目多时用 `--json` 配合 jq 取用。

### `ltc project profile brief <id>`

一次性获取项目画像所需的所有 lattice 内部信息。`--json`

### `ltc project profile done <id>`

标记画像生成完成（采集缓存 + 同步 profileUpdated + 触发 rag update）。

### `ltc project profile show <id>`

查看项目画像（summary + tags + cache 状态 + 文件路径）。`--json`

### `ltc project profile path <id>`

输出项目 profile 目录路径。

### `ltc project profile tags show <id>` / `tags set <id> --tags "a,b"` / `tags add` / `tags remove`

管理项目标签：`show` 查看 / `set` 全量替换 / `add` 追加（去重）/ `remove` 删除指定标签。

## `ltc scan`

扫描目录发现所有 Lattice 项目（简单扫描，不写缓存、不交互）。`--dirs <dirs>`
