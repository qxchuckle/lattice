# Lattice — 研发记忆与工作流

把 [Lattice](https://github.com/qxchuckle/lattice) 的研发记忆带进编辑器：规范、任务（PRD / 设计档案 / 进展）、决策、RAG 检索、知识图谱，以及一条龙维护 AI 助手所依赖的元数据。

> English docs: [README.md](./README.md)

## 环境要求

- VS Code `^1.85.0`（同样适用于 VS Code 衍生编辑器：Cursor、Qoder、VSCodium，走 Open VSX）。
- 一个 Lattice 数据根（`~/.lattice`）。若你用过 Lattice CLI 或 Web 客户端，则已具备，无需其他准备。
- **数据面完全进程内**：扩展直接读写你的 Lattice 数据根（Electron 内置 SQLite + FTS5，降级时走文件真源）。无 HTTP、不打包任何原生二进制、每个视图不再起 CLI 子进程。
- `ltc` CLI **仅是可选项**，只服务于少量终端助手：`ltc init` / `ltc scan` / `ltc link`（工作区引导，walkthrough 内提供一键入口）与 `ltc web`（Web 工作台的服务端）。安装：`npm i -g @qcqx/lattice-cli`。

## 功能

### 侧边栏视图

- **任务** — 按状态分组、当前项目活动任务置顶；可展开 PRD / 设计档案 / 进展（最近 Checkpoint + 完整记录只读页）、引用规范、子任务、关联项目。多选批量操作（开始 / 完成 / 归档 / 复制 ID）；可解除项目关联、移除 / 清空范围路径（需确认）、变更父任务。拖拽联动：任务拖到项目上即关联，规范拖到任务上即引用。**实时预览搜索**（输入即出结果：本地即时命中 + 防抖并入全文检索）、状态 × 项目快速过滤（过滤行常显）；搜索 / 过滤生效时标题栏出现一键清除按钮，状态随窗口重载保持。**分组方式**：标题栏可在状态与时间（**按创建 / 按更新时间**，**年 / 月 / 日任意层级组合**）之间切换。任何任务 / 规范 / 项目 / 搜索结果 / 详情面板均可「在侧栏定位」。
- **规范** — 项目级（按项目二级分组）/ 用户级 / 全局分组、冲突组、"被哪些任务引用"展开。**新建 Spec 向导**（空白或模板；作用域：用户级 / **项目级——可搜索选择目标项目，无需活动项目** / 全局级；拒绝路径穿越；规范树里可右键项目分组、用户级 / 全局级分区或项目级分区根直接新建）、**编辑规范元数据**向导（标题 / 描述 / 标签）。**Spec 体检**：规范问题与同名冲突发布到 Problems 面板，保存 spec 时自动刷新。搜索覆盖标题 / 描述 / 标签与正文，支持层级 × 项目过滤。
- **项目** — 当前项目置顶、带描述的关系、项目级规范、项目画像。**多层级分组**：标题栏「分组」按钮在平铺与分组树之间切换（`工作/前端/组件库`，节点显示项目数，无分组的项目归入「未分组」）；分组节点支持新建子分组 / 重命名 / 移动 / 移除（整棵子树 + 影响面确认）/ 复制路径，项目节点支持「添加到分组…」（多选树 + 新路径自动创建）；分组随工作区持久保持。菜单支持文件管理器显示 / 当前窗口 / 新窗口 / 终端打开、重命名、编辑描述、编辑元数据（含分组与标签）；支持分组 × 标签过滤（分组为**子树匹配**，tooltip 展示分组 / 标签）。
- **详情视图** — 跟随选中项（任务 / 规范 / 项目，默认活动任务）的侧边栏面板：标题、状态、关联项目、文档、检查点与引用规范，无需打开图谱。
- **搜索** — 实时预览 QuickPick（输入即出结果，回车应用到视图、点结果应用并定位）；结果沉淀为视图（查询与最多 100 条结果随窗口重载恢复）；**搜索历史**（聚焦空输入即见最近查询，可清除）；`#task` / `#spec` / `#project` / `#checkpoint` / `#relation` 前缀限定；弱匹配提示；行内「在图谱中查看 / 复制 ID」按钮；类型 × 项目过滤与标题栏一键清除。

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

1. 确保已有 Lattice 数据根。walkthrough（**Lattice: 入门**）内置一键 `ltc init`。
2. 打开一个 Lattice 已知的仓库（含 `lattice.json` 的目录，或经 `ltc scan` / 自动注册的 Git 仓库）。
3. 点击活动栏的 **Lattice** 图标。

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
