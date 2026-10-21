# @qcqx/lattice-services

> English | [简体中文](./README.zh-CN.md)

**Lattice application service layer** — the **single use-case implementation** shared by multiple hosts (CLI / web server / VS Code extension / future clients).

Layer contract (see [docs/architecture.md](https://github.com/qxchuckle/lattice/blob/master/docs/architecture.md)):

```
core (domain + storage + platform ports)
   → services (use cases: this package)
   → host bindings (HTTP / postMessage / IPC)
   → clients (web / webview / CLI output)
```

- Hosts only normalize parameters, authenticate, bind transports and map view models.
- All "composition and fallback" (virtual merge, file fallback, cross-user aggregation, pre-write validation) is implemented here, so every host has the same semantics.
- The host owns DB initialization (core's `initDb` / `closeDb`); this layer automatically falls back to the file source of truth when the DB is unavailable.

## Install

```bash
pnpm add @qcqx/lattice-services @qcqx/lattice-core
```

## Usage

```ts
import { initDb } from '@qcqx/lattice-core';
import { currentUsername, listTasks, taskDetail } from '@qcqx/lattice-services';

await initDb(); // host responsibility: bind the database driver (falls back to file source of truth by default)
const username = await currentUsername();

const tasks = await listTasks(username);
const detail = await taskDetail(username, tasks[0].id);
```

## Export domains

| Domain | Representative use cases |
|---|---|
| User | `currentUsername` / `listUsers` |
| Project | `listProjects` / `getProject` / `getProjectDetail` / `getProjectGitStatus` / `findProjectsByPath` / `resolveProjectDirName` |
| Task | `listTasks` / `createTask` / `setTaskStatus` / `taskDetail` / `addTaskCheckpoint` / `associateTask` / `addTaskSpecRefs` |
| Spec | `listSpecs` / `findSpec` / `readSpec` / `detectConflicts` / `detectAllConflicts` / `writeSpecContent` |
| Relation | `listRelations` / `addRelation` / `removeRelation` |
| Search / context | `search` / `getTaskContext` / `getProjectContextBundle` |
| Content / stats | `readContent` / `resolveContentPath` / `getStats`, etc. |

Return values are serializable DTOs (hosts can pass them through to clients) aligned with the types in `@qcqx/lattice-protocol`.

## License

[MIT](https://github.com/qxchuckle/lattice/blob/master/LICENSE) © 2026 qcqx
