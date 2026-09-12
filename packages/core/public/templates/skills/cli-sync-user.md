# CLI 参数：同步与多用户

`ltc sync` / `ltc user` 参数。通用约定（`--force`/`--json`）见 [command-reference.md#通用约定]。

## `ltc sync`

同步数据（origin 单仓多机同步 + 域经验包协作）。`--pull` / `--push`（origin 单仓专用）/ `--only <origin|domains>`（只执行一轨）/ `--json`（域同步结果结构化输出）。

默认先 origin（若启用 git）再逐域：全部域 pull（use=off 也保持镜像新鲜）+ 有 routes/有指纹的域 push。

### `ltc sync domain`（域 = 经验包：多用户协作）

域（经验包）管理。

- `join <remote> [--branch <name>] [--label <备注>] [--route <rule>]... [--use trusted|reference|off] [--peek]`：关联一个域（经验包仓库），默认 use=trusted、无 routes = 只读消费；--peek 预览内容后不关联。join 输出内容摘要（N 用户 · M 项目 · K spec + 全局 spec 标题）与安全警告（含同名用户数据/全局 spec 将生效）
- `unlink <hash>`：解除关联（配置+镜像+指纹全清理，主数据毫发无伤）
- `list [--json]`：域列表（数组顺序 = 读时遮蔽优先级；pushState 派生态：只读消费/全量推送/选择性推送 N 条）
- `route add <hash> <rule>` / `route remove <hash> <rule>`：推送白名单规则增删

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
- `ltc spec show <name> --source <hash8>`：直读被遮蔽的域版本

## `ltc user`

管理 Lattice 用户：`list [--json] [--json-full] [--page-size <n>]` 列出所有用户（`--json` 为列式表，列 `name`/`current`）/ `current [--json]` 显示当前用户名（人读输出裸值供 shell 捕获，`--json` 输出 JSON 字符串）/ `switch <name>` 切换当前用户 / `create <name>` 新建用户 / `rename <old> <new>` 重命名（含数据库和文件系统）/ `remove <name> [--force]` 删除用户。
