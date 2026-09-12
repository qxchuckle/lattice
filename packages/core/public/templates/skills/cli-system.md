# CLI 参数：安装与系统维护

`ltc init` / `ltc uninject` / `ltc open` / `ltc config` / `ltc doctor` / `ltc rag` / `ltc trash` / `ltc web` 参数。通用约定（`--force`/`--json`）见 [command-reference.md#通用约定]；命令异常排错见 [troubleshooting.md]。

## `ltc init`

初始化 Lattice（`~/.lattice/`）。

- `-f, --force`：跳过确认
- `--username <name>`：指定用户名
- `--git [boolean]`：启用 Git 管理（默认开启）
- `--git-remote <url>`：Git 远程仓库
- `--scan-dirs <dirs>`：扫描目录（逗号分隔）
- `--registry-template <urls>`：拉取模板仓库

### `ltc init scan`

扫描本地 git 项目并注册到 Lattice（写扫描缓存、有交互配置）。

- `--dirs <dirs>`：扫描目录（逗号分隔）；不传用配置 `scanDirs`
- `--auto`：使用配置中 `scanDirs`，跳过交互

## `ltc uninject`

清除 `ltc init` 注入到外部 AI 客户端的文档副作用（**不动 `~/.lattice` 数据**）。默认先全量排查、打印将删清单，确认后执行。

- `-f, --force`：跳过确认直接清除（AI 调用必须带）
- `--tool <ids>`：仅清指定平台（逗号分隔，如 `qoder,cursor`）
- `--dry-run`：只报告将清除的内容，不执行

清除规则：`skills/lattice`、`commands/lattice`、Codex `skills/lattice-*` 整目录删；`agents/lattice-*.md` 按 bundled 名单删（保留用户自定义 agent）；rules 文件（`lattice.mdc` / `CLAUDE.md` / `AGENT.md` / `AGENTS.md`）移除 `<!-- LATTICE:BEGIN/END -->` 标记块——删块后为空则删文件、否则保留用户内容。以全量排查为唯一真源，`init-meta.json` 仅作提示，清除正确性不依赖它。

## `ltc open`

打开 Lattice 根目录（文件管理器）。`-t, --terminal`：在终端中打开而非文件管理器。

## `ltc config`

查看和修改全局配置。

`show [--json] [--scope] [--diff-defaults]`（显示完整配置）/ `get <key> [--json] [--scope]`（读取单项，点路径）/ `set <key> <value> [--json] [--scope]`（设置单项，点路径）/ `unset <key> [--scope]`（移除单项，点路径）

`set` 的 `--json` 为**输入语义**（全局"带 --json 调用"规则的例外）：

| 调用 | value 解析 |
|---|---|
| `set <key> <value>` | 形如 JSON（`{...}` / `[...]` / 双引号串）自动解析，其余原样存字符串 |
| `set <key> <value> --json` | 强制整个 value 按 JSON 解析，解析失败即报错（纯字符串如 `alice` 必报错） |

标量 JSON（`123` / `true` / `null`）需 `--json` 才按类型写入；对象 / 数组不带即可。

## `ltc doctor`

检测和修复 Lattice 配置健康状况。

- `--fix` / `--migrate` / `--rebuild-fingerprints` / `--recheck-scope-paths` / `--json`

## `ltc rag`

管理 RAG 索引：`status [--json]` 查看索引状态 / `update` 增量更新（仅处理变更文档）/ `rebuild` 重建全部 embedding 索引。

## `ltc trash`

垃圾桶管理（查看、恢复、清空已删除的内容）：`list [--type] [--json]` 列出内容 / `restore <id>` 恢复已删除内容 / `purge [id] [-f] [--all]` 彻底删除（不可恢复）。

## `ltc web`

启动 Lattice 可视化 Web 服务。`-p, --port <port>`（默认 3000）/ `--no-open`
