# @qcqx/lattice-cli

> [English](./README.md) | 简体中文

Lattice 是本地优先的研发记忆与工作流层；CLI 是它在终端和 AI Agent 中的入口。负责将 `@qcqx/lattice-core` 提供的领域能力封装为用户可直接调用的 CLI 命令。

## 安装/更新

```bash
npm install -g @qcqx/lattice-cli
```

安装后可通过 `lattice` 或 `ltc` 调用。

## 快速开始

使用 `init` 命令进行初始化，更新 @qcqx/lattice-cli 后也需要执行 `init`

```bash
ltc init

✔ 请输入你的用户名：
# ......
✔ 选择 RAG embedding 模型：Xenova/bge-small-zh-v1.5
✔ 是否现在下载 embedding 模型？ No
✓ Lattice 初始化完成！
```

也可以用 `ltc init --model <id>` 在非交互场景指定模型。默认是 `Xenova/bge-small-zh-v1.5`（512 维）；其他预设包括 MiniLM、多语言 E5 和 BGE Base。 切换自定义模型时必须传入 `--dimension`；`--query-prefix` / `--document-prefix` 默认清空。

任意 Agent，`/` 搜索 start，执行命令，开始一个新任务

AI 会自动进入 Lattice 工作流，管理任务、项目与生命周期
1. 查看当前项目的研发记忆与上下文（规范、最近任务、关联记忆）
2. 搜索当前或者其它项目有无做过类似的任务，并查看这些任务的 PRD、进度、项目关系、规范等
3. 判断是否有现有进行中的类似任务
4. 判断是否应该为子任务

完成任务后，`/` 搜索 archive 命令进行归档，若有可沉淀的规范，AI 会进行提醒

## 命令概览

| 命令 | 说明 |
|---|---|
| `ltc init` | 初始化 Lattice（含 `init scan` 扫描子命令） |
| `ltc link` | 注册当前目录为 Lattice 项目 |
| `ltc unlink` | 取消注册当前项目 |
| `ltc scan` | 扫描目录树发现可注册项目 |
| `ltc project` | 项目管理（list / info / where / merge / relation 等） |
| `ltc task` | 任务管理（create / start / checkpoint / complete / archive 等） |
| `ltc spec` | 规范管理（list / show / template / conflicts 等） |
| `ltc context` | 聚合并输出当前项目的上下文（规范 / 活跃任务 / 关联记忆） |
| `ltc status` | 当前项目状态概览 |
| `ltc search` | 语义 + 全文混合搜索 |
| `ltc config` | 查看和修改配置 |
| `ltc rag` | RAG 索引管理（status / update / rebuild） |
| `ltc sync` | 模板仓库同步 |
| `ltc doctor` | 数据健康检查与自动修复 |
| `ltc trash` | 垃圾桶管理（list / restore / purge） |
| `ltc user` | 用户管理 |
| `ltc web` | 启动可视化 Web 服务 |

详细参数说明见 [`packages/core/public/templates/skills/zh/command-reference.md`](https://github.com/qxchuckle/lattice/blob/master/packages/core/public/templates/skills/zh/command-reference.md)。

## 架构定位

- **CLI 不承载领域逻辑**，仅负责参数解析、交互确认和格式化输出。
- 所有业务能力均来自 `@qcqx/lattice-core`。
- 所有可执行命令默认接受 `--force` 选项，AI 调用时跳过交互确认。

## 开发

```bash
# 构建
pnpm --filter @qcqx/lattice-cli build

# 类型检查
pnpm --filter @qcqx/lattice-cli check-types
```

## License

MIT
