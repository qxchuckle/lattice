# @qcqx/lattice-core

Lattice 的领域逻辑核心库。所有路径管理、配置、数据库、项目、任务、Spec、搜索、RAG 和模板能力均由本包实现，CLI 和其他消费方直接调用导出函数即可。

## 安装

```bash
pnpm add @qcqx/lattice-core
```

## 模块结构

```
src/
├── browser.ts          → 浏览器打开工具
├── cache/              → 扫描缓存
├── config/             → 全局 & 本地配置读写
├── db/                 → SQLite 数据库（项目索引、FTS、向量搜索）
├── maintenance/        → 启动自检与数据迁移
├── paths/              → 路径计算与文件工具
├── project/            → 项目注册、多 ID 模型、虚拟合并、跨用户发现、关系管理
├── rag/                → 嵌入生成、增量/全量索引、语义搜索
├── search/             → 混合搜索（语义 + FTS）与上下文聚合
├── spec/               → Spec 解析、级联、冲突检测、校验
├── task/               → 任务 CRUD、checkpoint 进展追踪
├── trash/              → 软删除与恢复
├── types/              → 公共类型定义
├── utils/              → 工具函数
├── template-assets.ts  → 模板分发与同步
└── index.ts            → 统一导出入口
```

## 核心导出

### 路径与文件

`getLatticeRoot()` / `getUserDir()` / `getProjectDir()` / `getTaskDir()` 等全套路径计算函数，以及 `ensureDir` / `readJSON` / `writeJSON` 等文件工具。

### 配置

`readResolvedConfig()` / `getUsername()` / `isInitialized()` — 读取合并后的全局 + 本地配置。

### 项目

`registerProject()` / `unregisterProject()` / `findProjectByPath()` / `findProjectByAnyId()` / `scanForProjects()` / `selectPrimaryId()` / `normalizeProjectMeta()` / `getRelatedProjectIds()` / `mergeProjects()` — 项目注册、多 ID 查找、批量扫描、虚拟合并与物理合并。

### 任务

`createTask()` / `updateTask()` / `archiveTask()` / `addCheckpoint()` / `listCheckpoints()` — 完整任务生命周期。

### Spec

`getCascadedSpecs()` / `detectSpecConflicts()` / `parseSpec()` / `writeSpec()` — 三级级联、冲突检测和读写。

### 搜索与上下文

`hybridSearch()` / `getSmartContext()` / `formatContextAsMarkdown()` — 语义 + 全文混合搜索和上下文聚合。

### RAG

`incrementalIndex()` / `rebuildIndex()` / `semanticSearch()` / `getRAGStatus()` — 索引管理和向量搜索。

### 模板

`applySpecTemplate()` / `syncSpecTemplateRegistry()` / `renderPlatformTemplate()` — 模板应用与平台规则渲染。

## 公共资源

`public/templates/` 目录随包分发，包含：

- `skills/` — AI Agent 工作流文档（SKILL.md、command-reference.md 等）
- `platforms/` — 平台规则模板（lattice-rules.md）
- `commands/` — Agent Command 模板
- `spec/` — 内置 spec 模板（frontend / backend / api / architecture 等）

## 开发

```bash
# 构建
pnpm --filter @qcqx/lattice-core build

# watch 模式
pnpm --filter @qcqx/lattice-core dev

# 类型检查
pnpm --filter @qcqx/lattice-core check-types
```

## License

MIT
