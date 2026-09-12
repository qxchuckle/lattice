# CLI 参数：规范管理

`ltc spec` / `ltc spec template` 参数。通用约定（`--force`/`--json`）见 [command-reference.md#通用约定]；spec 读写/沉淀流程见 [spec-workflows.md]。

## `ltc spec`

管理 spec 文件。

### `ltc spec list`

列出 spec 文件（按层级 / 标签）。

- `--scope <scope>`：`project`/`user`/`global`
- `--tag <tag>` / `--page <n>` + `--page-size <n>` / `--json`
- `--json-format`：JSON 缩进格式化（默认压缩）
- `--json-full`：输出原始分组对象（含每个 spec 的 `content` 全文）；默认 `--json` 剥离 content（正文走 `spec show`）、保留 title/filePath/id/description/tags，每组 `specs` 为列式表（见 [command-reference.md#通用约定]），翻页时跨 scope 扁平化为单一表

### `ltc spec show <file>`

查看单个 spec 全文。

- `<file>` **推荐传 spec ID**（全局唯一）：跨 global + user + **全部已注册项目**精确查看，**不受 cwd 限制**（含未在工作区打开、但已注册的其他项目的 spec）。
- 传名称 / 标题 / glob：项目级范围限 **cwd 项目**（+ user + global 层级）——名称跨项目会同名歧义，故收窄；要跨项目查看请改用 spec ID。
- 输出含该 spec 的 **id**（普通输出 `id：spec-xxxxxxxx` 行 / `--json` 的 `id` 字段）——按名查到后可直接用 id 去 `task ref-spec`。
- `--user <username>` / `--detail`（显示完整内容）
- `--json`：detail 命令，只做**去重复表示**（删 `fileName` 与退化为 basename 的 `relativePath`，定位用 `filePath`），保留完整精度与 `--detail` 正文，故不设 `--json-full`

### `ltc spec conflicts`

检测多层级同名 spec 冲突（global/user/project 同 relativePath）；每个冲突层级输出含 `id`（区分不同层的同名 spec）。

- `--json`：列式表 `{cols,rows}`，**每个层级一行**（列 `fileName`/`scope`/`specId`/`filePath`/`snippet`）；无冲突时 `{cols:[],rows:[]}`
- `--json-full`：原始冲突数组（`fileName` + 嵌套 `levels`）
- 当前目录不是 Lattice 项目时：`--json` 下提示走 stderr + 退出码 1（stdout 保持纯净可解析），人读模式走 stdout

### `ltc spec init <relative-path>`

创建 spec 文件（仅写 frontmatter + 占位标题；正文由 AI 用 search_replace 编辑）。

- `--scope` / `--title`（必填）/ `--description` / `--tags` / `--force`

### `ltc spec set <file>`

修改 spec frontmatter（支持模糊匹配和 glob）。

- `--scope` / `--title` / `--description` / `--add-tag` / `--rm-tag` / `--id`
- `<file>` 支持完整路径：跨项目/任意位置的 spec 直接写回原文件，不受 cwd 所在项目限制

### `ltc spec suggest-description`

列出缺少 `description` 的 spec 并展示上下文帮助补写。project 级覆盖**全部已注册项目**（与 `spec export` 视角一致，不限于 cwd 所在项目）。

- `--scope <scope>`（`all` 默认 / `global` / `user` / `project`=全部项目）/ `--limit <n>`（只影响展示条数，`total` 始终给全量数）/ `--json`（`specs` 为列式表，列含 `id` / `level` / `projectName` / `contentSnippet`）/ `--json-full`（`specs` 为原始对象数组、不做列式；退化为 basename 的 `relativePath` 属重复表示，两种模式都已删）
- 普通输出与 `--json` 均含 spec `id`，可直接用于 `task ref-spec` / `spec set`
- 修复提示为 `spec set` 绝对路径命令，可直接跨项目落盘

### `ltc spec lint [file]`

校验 spec frontmatter 完整性（id/title 为 error，description/updated/tags 为 warning；有 error 时退出码非 0）。

- `<file>` 支持模糊匹配与 glob；`--scope` 限定层级
- `--all` 批量扫描（project 级覆盖全部已注册项目）/ `--json`（列式表 `{cols,rows}`，列 `filePath`/`specId`/`ok`/`issues`；`ok` = 无 error 级问题，warning 不翻转它）/ `--json-full`（原始报告数组、保留空值、不做列式；退化为 basename 的 `relativePath` 属重复表示，两种模式都已删）
- 普通输出完整模式每个 spec 段含 `id` 行

### `ltc spec migrate [name]`

批量迁移历史 spec：自动补 id / 刷新 updated / 补 title（不自动补 description）。编辑 spec 正文后必跑。`--scope`（默认 all）/ `--dry-run` / `--json` / `--json-format`

### `ltc spec export`

导出 spec 为标准 Agent Skills 目录结构（`SKILL.md` 入口 + `manifest.yaml` hash 清单 + `global/` + `user/` + `<项目名>/` 一层平铺）。文件名加 `<user>__` 前缀；SKILL.md 目录按层级分节，项目级逐项目小节并附包名/git 匹配信息，检测到环境依赖时生成"使用注意"段（引导使用方 AI 灵活处理 ltc/本机路径，不改写正文）；重复导出 hash 对比仅重写变更；警告四类（本机路径/ltc 引用/悬空引用/敏感信息）+ 缺 description 清单只报告不改写。

- `--filter <kw>`（可多次）：tags/文件名/标题/description；项目级含所属项目元数据
- `--tag <tag>`（可多次）/ `--project <id|name>`（可多次）/ `--scope <level>`（默认 all）
- `--user <name>`（可多次；`all`=全部用户；默认当前用户）
- `--name`（skill 名，默认 lattice-specs）/ `--description`（覆盖自动生成）
- `-o, --output <dir>`（默认 `~/.lattice/.cache/export-spec/<skill名>/`，公共文件夹按名分子目录，同名覆盖）
- `--clean`（仅限含本工具 manifest.yaml 的目录）/ `--strict`（警告升错误）/ `--json`
- `--verify <dir>`：不导出，仅校验目录与 manifest 一致性
- 输出含 spec `id`：`--json` 的 `manifest.files[].source.specId` 与 `missingDescriptions[].specId`；普通输出的缺 description 清单每项附 `id`（可直接 `task ref-spec` / `spec set`）

## `ltc spec template`

管理 spec 模板：`list [--json] [--json-full]` 列出可用模板（`--json` 为列式表，列 `name`/`description`/`defaultScope`/`source`/`files`；`--json-full` 为原始对象数组）/ `apply <name>` 应用到当前项目 / `pull <repo>` 从 Git 仓库拉取自定义模板 / `sync [--repo]` 同步已配置模板仓库 / `sync-builtins [--template <names>] [--all]` 同步内置模板到全局目录。

### `ltc spec template registry`

管理模板仓库：`list [--json] [--json-full] [--page-size <n>]` 列出已注册仓库（`--json` 为列式表，无仓库时 `rows` 为空）/ `remove <repo>` 删除已注册仓库。
