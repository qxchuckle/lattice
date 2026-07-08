# @qcqx/lattice-web

Lattice 可视化前端 — 基于 React Flow 的任务/项目/Spec 关系图浏览器。

## 功能

- **四种视角**：全局关系图、任务展开、项目展开、Spec 概览
- **交互画布**：Cytoscape 自动布局，节点点击打开详情，连线高亮
- **实时搜索**：混合检索（BM25 + 语义），侧栏即时筛选
- **表格模式**：项目/任务表格列表，支持排序分页
- **明暗主题**：跟随系统或手动切换
- **路由驱动**：URL 反映当前视角和锚点，支持浏览器前进/后退

## 安装

```bash
# 全局安装（可选）
npm i -g @qcqx/lattice-web

# 或在 lattice monorepo 中直接使用
pnpm install
```

## 使用

```bash
# 通过 lattice CLI 启动
lattice web

# 指定端口
lattice web --port 8080

# 不自动打开浏览器
lattice web --no-open
```

启动后访问 `http://localhost:3000`。重复启动会检测已有服务并提示。

## 路由

| 路径 | 说明 |
|---|---|
| `/` | 全局关系图 |
| `/task` | 任务视角（全部） |
| `/task/:taskId` | 任务视角（指定） |
| `/project` | 项目视角（全部） |
| `/project/:projectId` | 项目视角（指定） |
| `/spec` | Spec 概览 |
| `/spec/:specId` | Spec 详情 |
| `?mode=table` | 切换表格显示 |

## 技术栈

React 19 · Vite 8 · antd v6 · Cytoscape · Valtio · TanStack Query · Fastify 5 · TypeBox

## 开发

详见 [docs/development.md](docs/development.md)。

```bash
# 开发模式（Vite :5173 + Fastify :3000）
pnpm dev:web

# 构建
pnpm build:web
```

## 架构

```
浏览器 → Fastify API → @qcqx/lattice-core → ~/.lattice/
         ↑
  Vite SPA (Cytoscape + antd)
```

前端通过 adapter 接口获取数据（`HttpAdapter` → fetch → Fastify API → core），为未来 VSCode 插件（`WebviewAdapter`）预留。

## License

MIT
