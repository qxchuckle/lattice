# Lattice — 研发记忆与工作流

把 [Lattice](https://github.com/qxchuckle/lattice) 的研发记忆带进编辑器：规范、任务（PRD / 设计档案 / 进展）、决策、RAG 检索、知识图谱，以及一条龙维护 AI 助手所依赖的元数据。

> English docs: [README.md](./README.md)

## 界面预览

| 工作台（Webview） | 任务详情 |
|---|---|
| ![工作台](resources/readme/workbench-home.jpg) | ![任务详情](resources/readme/workbench-task.jpg) |
| ![项目图谱](resources/readme/workbench-project.jpg) | ![Spec 详情](resources/readme/workbench-spec.jpg) |

*图谱工作台 Webview 进程内运行 Lattice Web UI，无需外部服务。*

## 环境要求

- VS Code `^1.85.0`（同样适用于 VS Code 衍生编辑器：Cursor、Qoder、VSCodium，走 Open VSX）。
- 一个 Lattice 数据根（`~/.lattice`）。若你用过 Lattice CLI 或 Web 客户端，则已具备，无需其他准备。
- **数据面完全进程内**：扩展直接读写你的 Lattice 数据根（Electron 内置 SQLite + FTS5，降级时走文件真源）。无 HTTP、不打包任何原生二进制、每个视图不再起 CLI 子进程。
- `ltc` CLI **仅是可选项**：完整初始化（`ltc init`：AI 客户端注入、git、模板）仍在终端执行；项目扫描、当前项目注册、配置编辑、用户、同步域、Git 操作与维护均已收进编辑器内的 **Lattice 配置中心**。仅在需要完整 CLI 初始化时安装：`npm i -g @qcqx/lattice-cli`。

## 功能

### 侧边栏视图

- **活动项目** — 按当前文件解析最近的项目根：支持多根工作区、monorepo / 嵌套 Git 仓库 / 嵌套 `lattice.json`。状态栏点击或命令面板「切换活动项目」可 pin 项目；任务、规范、任务创建、项目命令与配置中心共享同一上下文。
- **任务** — 按状态分组、当前项目活动任务置顶；可展开 PRD / 设计档案 / 进展（最近 Checkpoint + 完整记录只读页）、引用规范、子任务、关联项目。多选批量操作（开始 / 完成 / 归档 / 复制 ID）；可解除项目关联、移除 / 清空范围路径（需确认）、变更父任务。拖拽联动：任务拖到项目上即关联，规范拖到任务上即引用。**实时预览搜索**（输入即出结果：本地即时命中 + 防抖并入全文检索）、状态 × 项目快速过滤（过滤行常显）；搜索 / 过滤生效时标题栏出现一键清除按钮，状态随窗口重载保持。**分组方式**：标题栏可在状态与时间（**按创建 / 按更新时间**，**年 / 月 / 日任意层级组合**）之间切换。范围为**当前项目**时，标题行显示活动项目名，任务列表首行是**当前项目条目**（项目名 + 项目彩标，悬停看 id 与根路径）；该行右键菜单与项目面板的项目节点一致（文件管理器 / 新窗口 / 终端打开、重命名、编辑描述与元数据、添加到分组、复制 ID / 路径、定位）；工作区内存在多个 Lattice 项目时点击该行即可切换活动项目。任何任务 / 规范 / 项目 / 搜索结果 / 详情面板均可「在侧栏定位」。
- **规范** — 项目级（按项目二级分组）/ 用户级 / 全局分组、冲突组、"被哪些任务引用"展开。**新建 Spec 向导**（空白或模板；作用域：用户级 / **项目级——可搜索选择目标项目，无需活动项目** / 全局级；拒绝路径穿越；规范树里可右键项目分组、用户级 / 全局级分区或项目级分区根直接新建）、**编辑规范元数据**向导（标题 / 描述 / 标签）。**Spec 体检**：规范问题与同名冲突发布到 Problems 面板，保存 spec 时自动刷新。搜索覆盖标题 / 描述 / 标签与正文，支持层级 × 项目过滤。
- **项目** — 当前项目置顶、带描述的关系、项目级规范、项目画像。**多层级分组**：标题栏「分组」按钮在平铺与分组树之间切换（`工作/前端/组件库`，节点显示项目数，无分组的项目归入「未分组」）；分组节点支持新建子分组 / 重命名 / 移动 / 移除（整棵子树 + 影响面确认）/ 复制路径，项目节点支持「添加到分组…」（多选树 + 新路径自动创建）；分组随工作区持久保持。菜单支持文件管理器显示 / 当前窗口 / 新窗口 / 终端打开、重命名、编辑描述、编辑元数据（含分组与标签）；支持分组 × 标签过滤（分组为**子树匹配**，tooltip 展示分组 / 标签）。
- **详情视图** — 跟随选中项（任务 / 规范 / 项目，默认活动任务）的侧边栏面板：标题、状态、关联项目、文档、检查点与引用规范，无需打开图谱。
- **搜索** — 实时预览 QuickPick（输入即出结果，回车应用到视图、点结果应用并定位）；结果沉淀为视图（查询与最多 100 条结果随窗口重载恢复）；**搜索历史**（聚焦空输入即见最近查询，可清除）；`#task` / `#spec` / `#project` / `#checkpoint` / `#relation` 前缀限定；弱匹配提示；行内「在图谱中查看 / 复制 ID」按钮；类型 × 项目过滤与标题栏一键清除。
- **配置与维护** — Lattice 侧栏的固定入口：一键打开配置中心概览、扫描/注册项目、注册当前项目、切换活动项目、用户与同步、诊断、编辑器设置或 Lattice 配置；视图标题栏同时提供齿轮 / 扫描 / 注册 / 原生设置快捷按钮。

### 选择器修饰键（任务 / 项目 / 规范）

- `Cmd+Enter`（Windows/Linux 为 `Ctrl+Enter`）— 复制高亮项 ID
- `Alt+Enter` — 在图谱工作台打开该项
- macOS `Ctrl+Enter`（其他平台 `Ctrl+Shift+Enter`）— 在侧栏定位

### 任务全流程（原生向导，全部进程内）

新建并开始、完成、归档、重新打开、删除（垃圾桶 + 通知可恢复）、**Checkpoint 向导（11 类）**与**长文本 Checkpoint 草稿**（untitled Markdown 起草，提交即写入 `progress.yaml`）、**任务总结**（预填 完成项 / 遗留 / 下一步 三段 + 最近检查点）、关联当前项目 / 文件与目录、引用规范、重命名、复制 ID、**复制任务上下文（Markdown，供 AI 提示词）**、多选批量操作。

### 图谱工作台（`Cmd/Ctrl+Shift+G`）

Webview 复用 web 客户端的 Cytoscape 画布：全局 / 任务 / 项目 / 规范锚点，节点与边筛选，force / 顺序 / 径向布局，小地图、图例、只读详情面板 —— **项目详情含 Git 状态**（分支、脏文件数、领先/落后、最近提交，项目有本地仓库时显示）。主题跟随 VS Code；`lattice.graph.keepContext` 开启后隐藏面板保留前端状态。

### 编辑器集成

- Markdown / YAML / 文本中的 `spec-xxxxxxxx` 变为**可点击链接**；
- `lattice.json` 顶部 **CodeLens** 显示项目身份（未注册时提示 `ltc link`）；
- 活动任务范围路径内的文件显示 **`T` 徽标**；资源管理器右键「添加到任务范围路径」；
- Spec 规范问题与冲突进入 **Problems** 面板。

### 多用户

- 状态栏显示当前用户；点击可切换 / 新建 / 重命名用户。
- **只读浏览**：查看其他用户的任务、项目、规范乃至图谱；所有写入在数据面与命令层双重拦截。

### 配置中心

打开 **Lattice: 打开配置中心**（编辑器区 WebviewPanel，单例；也可从各视图标题栏齿轮或项目状态栏菜单进入），不离开编辑器即可管理整套安装：

- **概览** — 数据根、用户、版本、项目 / 任务 / 规范 / 关系计数、数据库与 watcher 健康、RAG 状态、Git 状态与同步域摘要。
- **项目与注册** — 当前工作区 / 多根工作区 / monorepo 项目候选（`lattice.json` 注册、Git 指纹注册、未注册、嵌套）；每个 folder 下展示根项目与已注册嵌套项目，可注册、设为当前、打开目录或编辑元数据。注册默认 **不写** `lattice.json`（仅用 Git 指纹），扫描目录默认包含当前工作区，支持进度 / 取消和可搜索项目表。
- **编辑器设置** — 全部 `lattice.*` 设置分组展示，含默认值、来源 scope、重置与「打开原生设置」。
- **Lattice 配置** — 全局 `config.json` 与本机 `config-local.json`：RAG 模型预设、维度、前缀、下载选项、模板、扫描目录、语言、主数据仓 Git remote；模型变更会提示重建索引。
- **用户与同步** — 切换 / 新建 / 重命名用户；同步域添加、编辑、排序、解除与同步；主数据仓 Git 状态 + 提交 / 拉取 / 推送 / 同步与 remote 管理。
- **诊断** — 完整 RAG 详情、增量更新 / 重建、doctor 体检（可修复）、快照错误、诊断复制、日志、数据目录与配置文件。
- **高级** — 原始 JSON 查看（表单保存保留未知键）与配置文件快捷入口。

所有写入都经扩展宿主与 core/services；Webview 零网络访问（`connect-src 'none'`）。数据根、模型、用户、同步域移除等高风险变更需确认；不提供项目 / 用户删除，也不在扩展内编辑 Web 面板密码。

### 维护与引导

RAG 状态 / 增量更新 / 重建（可取消、带进度）、doctor 体检（可修复）、垃圾桶浏览（恢复 / 彻底删除）、**打开 Web 工作台**（在编辑器内嵌 webview 中打开完整 Web UI，与图谱同源，无需外部服务）、诊断信息复制、"Lattice 入门" walkthrough 与各视图欢迎页。

### i18n

界面跟随编辑器显示语言（内置英文与简体中文）。

## 命令与设置

全部命令在命令面板的 **Lattice** 分类下（输入 `Lattice:`）。常用：

| 命令 | 快捷键 |
|---|---|
| Lattice: 搜索 Lattice… | `Cmd/Ctrl+Shift+L` |
| Lattice: 打开图谱 | `Cmd/Ctrl+Shift+G` |
| Lattice: 打开配置中心 | 侧栏「配置与维护」/ 视图标题栏齿轮 / 项目状态栏菜单 |
| Lattice: 注册当前项目 | 命令面板 / 欢迎页 |
| Lattice: 用户管理… | 状态栏用户项 |
| 任务 / 规范 / 项目 / 批量操作 | 树节点右键菜单 |

关键设置（完整列表见 *设置 → Lattice*）：

| 设置 | 默认 | 用途 |
|---|---|---|
| `lattice.latticeHome` | `""` | 覆盖数据目录（等价 `LATTICE_HOME`） |
| `lattice.autoRefresh` | `true` | 监听 `~/.lattice` 并自动刷新视图 |
| `lattice.tasks.scope` | `all` | 任务视图范围：全部项目 / 当前项目 |
| `lattice.tasks.showArchived` | `true` | 任务树显示已归档分组 |
| `lattice.statusBar.user` / `.project` / `.activeTasks` | `true` | 状态栏各项开关 |
| `lattice.specDiagnostics.enabled` | `true` | Spec 规范问题 / 冲突进 Problems |
| `lattice.graph.defaultLayout` | `force` | 图谱默认布局 |
| `lattice.graph.keepContext` | `false` | 隐藏时保留图谱面板状态 |
| `lattice.editor.specLinks` | `true` | `spec-*` 可点击链接 |
| `lattice.decorations.enabled` | `true` | 活动任务范围文件徽标 |
| `lattice.documents.ragHintOnSave` | `true` | 保存 spec 后提示 migrate + RAG 更新 |

## 快速开始

1. 确保已有 Lattice 数据根。walkthrough（**Lattice: 入门**）内置一键 `ltc init`，也可用 **Lattice: 快速开始** 进程内完成最小初始化。
2. 打开仓库并运行 **Lattice: 注册当前项目…**（或打开 **Lattice: 配置中心** → 项目与注册）。Git 仓库按指纹注册、默认不写文件；非 Git 目录需显式创建 `lattice.json` 锚点。
3. 点击活动栏的 **Lattice** 图标。随时可通过标题栏齿轮或项目状态栏菜单打开配置中心。

## 隐私

- 无遥测。扩展与其 webview 均不发网络请求（图谱 webview 运行在 `connect-src 'none'` 下）。
- 数据访问完全进程内：扩展直接读取你的 Lattice 数据根，并经与 CLI / Web 客户端同一套 core 写入。数据不出本机。

## 开发

见 monorepo 根目录。速查：

```bash
pnpm build:vscode     # webview 打包（vite）+ 扩展打包（tsup）
pnpm package:vscode   # 产出 dist-vsix/lattice-<version>.vsix
pnpm --filter lattice test             # 单测（node --test）
pnpm --filter lattice test:integration # @vscode/test-cli（进程内 core fixture）
```

在本目录用 VS Code 打开并按 <kbd>F5</kbd> 启动扩展开发宿主。

## 发布

双渠道（Open VSX + 微软 Marketplace），token 由维护者发布时提供：

```bash
pnpm --filter lattice run release                                  # 构建 + 打包 + sha256
pnpm dlx ovsx publish dist-vsix/lattice-<version>.vsix -p <TOKEN>  # Open VSX
pnpm exec vsce publish --packagePath dist-vsix/lattice-<version>.vsix -p <PAT>  # Marketplace
```

## License

[MIT](./LICENSE)
