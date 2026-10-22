# Changelog

All notable changes to the Lattice VS Code extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.6] - 2026-10-22

### Added

- **Project actions on the tasks view header**: the current-project header row now carries the same context menu as a project node in the projects view (open in file manager / current window / new window / terminal, rename, edit description, edit metadata, assign groups, copy id / path, show in graph, reveal in sidebar). The payload (`currentProject`) is understood by every project command; unregistered anchors use a dedicated context value so no project action shows up where it cannot work.
- The tasks view title shows the active project name again (scope = current project); the header row keeps the full identity (name + colour, id and root path on hover).

## [0.4.5] - 2026-10-22

### Added

- **Current project header in the tasks view**: with the task scope set to **current project**, the task list now starts with a header row showing the active project's name in its project color, with `(Not registered)` for unregistered anchors; hover reveals the project id and root path. The view title stays a short scope label (it gets truncated in narrow sidebars).
- **Project switching from the tasks view**: the header row switches the active project on click whenever the workspace holds more than one Lattice project (folder roots, nested `lattice.json` anchors, registered nested paths) — same candidates + **Auto** picker as the projects view. Plain folders without any anchor or registration do not count as projects. The title bar keeps a **Switch Active Project** button for the same picker.

## [0.4.4] - 2026-10-22

### Added

- Current project name in the tasks view title, plus a title-bar **Switch Active Project** button for multi-project workspaces. Superseded by the header row in 0.4.5 (the title is truncated in narrow sidebars).

## [0.4.3] - 2026-10-21

### Added

- **Multi-project workspace context**: the active project is now resolved per project, not per workspace folder. It follows the nearest `lattice.json`, the deepest registered project path, or the nearest Git root under the active file; multi-root workspaces, monorepos and nested Git repositories are supported. Use the status bar or **Switch Active Project** to pin/auto-select a project.
- **Project-level workspace registration**: the Configuration Center lists every root and registered nested project under each workspace folder, with active state, registration, open-folder, metadata and **Set active** actions. The sidebar **Configuration & Maintenance** view gained a **Switch Active Project** entry, and registration now targets the active project root.
- **Configuration Center** (editor-area singleton WebviewPanel): Overview (runtime / DB / watcher / RAG / Git / sync-domain summary), Projects & registration, Editor settings, global/local Lattice config, Users & sync (knowledge-pack domains and `~/.lattice` Git operations), Diagnostics (RAG update/rebuild, Doctor, diagnostics copy, logs, config/data paths), and Advanced (raw JSON view + open file). Open it from the Command Palette, the sidebar **Configuration & Maintenance** view, any view title gear, or the project status menu.
- **Configuration & Maintenance sidebar view**: fixed one-click entries for the Configuration Center overview, scan/register, active-project registration, active-project switching, users & sync, diagnostics, editor settings and Lattice config; title-bar gear / scan / register / native-settings actions.
- **Native project registration**: register the active project from the command palette or the Configuration Center. Git projects register by fingerprint and **do not write `lattice.json` by default**; writing an anchor requires an explicit choice. Non-Git folders require an anchor. Nested project roots can be registered separately.
- **Project scanning UI**: manage scan directories (defaults to all workspace folders), start scans with live progress, cancel, and browse/edit registered project metadata.
- **Staged configuration editing**: schema-driven forms for every `lattice.*` setting (defaults, source scope, reset, user/workspace target), global/local config with RAG model preset linkage, save/discard bar, and draft recovery after closing the panel.
- **Users & sync**: switch/create/rename users; add/edit/reorder/unlink/sync knowledge-pack domains; main data-repo Git status, commit, pull, push, sync and remote management.
- **Pure-Git active project recognition**: registered Git projects without `lattice.json` are resolved as the active project (Git root fallback).
- Hidden terminal escape hatches `lattice.workspace.scanTerminal` / `lattice.workspace.linkTerminal` for users who prefer the CLI.

### Changed

- `lattice.workspace.scan` now opens the Configuration Center Projects section instead of running `ltc init scan` in a terminal.
- `lattice.workspace.link` now runs the native “Register Current Project…” flow instead of `ltc link` in a terminal.
- Status bar, task/spec views, task creation, spec creation, project commands, task scope and Spec migration all consume the same project-level context; RAG / Doctor / users / sync remain global.
- README, walkthrough, welcome view, package nls and l10n updated for multi-project workspaces and the Configuration Center.
- Configuration Center layout polish: form controls such as model pickers and dropdowns now fill their field column, nested RAG values load from `config.json` instead of showing blank fields, and repeated per-card hint banners were removed in favor of concise inline notes.
- Wide tables in Projects, Users & Sync and the data-repo Git section now scroll horizontally at narrow panel widths instead of collapsing columns into one-character lines.

### Fixed

- Lattice core-config forms now show **effective** embedding values (built-in defaults, global config and local overrides) instead of blank model / dimension fields when `config.json` only contains `version`. Reset controls only appear for values that are actually persisted or edited, and reverting an edit no longer leaves a misleading “Modified” marker.
- The Advanced JSON tab’s “Open current file” action follows the selected global/local tab; resetting a default field no longer creates a spurious unsaved change.
- The old `lattice.pinnedFolder` state remains honored as a folder-level pin, while the new project pin takes precedence and can be cleared with **Auto (follow active editor)**.

## [0.4.2] - 2026-10-19

### Changed

- **Colored project icons**: every project node now gets a stable color from the theme chart palette (blue / green / orange / purple / red / yellow, hashed from the project id — the same project keeps the same color across sessions and across views). Applies to the Projects view (flat and grouped), the "related projects" rows in the Tasks view and the project groups in the Specs view, so project rows are easy to tell apart at a glance. Colors follow the active theme (light / dark); the "unknown project" group keeps its neutral icon.

## [0.4.1] - 2026-10-19

### Added

- **New Spec wizard — project scope for any project**: the scope picker now always offers **Project** and, when picked, opens a **searchable project picker** (type to filter by name / package / path; the active project is pinned on top and marked as current). Creating a project-level spec no longer requires an active project.
- **New Spec from the specs tree**: right-click a project group (project-level section), the **User** section, the **Global** section — or the Project section root (which then asks for the target project) — and choose **New Spec…** to create the spec directly in that scope.

### Changed

- The specs tree scope section nodes (Project / User / Global) now carry dedicated context values (`specScopeProject` / `specScopeUser` / `specScopeGlobal`) so the context menu can target them.

## [0.4.0] - 2026-10-19

### Added

- **Project grouping (multi-level)**: projects can belong to nested groups (`工作/前端/组件库`) stored in a registry (`~/.lattice/users/<user>/project-groups.json`). The projects view title gets a **Grouping** button to switch between **flat** (default) and the **group tree**: group nodes show their project count, hold sub-groups first and their own projects after them, and an **Ungrouped** node collects projects without a group; empty sub-trees are pruned. The mode persists per workspace.
- Group nodes carry their own actions: **New Group…** (sub-groups included), **Rename Group…**, **Move Group…**, **Remove Group…** (removes the whole sub-tree and detaches the references from every project, with an impact confirmation showing the project / sub-group counts) and **Copy Group Path**. Project nodes get **Add to Groups…** — a multi-select of the group tree plus an "add new path" entry where missing paths (and ancestors) are created automatically. The project metadata wizard edits groups with the same multi-select.
- The project **group filter** is now **sub-tree aware**: selecting `工作` matches every project under `工作/**`.

### Changed

- Groups moved from the flat `groups: string[]` on projects to registry nodes referenced as `groupIds`; `ltc doctor --migrate` converts legacy data and removes the old key (idempotent, no runtime fallback). CLI gained `ltc project group list|create|rename|move|remove` plus `ltc project update --groups/--add-groups/--remove-groups` (path based, missing paths auto-created).

## [0.3.1] - 2026-10-19

### Changed

- Project tree nodes now show the **project description** as the grey subtitle whenever the project has one (previously the package name was always shown first, which duplicated the title for package-named projects like `@qcqx/lattice-monorepo`). When there is no description the previous fallbacks still apply (package name → relative path). The project rows of the view-search live preview follow the same rule.

## [0.3.0] - 2026-10-19

### Added

- **Task grouping by time**: the task view title now has a **Grouping** button (also `lattice.tasks.groupBy` in the Command Palette) to switch between **Status** (default), **By Creation Time** and **By Last Updated** — the two time modes then let you pick the time levels **year / month / day** in any combination (year → month → day, month → day, flat by day, …). Absolute date labels (`2026-10-19`), newest first, the latest path expands by default, and tasks without the grouping date fall into an **Unknown Time** group. The pinned **Active Tasks** group is kept and uses the same hierarchy inside. The choice persists per workspace.

## [0.2.5] - 2026-10-19

### Fixed

- Explicit-action messages now appear every time: the "Filter Projects" no-data hint (and the "no local path" / "no associated projects or paths" warnings) were suppressed by the 30-second notification de-duplication when clicked again, which looked like the button stopped working. Event-driven notifications keep their de-duplication.

## [0.2.4] - 2026-10-19

### Changed

- "Filter Projects" no longer dead-ends when no project defines groups or tags: the message now explains the situation and offers an **Edit Project Metadata** button (the wizard edits groups and tags). Project tooltips also show groups / tags when present, so the filter dimensions are discoverable.

## [0.2.3] - 2026-10-19

### Fixed

- The sidebar **Detail** view now scrolls when its content is taller than the view. The shared webview stylesheet clipped overflow (`overflow: hidden` on `html/body/#root`, meant for the graph workbench which scrolls internally); detail mode now gets its own document-level scrolling styles.

## [0.2.2] - 2026-10-19

### Fixed

- Spec nodes no longer show "Open in Graph" twice — the generic and spec-specific graph menu entries both matched `viewItem == spec`.

## [0.2.1] - 2026-10-19

### Fixed

- Task search now shows its active state and the clear (✕) button in the view title — the `hasSearch` context key for the tasks view was never set, so the button and the filled icon never appeared.
- Project-level spec sub-groups now offer the full project menu: reveal in file manager, open in current / new window, open in terminal, add relation, rename, edit description, edit metadata, edit in config, copy id / path, open in graph and reveal in sidebar.
- "Unreference Spec" now appears when right-clicking a spec reference under a task (the menu condition referenced a context value that no node produced).
- Spec metadata editing is now also available for spec references in the task tree, and "Reveal in Sidebar" for spec conflicts.

## [0.2.0] - 2026-10-19

### Added

- **Live search preview** — searching the tasks / specs / projects trees now opens a QuickPick with real-time results: name matches render instantly, full-text hits merge in after a short debounce. The first row applies the keyword to the sidebar (Enter); picking a result applies the query and reveals the node; submitting an empty query clears the search.
- **View clear buttons** — view-title buttons clear the active search (`$(close)`) or filter (`$(clear-all)`) per view (tasks / specs / projects / search results), complementing the existing filter/search icons.
- **Specs / projects / search filters** — specs by layer × project, projects by group × tag, search results by type × project. All persisted per workspace, with programmatic parameters for automation.
- **Specs sub-grouping** — project-level specs are grouped under their project (with counts); unresolvable specs fall into an "Unknown Project" group. Locating still works under search / filters.
- **Project menu completion** — reveal in file manager (now actually reveals), open in current window / new window / terminal, rename, edit description, edit in config (`project.json`). Multi-path projects ask which path to use; the metadata wizard also edits groups.
- **Task relationship edits** — unassociate project, remove one scope path, clear all scope paths (with confirmation), and change / clear the parent task.
- **Spec metadata quick edit** — edit title / description / tags without opening the file (body untouched; YAML parse failures are refused).
- **Task scope persistence** — the "all projects / current project" toggle is remembered per workspace (it no longer writes to your global settings.json); the Search view restores its last query and results.

### Changed

- Task filter state moved into the shared view-filter store; existing state migrates automatically on first run.
- View message lines are composed from a single source (error > filter > search), so clearing one dimension no longer wipes the others.
- The Specs and Projects views gained the same "no project registered" welcome state as Tasks.

### Fixed

- `lattice.project.openFolder` is now labelled "Open in New Window" and opens a new window as expected (the previous title said "Reveal Folder in OS").
- Task-scope toggling now refreshes the view description immediately.

## [0.1.1] - 2026-10-18

### Added

- **Quick Start (no CLI)** — bootstrap a minimal data home in-process: data root, first user and a project scan of your workspace. `ltc init` remains available for the full setup (AI clients, git, templates).
- **Per-view search** — keyword filtering for the tasks / specs / projects trees (name fields plus full-text hits from the in-process index), with view-title icons and a visible search line.
- **Detail view** — a sidebar panel following your selection (task / spec / project), defaulting to the active task.
- **Walkthrough refresh** — 8 steps covering task workflows, the graph workbench, search and multi-user.
- **Spec quick fix** — a code action that references the `spec-xxxxxxxx` under the cursor to the active task, from any file.
- **Task ergonomics** — starting a task now makes it the active task; "Clear Active Task" appears in the Command Palette while one is active.
- **Initialization-aware welcomes** — empty views point at Quick Start / project registration instead of CLI installation.

### Changed

- **Performance** — webview code splitting (initial bundle ~43% smaller), coalesced graph-panel updates gated by visibility, slimmer activation events.
- **Cleanup** — removed dead CLI-era settings (`lattice.cliPath`, `lattice.cliTimeoutMs`), unreachable error branches and stale copy; Workspace Trust wording now reflects in-process data access.

### Fixed

- Per-view search icons now toggle to the "active" state correctly.
- The Search view no longer claims "data home not ready" before the initialization state settles.

### Notes

- Republished under the extension id `qcqx.lattice-context` — the short `lattice` name was unavailable on the VS Marketplace.

## [0.1.0] - 2026-10-18

### Added

- **Sidebar views** — Tasks (status groups, pinned active tasks, PRD / design / progress with a read-only full log tab, referenced specs, subtasks, associated projects), Specs (scope groups, conflicts, referenced-by), Projects (relations, profile), Search (persisted results).
- **Task workflows** — create & start, complete, archive, reopen, delete with recycle-bin restore, checkpoint wizard (11 types), **long-text checkpoint drafts** (untitled Markdown → `progress.yaml`), **Summarize Task** drafts (done / pending / next + recent checkpoints), associate project / paths, reference specs, rename, copy ID, copy context as Markdown for AI prompts.
- **Batch & drag and drop** — multi-select batch start / complete / archive / copy IDs; drop a task on a project to associate it, drop a spec on a task to reference it.
- **Spec workflows** — **New Spec wizard** (blank or template; project / user / global scope; path traversal rejected), **spec lint & name conflicts in the Problems panel** with save-time refresh, conflict groups in the tree.
- **Search** — debounced in-process search with `#type` prefixes, weak-match hints, inline *Show in Graph* / *Copy ID* actions, and **search history** (recent queries on empty input, clearable).
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
