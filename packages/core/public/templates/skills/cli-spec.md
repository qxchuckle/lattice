# CLI 参数：规范管理

`ltc spec` / `ltc spec template` 参数。通用约定（`--force`/`--json`）见 [command-reference.md#通用约定]；spec 读写/沉淀流程见 [spec-workflows.md]。

## `ltc spec`

管理 spec 文件。

### `ltc spec list`

列出 spec 文件（按层级 / 标签）。

- `--scope <scope>`：`project`/`user`/`global`
- `--tag <tag>` / `--json`
- `--json-format`：JSON 缩进格式化（默认压缩）
- `--json-full`：输出含每个 spec 的 `content` 全文；默认 `--json` 剥离 content（正文走 `spec show`），保留 title/id/description/tags/filePath

### `ltc spec show <file>`

查看单个 spec 全文。

- `<file>` **推荐传 spec ID**（全局唯一）：跨 global + user + **全部已注册项目**精确查看，**不受 cwd 限制**（含未在工作区打开、但已注册的其他项目的 spec）。
- 传名称 / 标题 / glob：项目级范围限 **cwd 项目**（+ user + global 层级）——名称跨项目会同名歧义，故收窄；要跨项目查看请改用 spec ID。
- 输出含该 spec 的 **id**（普通输出 `id：spec-xxxxxxxx` 行 / `--json` 的 `id` 字段）——按名查到后可直接用 id 去 `task ref-spec`。
- `--user <username>` / `--detail`（显示完整内容）

### `ltc spec conflicts`

检测多层级同名 spec 冲突（global/user/project 同 relativePath）；每个冲突层级输出含 `id`（区分不同层的同名 spec）。

### `ltc spec init <relative-path>`

创建 spec 文件（仅写 frontmatter + 占位标题；正文由 AI 用 search_replace 编辑）。

- `--scope` / `--title`（必填）/ `--description` / `--tags` / `--force`

### `ltc spec set <file>`

修改 spec frontmatter（支持模糊匹配和 glob）。

- `--scope` / `--title` / `--description` / `--add-tag` / `--rm-tag` / `--id`
- `<file>` 支持完整路径：跨项目/任意位置的 spec 直接写回原文件，不受 cwd 所在项目限制

### `ltc spec suggest-description`

列出缺少 `description` 的 spec 并展示上下文帮助补写。project 级覆盖**全部已注册项目**（与 `spec export` 视角一致，不限于 cwd 所在项目）。

- `--scope <scope>`（`all` 默认 / `global` / `user` / `project`=全部项目）/ `--limit <n>` / `--json`（含 `id` + `level` + `projectName`）
- 普通输出与 `--json` 均含 spec `id`，可直接用于 `task ref-spec` / `spec set`
- 修复提示为 `spec set` 绝对路径命令，可直接跨项目落盘

### `ltc spec lint [file]`

校验 spec frontmatter 完整性（id/title 为 error，description/updated/tags 为 warning；有 error 时退出码非 0）。

- `<file>` 支持模糊匹配与 glob；`--scope` 限定层级
- `--all` 批量扫描（project 级覆盖全部已注册项目）/ `--json`（`reports[].specId`）
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

管理 spec 模板：`list` 列出可用模板 / `apply <name>` 应用到当前项目 / `pull <repo>` 从 Git 仓库拉取自定义模板 / `sync [--repo]` 同步已配置模板仓库 / `sync-builtins [--template <names>] [--all]` 同步内置模板到全局目录。

### `ltc spec template registry`

管理模板仓库：`list [--json]` 列出已注册仓库 / `remove <repo>` 删除已注册仓库。
