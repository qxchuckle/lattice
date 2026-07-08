# 快速开始

本指南将带你从零开始，逐步完成 Lattice 的安装、初始化和基本使用。

## 前置条件

- **Node.js** >= 18
- **Git**（Lattice 通过 git 指纹识别项目）

## 1. 安装

```bash
# 全局安装，提供 lattice 和 ltc 两个命令
npm install -g @qcqx/lattice-cli
```

验证安装：

```bash
ltc --version
```

> `lattice` 和 `ltc` 是同一个命令的两个别名，本指南统一使用 `ltc`。

## 2. 初始化 Lattice

```bash
ltc init
```

初始化会完成以下工作：

- 创建 `~/.lattice/` 目录结构（详见 [目录结构与配置详解](directory-and-config.md)）
- 设置当前用户（默认使用系统用户名）
- 可选：扫描本地 git 项目并自动注册
- 可选：向 AI 客户端（Cursor / Claude Code / Qoder / Trae 等）注入 Lattice 工作流

### 常用选项

```bash
# 指定用户名
ltc init --username myname

# 初始化时不启用 git 管理
ltc init --git false

# 初始化时指定扫描目录
ltc init --scan-dirs ~/projects,~/work

# 导入自定义 spec 模板仓库
ltc init --registry-template https://github.com/myorg/spec-templates.git

# 初始化后立即下载 embedding 模型（用于 RAG 搜索）
ltc init --download-model
```

### AI 客户端集成

`ltc init` 会检测本地已安装的 AI 客户端，并询问是否注入 Lattice 工作流文件。注入后，AI 在编码前会自动获取项目规范和上下文。

支持的工具：

- **Cursor**（`.cursor/`）
- **Claude Code**（`.claude/`）
- **Qoder**（`.qoder/`）
- **Trae**（`.trae/`）

## 3. 注册项目

Lattice 通过 git 指纹自动识别项目。根据项目类型选择注册方式：

### 方式一：自动扫描（推荐，适用于 Git 项目）

```bash
# 扫描指定目录下的所有 git 项目
ltc scan --dirs ~/projects

# 或在初始化时直接扫描
ltc init scan
```

扫描会自动发现 git 项目并注册，同时检测嵌套项目关系（如 monorepo 子包）。大多数情况下这是最省事的方式——只需指定你的项目根目录，Lattice 会自动完成识别和注册。

### 方式二：手动注册（适用于非 Git 项目）

对于纯本地项目（没有 `.git` 目录），需要手动注册：

```bash
cd ~/my-project
ltc link
```

`ltc link` 会在项目根目录生成 `lattice.json`，将项目注册到 Lattice。你可以附加元信息：

```bash
ltc link --name "我的项目" --description "项目描述" --tags "frontend,react"
```

### 验证注册

```bash
# 查看当前项目是否已注册
ltc status
```

## 4. 通过 Agent Command 使用 Lattice

完成安装、初始化和项目注册后，日常使用 Lattice 的主要方式是 **Agent Command**——在 AI 编程助手（Cursor / Claude Code / Qoder / Trae）中输入 `/lattice/...` 命令触发工作流。

### CLI 与 Agent Command 的分工

| | CLI（`ltc`） | Agent Command（`/lattice/...`） |
|---|---|---|
| **使用者** | AI 在工作流中自动调用 / 人类手动执行 | 人类在 AI 助手中输入 |
| **定位** | 底层执行（读写、搜索、状态更新） | 工作流入口（组织任务、获取上下文、沉淀经验） |
| **频率** | AI 高频调用 | 人类按需触发 |

> `ltc init` 时注入的 AI 客户端文件包含完整的 agent command 定义。如果未注入，参考[初始化](#2-初始化-lattice)章节重新运行 `ltc init`。

### Agent Command 清单

| 命令 | 用途 | 何时使用 |
|---|---|---|
| `/lattice/context` | 获取项目或任务上下文 | 进入新项目 / 切换工作目录 / 开始新会话 |
| `/lattice/keep` | 轻量工作流自检 | 连续对话中快速核对任务身份 / 工作流约束 / PRD 范围 |
| `/lattice/task/query` | 查询项目情况 / 任务进展 / 历史完成（只读） | 想了解当前任务、历史方案、项目规范 |
| `/lattice/task/design` | 讨论方案 / 分析设计（不改代码） | 需要分析架构、比较方案、评估可行性 |
| `/lattice/task/start` | 开始实施任务 | 方案确定，准备动手写代码 |
| `/lattice/task/checkpoint` | 记录任务关键进展 | 做出技术决策 / 用户给出约束 / 发现问题 |
| `/lattice/task/archive` | 结束任务并判断是否沉淀规则 | 任务完成，准备收尾 |
| `/lattice/task/delete` | 删除任务 | 任务创建错误 / 需要清理 |
| `/lattice/spec/update/project` | 沉淀当前项目特有规则 | 项目级约定、架构认知 |
| `/lattice/spec/update/user` | 沉淀跨项目可复用规则 | 跨项目通用经验、用户级偏好 |
| `/lattice/spec/update/global` | 沉淀多用户多项目共享规则 | 全局默认规则 |

### 典型使用流程

```
新会话开始
  │
  ├─ 需要查信息？
  │    └─ /lattice/task/query  ← 只读查询，不改任何文件
  │
  ├─ 需要讨论方案？
  │    └─ /lattice/task/design ← 只读分析，讨论写入 design.md
  │
  ├─ 准备实施？
  │    └─ /lattice/task/start  ← 创建/启动任务，进入实施模式
  │         │
  │         ├─ （AI 自动调用 ltc CLI 执行工作流，包括自动打 checkpoint）
  │         │
  │         └─ /lattice/task/checkpoint  ← 也可主动触发，记录关键进展
  │
  ├─ 觉得 AI 脱离了 Lattice 工作流？
  │    └─ /lattice/keep         ← 轻量自检，纠正回工作流轨道
  │
  ├─ 任务完成？
  │    └─ /lattice/task/archive ← 归档 + AI 自动判断是否沉淀 spec
  │
  └─ 形成了可复用经验？
       └─ /lattice/spec/update/{project|user|global}  ← 沉淀为 spec（按层级选择）
```

> Agent Command 的详细工作流由 Lattice skill 文档驱动，AI 接收命令后会自动加载对应的 skill 并按流程执行。人类只需知道**何时用哪个命令**。

## 5. CLI 命令参考

> 以下 CLI 命令主要由 AI 在 Agent Command 工作流中自动调用。人类手动操作时也可直接使用，但日常使用推荐通过 [Agent Command](#4-通过-agent-command-使用-lattice) 触发。

### 获取项目上下文

```bash
ltc context
```

这是 Lattice 的核心命令。它聚合当前项目的所有上下文信息：

- **Spec 列表**：项目级 / 用户级 / 全局级规范
- **活跃任务**：当前进行中的任务
- **关联项目**：与其他项目的关系

```bash
# 查看指定项目的上下文
ltc context --project <project-id>

# 结合任务查看上下文
ltc context --task <task-id>
```

### 管理 Spec

Spec 是 Lattice 中的可复用知识单元，记录项目规范、架构认知、开发经验等。

#### 三级分层

| 层级 | 路径 | 适用范围 |
|---|---|---|
| **项目级** | `~/.lattice/users/<user>/projects/<id>/spec/` | 仅当前项目 |
| **用户级** | `~/.lattice/users/<user>/spec/` | 跨项目复用 |
| **全局级** | `~/.lattice/spec/` | 多用户多项目通用 |

优先级：项目级 > 用户级 > 全局级。同名冲突时高优先级覆盖低优先级。

#### 基本操作

```bash
# 列出所有 spec
ltc spec list

# 查看某个 spec 的详情（支持模糊匹配）
ltc spec show frontend-conventions

# 检测多层级 spec 冲突
ltc spec conflicts

# 创建新的 spec 文件
ltc spec init coding-style.md
```

#### 使用 Spec 模板

```bash
# 查看可用模板
ltc spec template list

# 应用模板
ltc spec template apply frontend

# 拉取远程模板仓库
ltc spec template pull https://github.com/myorg/spec-templates.git
```

> Spec 模板仓库的组织方式详见 [Spec 模板仓库结构说明](spec-template-registry.md)。

### 任务管理

Lattice 提供完整的任务生命周期管理，支持跨项目追踪。

#### 创建任务

```bash
# 创建任务并关联当前项目
ltc task create "实现用户登录功能" --current

# 创建子任务
ltc task create "登录表单校验" --current --parent <parent-task-id>
```

#### 启动任务

```bash
ltc task start <task-id>
```

#### 记录进展（Checkpoint）

任务进行中，用 checkpoint 记录关键决策、纠错、约束等信息：

```bash
# 记录一个决策
ltc task checkpoint <task-id> --type decision --title "选用 JWT 方案" -m "对比 Session 后选择 JWT，理由是无状态、易扩展"

# 记录用户约束
ltc task checkpoint <task-id> --type constraint --title "不许使用 localStorage" -m "安全要求，token 只能放 httpOnly cookie"

# 记录纠错
ltc task checkpoint <task-id> --type correction --title "修复了 token 过期未刷新" -m "漏写了 refresh 逻辑，已补上"
```

Checkpoint 类型：

| 类型 | 用途 |
|---|---|
| `context` | 用户提供的背景、需求、领域知识 |
| `correction` | 纠错记录 |
| `constraint` | 硬约束 / 红线 |
| `decision` | 技术决策、方案选型 |
| `pivot` | 方向性转折 |
| `milestone` | 阶段性成果 |
| `issue` | 外因踩坑 |
| `note` | 客观事实记录 |
| `assumption` | 隐含推断 |
| `followup` | 待办事项 |
| `summary` | 任务总结 |

#### 查看进展

```bash
# 查看最近进展
ltc task progress <task-id>

# 查看最近 5 条
ltc task progress <task-id> --last 5

# 按类型筛选
ltc task progress <task-id> --type correction
```

#### 完成与归档

```bash
# 标记任务完成
ltc task complete <task-id>

# 归档任务
ltc task archive <task-id>
```

#### 其他常用操作

```bash
# 列出当前进行中的任务
ltc task list --current

# 查看任务详情
ltc task info <task-id>

# 查看任务树（含子任务）
ltc task tree <task-id>

# 为任务关联项目或路径
ltc task associate <task-id> --current
ltc task associate <task-id> --paths ~/my-project/src

# 为任务添加 spec 引用
ltc task ref-spec <task-id> frontend-conventions
```

### 搜索

Lattice 内置本地 RAG 搜索（embedding 向量 + 全文索引），可以搜索 spec、任务、项目、checkpoint 和关联关系。

```bash
# 基本搜索
ltc search "认证方案"

# 限制搜索类型
ltc search "登录" --type task
ltc search "组件规范" --type spec

# 限制在指定项目范围内
ltc search "API 设计" --project <project-id>

# JSON 格式输出（便于程序处理）
ltc search "认证" --json
```

搜索范围默认包含所有用户的数据。如果只需要当前用户的数据：

```bash
ltc search "认证" --users myname
```

### Web 可视化

```bash
# 安装 web 包
npm install -g @qcqx/lattice-web

# 启动可视化服务（默认端口 3000）
ltc web

# 指定端口
ltc web --port 8080

# 不自动打开浏览器
ltc web --no-open
```

Web 界面提供：

- 项目关系图（力导向图）
- 任务 / Spec / 项目浏览
- 跨项目关联可视化

### 健康检查

```bash
# 检查 Lattice 配置健康状况
ltc doctor

# 自动修复检测到的问题
ltc doctor --fix
```

## 下一步

- **技术架构详解**：[architecture.md](architecture.md)
- **目录结构与配置**：[目录结构与配置详解](directory-and-config.md)
- **Agent Command 详解**：[`packages/core/public/templates/skills/agent-commands.md`](../packages/core/public/templates/skills/agent-commands.md)
- **AI 工作流详解**：[`packages/core/public/templates/skills/SKILL.md`](../packages/core/public/templates/skills/SKILL.md)
- **系统级规则**：[`packages/core/public/templates/platforms/lattice-rules.md`](../packages/core/public/templates/platforms/lattice-rules.md)
- **CLI 命令速查**：[`packages/core/public/templates/skills/command-reference.md`](../packages/core/public/templates/skills/command-reference.md)
- **Spec 模板仓库**：[Spec 模板仓库结构说明](spec-template-registry.md)
- **任务工作流**：[`packages/core/public/templates/skills/task-workflows.md`](../packages/core/public/templates/skills/task-workflows.md)
- **Spec 工作流**：[`packages/core/public/templates/skills/spec-workflows.md`](../packages/core/public/templates/skills/spec-workflows.md)
