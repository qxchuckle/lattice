# @qcqx/lattice-web

> English | [简体中文](./README.zh-CN.md)

Lattice Web Workbench — a task / project / spec relation graph and knowledge graph browser (Cytoscape canvas, sharing the same UI as the VS Code extension webview).

![Lattice Web Workbench](https://raw.githubusercontent.com/qxchuckle/lattice/master/docs/assets/screenshots/workbench-home.jpg)

## Features

- **Four views**: global relation graph, task expansion, project expansion, spec overview
- **Interactive canvas**: Cytoscape automatic layout, click a node to open details, highlighted edges
- **Live search**: hybrid retrieval (BM25 + semantic), instant sidebar filtering
- **Table mode**: project/task table lists with sorting and pagination
- **Light/dark theme**: follow the system or switch manually
- **Route-driven**: the URL reflects the current view and anchor; browser back/forward works

## Install

```bash
# Global install
npm i -g @qcqx/lattice-web
```

## Usage

```bash
# Start through the lattice CLI
ltc web
# Specify a port; default 14527
ltc web --port 8080
# Do not open a browser automatically
ltc web --no-open
```

After startup, open `http://localhost:14527`. Re-running detects an existing service and prompts.

## Routes

| Path | Description |
|---|---|
| `/` | Global relation graph |
| `/task` | Task view (all) |
| `/task/:taskId` | Task view (specific) |
| `/project` | Project view (all) |
| `/project/:projectId` | Project view (specific) |
| `/spec` | Spec overview |
| `/spec/:specId` | Spec details |
| `?mode=table` | Switch to table display |

## Tech stack

React 19 · Vite 8 · antd v6 · Cytoscape · Valtio · TanStack Query · Fastify 5 · TypeBox

## Development

See [docs/development.md](https://github.com/qxchuckle/lattice/blob/master/packages/web/docs/development.md).

```bash
# Development mode (Vite :5173 + Fastify :14527)
pnpm dev:web

# Build
pnpm build:web
```

## Architecture

```
Browser → Fastify API → @qcqx/lattice-core → ~/.lattice/
          ↑
  Vite SPA (Cytoscape + antd)
```

The frontend gets data through an adapter interface (`HttpAdapter` → fetch → Fastify API → core), leaving room for a future VS Code `WebviewAdapter`.

## License

MIT
