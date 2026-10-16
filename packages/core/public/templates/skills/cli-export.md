# CLI 参数：知识导出

`ltc export` 参数。通用约定（`--force`/`--json`）见 [command-reference.md#通用约定]；spec 读写/沉淀流程见 [spec-workflows.md]。迁移：原 `ltc spec export` 等价于 `ltc export --only spec`（选项名沿用）。

## `ltc export`

把 spec 与 tasks 导出为标准 Agent Skills 目录（`SKILL.md` 入口 + `project-index.md` 项目索引 + `spec-catalog.md` / `task-catalog.md` 渐进式目录 + `manifest.yaml` hash 清单 + `global/` + `user/` + 项目文件夹 + `tasks/`）。SKILL.md 面向无 Lattice 环境的 Agent 自描述：description 为固定模板（知识库作用 + 何时必须读取，不含计数等数据面内容）；正文含「怎么使用」与「目录」。项目索引表记录涉及项目的包名 / git remote / 描述与规范·任务计数（外部 AI 先在本地环境对上项目）；任务档案含「关联项目 / 相关规范」引用、任务目录按项目分组并在项目节附规范目录引用——项目 ↔ 规范 ↔ 任务 可串联阅读。文档间引用为 Markdown 相对链接（`[标题](相对路径)`，人可点击跳转；双消费者（AI + 人）场景下对 AI 文档引用惯例的有意例外）。任务文件名为短 id 形式（`<用户>__<日期>-<短id>.md`；完整 taskId 与标题在 frontmatter / 正文 / 目录行中），避免路径内嵌标题 slug 的重复表示。内容含本机路径 / Lattice 引用时自动生成「使用注意」引导使用方在当前环境找对应物。产物体积优化只在结构层（去重复表示 / 目录分层 / 空列省略），不截断、不裁剪任何知识内容。重复导出按 manifest hash 对比仅重写变更文件。

快速上手：

- 个人知识库全量（当前用户，默认口径）：`ltc export`
- 团队规范分发：`ltc export --filter hbos --only spec --name hbos-specs -o <分发仓库>/hbos-specs`（先 `--dry-run` 预演；更新分发仓库加 `--prune` 清理陈旧文件）
- 多用户 + 排除项目：`ltc export --user all --exclude-project 'chord,lattice'`
- 进行中工作交接：`ltc export --only task --task-status in_progress`
- 时间阶段回溯：`ltc export --task-since 2026-09-01 --task-until 2026-09-30`

筛选（组合语义：类型收窄 → 同类 OR、排除优先 → 异类 AND；除 `--filter` 外多值选项支持重复或逗号）：

- `--only <kind>`：spec / task（重复或逗号；默认全部已注册类型）
- `--scope <level>`：global / user / project（spec 层级，可组合）
- `--user <name>` / `--exclude-user <name>`：用户（默认当前用户；`all`=全部用户）
- `--project <v>` / `--exclude-project <v>`：项目 id / 名称 / 包名，子串或 `*` 通配；项目白名单只保留项目级 spec，黑名单对任务为「涉及即剔除」
- `--tag <tag>` / `--exclude-tag <tag>`：spec 标签（精确）
- `--filter <kw>` / `--exclude-filter <kw>`：关键词（spec 元数据+项目元数据；task 标题+PRD+设计档案+过程记录；自由文本，仅重复）
- `--spec <v>` / `--exclude-spec <v>`：spec 精确条目（id / 文件名，前缀或 `*`）
- `--task <v>` / `--exclude-task <v>`：任务精确条目（id 前缀或 `*`）
- `--task-status <s>`：planning / in_progress / completed / archived / all（默认 archived）
- `--task-since <date>` / `--task-until <date>`：任务创建时间窗（YYYY-MM-DD，UTC，双端 inclusive）
- `--task-depth <d>`：digest（默认：frontmatter + PRD + 关联项目 + 相关规范 + 设计档案 + 过程记录）/ prd（仅 frontmatter + PRD）/ full（原样目录 + README）

产物与校验：

- `--name <name>`（kebab-case，默认 lattice-knowledge）/ `--description <d>`（覆盖自动生成的 description）
- `-o, --output <dir>`：输出目录，默认 `~/.lattice/.cache/export-skill/<skill名>/`
- `--dry-run`：预演（筛选/统计/警告/将写入与将清理清单），不写盘
- `--prune`：删除旧 manifest 记录、本次未导出的陈旧文件（分发仓库更新场景；与 `--clean` 互斥）
- `--clean`：清空目标目录后重导（不限是否本工具产物；与 `--overwrite`/`--prune` 互斥）
- `--overwrite`：目标非空且非本工具管理时覆盖合并写入（同名路径覆盖、其余保留；与 `--clean` 互斥）
- `--verify <dir>`：不导出，仅校验目录与 manifest 一致性（兼容历史 spec export 目录）
- `--strict`：警告升为错误（退出码非零，CI 友好）
- `--json`：结构化报告（stats / written / skipped / deleted / warnings / projectMatches 全量）

口径注意：

- 写入安全默认：目标目录非空且非本工具管理（无 manifest.yaml）时**默认拒绝并提示**——用 `--clean` 清空重导或 `--overwrite` 覆盖合并；含本工具 manifest.yaml 的目录默认增量放行（重复导出只需直接重跑）
- `--project` 只保留项目级 spec（user/global 一并被排除）；要「某项目相关的全层规范」用 `--filter`
- 任务 `--filter` 为召回口径（命中 PRD 正文，命中面可能很大）；先 `--dry-run` 看命中数再收窄
- 精确选任务时注意默认仅 archived：需要含其他状态时配 `--task-status all`
- 排除类过滤后重导到同一目录：旧文件不会自动删除，用 `--prune` 清理残留
