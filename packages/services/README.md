# @qcqx/lattice-services

**Lattice 应用服务层** —— 多宿主（CLI / web server / VS Code 扩展 / 未来客户端）**共享的唯一用例实现**。

分层约定（详见 [docs/architecture.md](../../docs/architecture.md)）：

```
core（领域 + 存储 + 平台端口）
   → services（用例：本包）
   → 宿主绑定（HTTP / postMessage / IPC）
   → 客户端（web / webview / CLI 输出）
```

- 宿主只做：参数归一、鉴权、传输绑定、视图模型映射；
- 一切「组合与降级」（虚拟合并、文件回退、跨用户聚合、写操作前置校验）都在本层实现，保证多端语义一致；
- DB 初始化由宿主负责（core 的 `initDb` / `closeDb`）；本层在 DB 不可用时自动回退文件真源。

## 安装

```bash
pnpm add @qcqx/lattice-services @qcqx/lattice-core
```

## 使用

```ts
import { initDb } from '@qcqx/lattice-core';
import { currentUsername, listTasks, taskDetail } from '@qcqx/lattice-services';

await initDb(); // 宿主职责：绑定数据库驱动（缺省自动回退文件真源）
const username = await currentUsername();

const tasks = await listTasks(username);
const detail = await taskDetail(username, tasks[0].id);
```

## 导出域

| 域 | 代表用例 |
|---|---|
| 用户 | `currentUsername` / `listUsers` |
| 项目 | `listProjects` / `getProject` / `getProjectDetail` / `getProjectGitStatus` / `findProjectsByPath` / `resolveProjectDirName` |
| 任务 | `listTasks` / `createTask` / `setTaskStatus` / `taskDetail` / `addTaskCheckpoint` / `associateTask` / `addTaskSpecRefs` |
| Spec | `listSpecs` / `findSpec` / `readSpec` / `detectConflicts` / `detectAllConflicts` / `writeSpecContent` |
| 关系 | `listRelations` / `addRelation` / `removeRelation` |
| 搜索 / 上下文 | `search` / `getTaskContext` / `getProjectContextBundle` |
| 内容 / 统计 | `readContent` / `resolveContentPath` / `getStats` 等 |

返回值均为可序列化 DTO（宿主可直接透传给客户端），与 `@qcqx/lattice-protocol` 的类型对齐。

## License

[MIT](./LICENSE) © 2026 qcqx
