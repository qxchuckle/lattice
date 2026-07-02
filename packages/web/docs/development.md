# 开发指南

## 环境要求

- Node.js >= 20.19（Vite 8 要求）
- pnpm（workspace 管理）
- 已构建 `@qcqx/lattice-core`（`pnpm --filter @qcqx/lattice-core run build`）

## 快速启动

在仓库根目录执行：

```bash
# 1. 安装依赖（首次或依赖变化时）
pnpm install

# 2. 确保 core 已构建
pnpm --filter @qcqx/lattice-core run build

# 3. 启动开发服务
pnpm dev:web
```

`pnpm dev:web` 会同时启动两个进程：

| 进程 | 端口 | 说明 |
|---|---|---|
| Vite Dev Server | 5173 | 前端 HMR 热重载，提供 React SPA |
| Fastify API Server | 3000 | 后端 API，直接调用 `@qcqx/lattice-core` |

浏览器访问 `http://localhost:5173`。Vite 会自动将 `/api` 请求代理到 `:3000`。

## 单独启动

如果只需前端或后端：

```bash
pnpm --filter @qcqx/lattice-web run dev:client   # 仅前端 :5173
pnpm --filter @qcqx/lattice-web run dev:server   # 仅后端 :3000
```

## 生产模式启动

```bash
# 构建前端 + 后端
pnpm build:web

# 通过 CLI 启动（含 initDb + 重复检测）
node packages/cli/dist/index.js web
```

生产模式下 Fastify 同时提供 API 和静态资源（`dist/client/`），只需一个端口。

## 类型检查

```bash
pnpm --filter @qcqx/lattice-web run check-types
```

## 项目结构

```
packages/web/
├── src/
│   ├── server/              # 后端
│   │   ├── index.ts         # startServer：端口检测 + PID 文件 + 重复启动检测
│   │   ├── app.ts            # createServer：Fastify 实例 + 插件 + SPA fallback
│   │   ├── routes.ts         # API 路由（直接调 core 函数）
│   │   └── schemas.ts        # TypeBox schema 定义
│   ├── client/              # 前端
│   │   ├── main.tsx          # 入口（BrowserRouter + QueryClient + ErrorBoundary）
│   │   ├── App.tsx           # 根组件（三栏布局 + RouteSync + 路由定义）
│   │   ├── store.ts          # Valtio 状态 + getViewPath 路由辅助
│   │   ├── hooks.ts          # 5 视角 hooks + 搜索 + 详情 + 统计
│   │   ├── theme.ts          # antd 主题 + CSS 变量
│   │   ├── lib.ts            # dagre 布局 + 配色 + 格式化
│   │   ├── adapters/         # 数据 adapter 层（HttpAdapter / 未来 WebviewAdapter）
│   │   ├── components/       # 自定义节点 + 详情面板 + 表格 + 错误边界
│   │   ├── types/graph.ts    # React Flow 类型
│   │   └── styles/global.less
│   └── shared/types.ts       # server/client 共享类型
├── vite.config.ts            # 前端构建 + dev proxy
├── tsup.config.ts            # 后端构建
└── tsconfig.json             # 双路径映射 @/* + @qcqx/lattice-core/*
```

## 路由

| 路径 | 视角 | 说明 |
|---|---|---|
| `/` | 全局 | 全局关系图 |
| `/task/:taskId` | 任务 | 以任务为锚点展开 |
| `/project/:projectId` | 项目 | 以项目为锚点展开 |
| `/spec` | Spec | 所有 spec 概览 |
| `/spec/:specId` | Spec | 单个 spec 详情 |
| `/checkpoint/:taskId` | Checkpoint | 任务的 checkpoint 时间线 |
| `?mode=table` | — | 切换表格/画布显示 |

URL 变化由 `RouteSync` 组件监听并同步到 Valtio store，组件自动重渲染。

## 开发注意事项

### core 函数签名

- `getUsername()` 返回 `Promise<string>`，在 routes.ts 中必须 `await`
- `hybridSearch(query, opts)` 不含 username 参数
- `listProjects()` 返回 `ProjectRow[]`（`local_path` 是 JSON 字符串，需 `JSON.parse`）

### CLI tsup external

`packages/cli/tsup.config.ts` 中必须配置 `external: ['@qcqx/lattice-web']`，否则 tsup 会将 web 包代码内联到 CLI dist 中，导致使用旧版本代码。

### @xyflow/react v12

- 没有 `EdgeStyle` 导出，边样式用 `CSSProperties`
- 节点 `data` 需要自定义类型标注

### antd v6

- `Skeleton` 不支持 `size` 属性
- `GitBranchOutlined` 已移除，用 `BranchesOutlined` 替代

### 构建顺序

修改 core 后需要先 `pnpm --filter @qcqx/lattice-core run build`，再构建 web。
修改 CLI 后需要 `pnpm --filter @qcqx/lattice-cli run build`，CLI 的 `external` 配置确保运行时动态加载 web 包 dist。

## 常见问题

### Q: 开发时 API 返回 500 "数据库未初始化"

`initDb()` 在 CLI 的 `web` 命令中调用。开发模式下直接 `tsx watch src/server/index.ts` 启动不会调用 `initDb()`。解决方式：

```bash
# 方式一：通过 CLI 启动（推荐）
node packages/cli/dist/index.js web --no-open

# 方式二：在代码中手动调用
# 在 src/server/index.ts 的 startServer 开头添加 await initDb()
```

### Q: 前端页面 404

检查 `dist/client/` 目录是否存在。`app.ts` 通过 `existsSync(clientDir)` 判断是否注册静态资源。生产模式需先 `vite build` 生成 `dist/client/`。

### Q: 端口被占用

无 `--port` 时默认 3000，被占用则自动递增到 3001、3002。指定 `--port` 时不递增，冲突直接报错。
