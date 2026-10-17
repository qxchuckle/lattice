# Changelog

All notable changes to the Lattice VS Code extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-18

### Added

- **Sidebar views** — Tasks (status groups, pinned active tasks, PRD / design / progress with a read-only full log tab, referenced specs, subtasks, associated projects), Specs (scope groups, conflicts, referenced-by), Projects (relations, profile), Search (persisted results).
- **Task workflows** — create & start, complete, archive, reopen, delete with recycle-bin restore, checkpoint wizard (11 types), **long-text checkpoint drafts** (untitled Markdown → `progress.yaml`), **Summarize Task** drafts (done / pending / next + recent checkpoints), associate project / paths, reference specs, rename, copy ID, copy context as Markdown for AI prompts.
- **Batch & drag and drop** — multi-select batch start / complete / archive / copy IDs; drop a task on a project to associate it, drop a spec on a task to reference it.
- **Spec workflows** — **New Spec wizard** (blank or template; project / user / global scope; path traversal rejected), **spec lint & name conflicts in the Problems panel** with save-time refresh, conflict groups in the tree.
- **Search** — debounced in-process search with `#type` prefixes, weak-match hints, inline *Show in Graph* / *Copy ID* actions, and **search history** (recent queries on empty input, clearable).
- **Per-view search** — keyword filtering for the tasks / specs / projects trees (name fields plus full-text hits from the in-process index), with view-title icons and a visible search line.
- **Graph workbench** — Cytoscape canvas reusing the web client UI: global / task / project / spec anchors, node & edge filters, force / sequential / radial layouts, minimap, legend, read-only detail panel with **Git status for projects**, theme sync, view state persistence, `lattice.graph.keepContext`.
- **QuickPick modifier keys** — from any task / project / spec picker: copy ID, open in graph, reveal in sidebar (`Cmd/Ctrl+Enter`, `Alt+Enter`, `Ctrl+Enter` / `Ctrl+Shift+Enter`).
- **Multi-user** — status bar user item; switch, create and rename users; **read-only browsing** of other users' data with write protection at the data plane.
- **Editor integrations** — clickable `spec-*` document links, `lattice.json` CodeLens, active-task scope file decorations, "Add to task scope" on the Explorer, spec diagnostics.
- **Editor UX** — reveal in sidebar everywhere, status bar project / tasks / user items, task tree quick filter (status × project) with a visible filter line, iconized view titles and menus.
- **Maintenance** — RAG status / incremental update / rebuild (cancellable), doctor with fix, recycle-bin browser, web workbench (opens the in-editor webview UI — no external server required), diagnostics copy.
- **Onboarding** — "Get Started with Lattice" walkthrough, per-view welcome states, bilingual UI (English + Simplified Chinese, follows the editor language).
- **Data plane** — in-process core shared with the CLI and web client (Electron's built-in SQLite + FTS5; better-sqlite3 / file-source fallbacks): no CLI process per view, no HTTP, no bundled native binaries.
- **Packaging** — dual-channel release script (Open VSX + Microsoft Marketplace) with version/CHANGELOG consistency check and sha256.

### Fixed

- Specs could be listed twice (and break the Specs tree with "element already registered") when several project aliases resolved to the same physical directory: project virtualization now dedupes by the merged ID group, the spec collector dedupes by file path, and the tree adds a unique-ID guard.

### Notes

- The `ltc` CLI is optional: it only powers terminal helpers (`ltc init` / `scan` / `link`).
- Semantic / vector search degrades gracefully when the host lacks the SQLite extension; FTS search is always available.
- The `ltc web` server remains available for browser-based access; the extension's own "Open Web Workbench" command runs the webview in-process.
