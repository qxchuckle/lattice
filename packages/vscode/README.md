# Lattice — Cross-project AI Context

Bring [Lattice](https://github.com/qxchuckle/lattice)'s cross-project context into your editor: tasks with their PRD / design / progress, layered specs, RAG-powered search, a knowledge graph, and one-click maintenance of the metadata your AI assistants rely on.

> 中文说明见 [README.zh-cn.md](./README.zh-cn.md)。

## Screenshots

| Workbench (webview) | Task detail |
|---|---|
| ![Workbench](resources/readme/workbench-home.jpg) | ![Task detail](resources/readme/workbench-task.jpg) |
| ![Project graph](resources/readme/workbench-project.jpg) | ![Spec detail](resources/readme/workbench-spec.jpg) |

*The graph workbench webview runs the Lattice web UI in-process — no external server required.*

## Requirements

- VS Code `^1.85.0` (also works in VS Code forks: Cursor, Qoder, VSCodium — via Open VSX).
- A Lattice data home (`~/.lattice`). If you have used the Lattice CLI or web client before, you already have one — the extension needs nothing else.
- **The data plane is in-process.** The extension reads and writes your Lattice home directly (Electron's built-in SQLite with FTS5, plus file sources as fallback). No HTTP, no bundled native binaries, no CLI process per view.
- The `ltc` CLI is **optional** and only used by a few terminal helpers: `ltc init` / `ltc scan` / `ltc link` (workspace onboarding, also offered by the walkthrough) and `ltc web` (the web workbench server). Install with `npm i -g @qcqx/lattice-cli`, or point `lattice.cliPath` at it.

## Features

### Sidebar views

- **Tasks** — status groups with pinned active tasks for the current project; expandable PRD / design / progress (recent checkpoints, full read-only log tab), referenced specs, subtasks, associated projects. Multi-select batch actions (start / complete / archive / copy IDs). Drag & drop: drop a task on a project to associate it, drop a spec on a task to reference it. Status × project quick filter and **keyword search** (matches names and full-text hits) with a visible filter line. "Reveal in Sidebar" from every task, spec, project, search result and detail panel.
- **Specs** — project / user / global scopes, conflict groups, "referenced by" expansion. **New Spec wizard** (blank or template; scope picker; path traversal is rejected). **Spec health check**: lint issues and name conflicts are published to the Problems panel and refreshed on save. Keyword search matches titles, descriptions, tags and spec content.
- **Projects** — pinned current project, relations with descriptions, project-level specs, profile. Keyword search across names, ids and paths.
- **Search** — results persist from the QuickPick; **search history** (focus the empty input to see recent queries, clearable); `#task` / `#spec` / `#project` / `#checkpoint` / `#relation` prefix filters; weak-match hints; inline *Show in Graph* / *Copy ID* buttons.

### QuickPick modifier keys (task / project / spec pickers)

- `Cmd+Enter` (`Ctrl+Enter` on Windows/Linux) — copy the highlighted item's ID
- `Alt+Enter` — open the item in the graph workbench
- `Ctrl+Enter` on macOS (`Ctrl+Shift+Enter` elsewhere) — reveal in the sidebar

### Task workflows (all in-process, native wizards)

Create & start, complete, archive, reopen, delete with a "Restore" toast (recycle bin), **checkpoint wizard (11 types)** plus **long-text checkpoint drafts** (an untitled Markdown document; committing writes it straight into `progress.yaml`), **Summarize Task** (a draft pre-filled with done / pending / next sections and the latest checkpoints), associate the active project / files & folders, reference specs, rename, copy ID, **copy task context as Markdown for AI prompts**, batch operations on multi-selection.

### Graph workbench (`Cmd/Ctrl+Shift+G`)

Webview reusing the Lattice web client's Cytoscape canvas: global / task / project / spec anchors, node & edge filters, force / sequential / radial layouts, minimap, legend, read-only detail panel — **including Git status for projects** (branch, dirty count, ahead/behind, last commit) when the project has a local repository. Theme follows VS Code; `lattice.graph.keepContext` keeps the panel state alive while hidden.

### Editor integrations

- `spec-xxxxxxxx` tokens in Markdown / YAML / text become **clickable links** to the spec document.
- `lattice.json` gets a **CodeLens** with the project identity (or a `ltc link` hint when unregistered).
- Files inside the **active task's scope paths** get a `T` badge; Explorer context menu: *Add to task scope*.
- Spec lint & conflict diagnostics land in the **Problems** panel.

### Multi-user

- The status bar shows the current user; click it to switch, create or rename users.
- **Read-only browsing**: inspect another user's tasks, projects, specs — and even the graph. Every write is blocked at the data plane and by command-level guards.

### Maintenance & onboarding

RAG status / incremental update / rebuild (cancellable, progress in the notification), doctor health check (with fix), recycle bin browser (restore / purge), **Open Web Workbench** (opens the in-editor web workbench — the built-in webview running the same UI as the graph panel; no external server needed), diagnostics copy, and a "Get Started with Lattice" walkthrough with per-view welcome states.

### i18n

The UI follows your editor's display language (English and Simplified Chinese bundles included).

## Commands & Settings

All commands live under the **Lattice** category in the Command Palette (type `Lattice:`). Handy defaults:

| Command | Keybinding |
|---|---|
| Lattice: Search Lattice… | `Cmd/Ctrl+Shift+L` |
| Lattice: Open Graph | `Cmd/Ctrl+Shift+G` |
| Lattice: Manage Users… | status bar user item |
| Task / spec / project / batch actions | context menus on tree items |

Key settings (see *Settings → Lattice* for all):

| Setting | Default | Purpose |
|---|---|---|
| `lattice.latticeHome` | `""` | Override the data directory (= `LATTICE_HOME`) |
| `lattice.autoRefresh` | `true` | Watch `~/.lattice` and refresh views |
| `lattice.tasks.scope` | `all` | Task view scope: all projects / current project |
| `lattice.tasks.showArchived` | `true` | Show the archived group in the task tree |
| `lattice.statusBar.user` / `.project` / `.activeTasks` | `true` | Status bar items |
| `lattice.specDiagnostics.enabled` | `true` | Spec lint / conflicts in the Problems panel |
| `lattice.graph.defaultLayout` | `force` | Default graph layout |
| `lattice.graph.keepContext` | `false` | Keep the graph panel's state while hidden |
| `lattice.editor.specLinks` | `true` | Clickable `spec-*` links |
| `lattice.decorations.enabled` | `true` | Active-task scope file badges |
| `lattice.documents.ragHintOnSave` | `true` | Offer spec migrate + RAG update after saving a spec |
| `lattice.cliPath` | `""` | Path to `ltc` (only for the terminal helpers above) |

## Getting started

1. Make sure you have a Lattice home. The walkthrough (**Lattice: Get Started**) includes a one-click `ltc init` if you don't.
2. Open a repository Lattice knows about (a folder with `lattice.json`, or a Git repo registered via `ltc scan` / auto-registration).
3. Click the **Lattice** icon in the Activity Bar.

## Privacy

- No telemetry. No network requests from the extension or its webviews (the graph webview runs under `connect-src 'none'`).
- Data access is in-process: the extension reads your Lattice home directly and writes through the same core the CLI and web client use. Nothing leaves your machine.

## Development

See the monorepo root. Quick reference:

```bash
pnpm build:vscode     # webview bundle (vite) + extension bundle (tsup)
pnpm package:vscode   # produce dist-vsix/lattice-<version>.vsix
pnpm --filter lattice test             # unit tests (node --test)
pnpm --filter lattice test:integration # @vscode/test-cli (in-process core fixture)
```

Press <kbd>F5</kbd> in VS Code (with this folder open) to launch the Extension Development Host.

## Publishing

Open VSX and the Microsoft Marketplace are both supported; tokens are provided by the maintainer at publish time:

```bash
pnpm --filter lattice run release                                  # build + package + sha256
pnpm dlx ovsx publish dist-vsix/lattice-<version>.vsix -p <TOKEN>  # Open VSX
pnpm exec vsce publish --packagePath dist-vsix/lattice-<version>.vsix -p <PAT>  # Marketplace
```

## License

[MIT](./LICENSE)
