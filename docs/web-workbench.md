# Web Workbench

> English | [简体中文](./web-workbench.zh-CN.md)

The web workbench is a browser UI over the same `~/.lattice` data as the CLI. It reads local files directly and never requires an account.

## Start the workbench

```bash
# Start the workbench (default port 14527)
ltc web
# Use a custom port
ltc web --port 8080
# Do not open a browser automatically
ltc web --no-open
```

The workbench serves `http://localhost:14527` by default. Routes are URL-driven, so browser back and forward work and any view can be linked directly.

## Four views

| View | Question it answers |
|---|---|
| **Global** | How do projects, tasks and specs connect? |
| **Task** | What is the goal, PRD, design and progress of this task? |
| **Project** | What does this repository know and what is active? |
| **Spec** | What rule applies here, and which tasks depend on it? |

Press `1`–`4` to switch views. Clicking a node opens the detail panel without losing your place on the canvas.

## Canvas and layouts

The canvas is a graph, not a dashboard. Edges show the current relation, and the minimap keeps orientation on large graphs. Three layouts cover different reading tasks:

- **Force** — clustered overview of the whole graph.
- **Sequential** — layered flow for reading dependency order.
- **Radial** — one focus node with its neighborhood around it.

## Search and filters

| Shortcut | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Focus the sidebar search |
| `⌘P` / `Ctrl+P` | Open global search |
| `⌘F` / `Ctrl+F` | Toggle canvas search |
| `Esc` | Close search or the detail panel |

The sidebar filters by node type, task status and spec scope. Keyword search stays local and still works when semantic retrieval is unavailable.

## Detail panels

- **Task** — PRD, design, progress and checkpoints in one place.
- **Spec** — scope, frontmatter, body and the tasks that reference it.
- **Project** — Git state, registered paths and project relations.

## Theme and layout

Light and dark themes can follow the system or be set manually. On narrow screens the desktop sidebars become drawers, while the canvas keeps the same interactions.

## Routes

| Path | View |
|---|---|
| `/` | Global relation graph |
| `/task/:taskId` | Task view |
| `/project/:projectId` | Project view |
| `/spec/:specId` | Spec view |

Deep links open the same detail panel as clicking a node.

## Public demo

The [live demo](https://lattice.qcqx.cn/demo/) runs the real workbench UI with mocked data. It is a static build: no login, no backend and no network requests. Refreshing resets all writes.

## Next

- [Quick start](./quick-start.md) — install and initialize locally.
- [Core concepts](./concepts.md) — the data model behind the views.
