# CLI E2E（L3：构建产物级）

端到端跑 `packages/cli/dist/index.js`（构建产物），覆盖命令矩阵关键路径与退出码 / 输出流契约。
纯离线（无网络、无 embedding 模型下载），与真实 `~/.lattice` 完全隔离。

## 运行

```bash
pnpm test:e2e        # 先 build:core + build:cli，再跑本套件
# 等价于：
pnpm build:core && pnpm build:cli && pnpm exec vitest run --project cli
```

> 测试本身不触发构建；缺产物时助手会给出明确的构建指引（`assertBuildArtifacts`）。

## 隔离约定（红线）

- 每个套件 `mkdtemp` 一次性 `HOME`，`LATTICE_HOME=$HOME/.lattice`，不触达真实 `~/.lattice` 与本机 AI 工具目录
- 硬离线：`config set rag.embedding.allowRemoteModels false --scope global`（search 走 FTS 降级路径）
- 子进程 stdin 为管道：交互式提示必须确定性跳过（依赖 `init -f` 的「非 TTY 自动跳过 AI 工具勾选」修复）
- `runCli` 永不 throw，统一返回 `exitCode`；machine 契约（`--json`）下失败走 stderr + 非零退出

## 覆盖矩阵（core-flow.test.ts）

| 域 | 用例 | 断言要点 |
|---|---|---|
| status | `--global`；非项目目录 | 用户名可见；友好提示而非报错 |
| project | register / list / where / list --search --keyword-only | 注册成功；列表可见；cwd 身份解析；关键词过滤 |
| task | create --current；start；update 非法状态（人读 + `--json`）；checkpoint（成功 / 非法 type）；progress；list；complete | ID/PRD 路径；状态机流转；machine 契约（stderr + 非零退出）；`cp_` id；进度可读回 |
| trash | delete → list → restore；restore 不存在条目 | 软删除不可见；条目 ID 解析；恢复可见；明确提示 |
| search | 关键词命中；噪音查询 | `{cols,rows}` 表格结构；噪音零结果 |
| 边界 | doctor / `--help` / 未知命令 / info 不存在 ID | 退出码语义与提示信息 |

## 分层归属

| 层 | 位置 | 说明 |
|---|---|---|
| L1 单测 | `packages/*/tests/**`（vitest projects） | 直测源码，免构建 |
| L2 集成 | `packages/core/tests/**`（如 `task-lifecycle.test.ts`） | 核心域多模块联通（DB + 文件 + 领域逻辑） |
| L3 CLI E2E | 本目录 | 构建产物 + 真实子进程 + 退出码契约 |
| L4 宿主 | `packages/vscode/tests/integration/`（@vscode/test-cli） | 真实 VS Code 宿主 |

> 深路径（同步 / 镜像、spec 迁移、检索元数据等）见 L2 套件；本目录只覆盖 CLI 命令面。
