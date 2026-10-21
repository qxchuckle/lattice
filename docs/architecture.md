# Lattice Architecture

> English | [简体中文](./architecture.zh-CN.md)

This document is for developers and potential contributors. It explains Lattice's overall technical architecture and key design decisions. If you are a user who wants to get started quickly, read [Quick Start](./quick-start.md) first.

## System positioning

Lattice is a local-first engineering memory and workflow layer. The code in this repository does three things:

- Manages long-lived data under `~/.lattice`: projects, tasks, specs, indexes and templates.
- Exposes those capabilities to developers and AI coding tools through the CLI / IDE / Web.
- Uses injected workflows so AI continuously reads and writes that memory at task start, during implementation and at archive time.

## Architecture overview

Lattice is a monorepo: **one domain core + one cross-host protocol + one application service layer + multiple thin hosts (clients)**.

```
packages/
├── core/      → @qcqx/lattice-core      — domain logic + storage (file source of truth + SQLite index) + platform ports
├── protocol/  → @qcqx/lattice-protocol  — cross-host contracts (DTOs and method types, types-only)
├── services/  → @qcqx/lattice-services  — application service layer (use cases shared by hosts)
├── web-ui/    → @qcqx/lattice-web-ui    — shared UI (React components + client state + LatticeDataAdapter port)
├── cli/       → @qcqx/lattice-cli       — command-line client (commander.js, depends on core)
├── web/       → @qcqx/lattice-web       — web workbench server (Fastify + HTTP binding + static hosting; UI lives in web-ui)
└── vscode/    → qcqx.lattice-context    — VS Code extension (host + webview app; depends on core/services/protocol/web-ui)
```

Four-layer dependency relationship (strictly one-way):

```
Host bindings (HTTP / postMessage / terminal UX)
      │        cli ──→ core (terminal binding)
      │        web/server ──→ services ──→ core (HTTP binding)
      │        vscode (extension host) ──→ services ──→ core (postMessage binding)
      ▼
services (use cases: snapshot/detail/search/context/write operations; single implementation for all hosts)
      ▼
core (domain + storage + ports; zero host dependencies)
      ▲
protocol (DTO/method types; referenced by hosts and clients)
```

**Why this split**:

- `core` is the sole home of domain logic and storage; `services` is the sole implementation of "use-case composition and fallback" (virtual merge, file fallback, cross-user aggregation, pre-write validation).
- `protocol` is the single data-shape contract between hosts and clients — **DTOs reuse core domain types directly; hosts must not invent "lite shapes"** (historical incident: a bridge-specific lite shape crashed the graph).
- Hosts are just bindings: the CLI provides terminal UX, the web server provides HTTP binding, and the VS Code extension provides postMessage binding. A new client (future desktop/mobile/TUI) only needs a thin adapter.
- `core`'s `browser.ts` entry excludes Node.js-specific dependencies (`crypto`, `fs`), so the pure-function subset can be imported directly in the browser.
- Each host can be released independently; they do not need to ship together.

### Data flow

```
User action (terminal / browser / IDE / future client)
        │
        ▼
  Host binding (CLI command / Web HTTP route / VS Code bridge) ──→ services use case
        │                                              │
        │                                              ▼
        │                                       core domain functions
        │                                              │
        │                      ┌───────────────────────┼──────────────────────┐
        │                      ▼                       ▼                      ▼
        │                Filesystem (~/.lattice/)  SQLite (index + cache)  Embedding model
        ▼
  Output (terminal text / JSON / HTTP response / webview data)
```

Lattice's source of truth is the filesystem under `~/.lattice/` (JSON + Markdown). The SQLite database is an index that accelerates queries and can be rebuilt from the filesystem with `ltc rag rebuild`. This "files first, DB as an aid" design keeps data readable, git-manageable and manually recoverable. **When the DB is unavailable (for example in older editor hosts), the services layer falls back to the file source of truth automatically and degrades gracefully.**

## Core domain layer

`packages/core/src/` is divided into the following modules. Dependencies are strictly one-way with no cycles:

```
core/src/
├── types/          — global type definitions (ProjectMeta / TaskMeta / SpecFrontmatter, etc.)
├── paths/          — path utilities (~/.lattice layout + file read/write)
├── config/         — config management (global + local two-layer config)
├── db/             — SQLite database layer (better-sqlite3, WAL mode)
├── project/        — project identity and registration (core module, 10+ subfiles)
├── spec/           — spec management (parse / cascade / conflict detection / lint / migrate)
├── task/           — task lifecycle (create / update / archive / checkpoint)
├── rag/            — RAG search (embedding generation / indexing / semantic retrieval)
├── search/         — context aggregation + hybrid search (FTS + vector RRF fusion)
├── trash/          — soft-delete recycle bin
├── maintenance/    — startup self-check
├── template-assets.ts — template rendering (AI client injection + spec templates)
├── browser.ts      — browser-safe entry (pure-function subset, Vite alias target)
└── index.ts        — unified re-export (the single import entry for CLI / Web)
```

### Project module (project/)

The project module is the most complex subsystem in core. It handles project identity, automatic registration, virtual merge and nested detection:

```
project/
├── identity.ts          — ID model pure functions (zero Node.js dependencies)
├── identity-generate.ts — ID generation (depends on crypto)
├── lookup.ts            — project lookup + virtual merge
├── association.ts       — task association checks
├── register.ts          — registration + automatic registration
├── scan.ts              — scanning + blacklist
├── nested-in.ts         — automatic nested-relation detection
├── merge.ts             — physical merge transaction
├── fingerprint.ts       — git fingerprint collection
├── relation.ts          — project relation CRUD
├── cross-user.ts        — cross-user aggregation
└── index.ts             — re-export + DB sync
```

Dependencies are one-way with no cycles: `identity → lookup → association`, `identity → register → scan`.

**Pure-function design**: functions such as `selectPrimaryId`, `normalizeProjectMeta` and `normalizeLegacyId` in `identity.ts` have zero Node.js dependencies and can be safely exported to the browser through `browser.ts`. The Node.js-specific `identity-generate.ts` (which depends on `crypto`) is split out separately.

### Spec module (spec/)

A spec is Lattice's reusable knowledge unit. The spec module handles parsing, cascading, conflict detection and migration:

| File | Responsibility |
|---|---|
| `io.ts` | Parse / write spec files (frontmatter + body) |
| `cascade.ts` | Three-level cascade aggregation (global → user → project) |
| `conflicts.ts` | Cross-level name-conflict detection |
| `query.ts` | Fuzzy lookup / scope validation |
| `lint.ts` | Frontmatter convention validation |
| `migrate.ts` | Legacy spec migration (`ltc spec migrate`) |
| `id.ts` | Spec ID generation (`spec-` prefix + base36) |
| `validate.ts` | Scope validity validation |

### Task module (task/)

The task module manages the full lifecycle from creation to archive:

| File | Responsibility |
|---|---|
| `index.ts` | Task CRUD + metadata management + DB sync |
| `checkpoint.ts` | Progress tracking (append-only progress.yaml, 11 checkpoint types) |
| `refs.ts` | Task ↔ spec reference management |

Each task is a directory containing four files with non-overlapping responsibilities:

```
~/.lattice/users/<user>/tasks/<task-id>/
├── task.json       — metadata (status / associated projects / spec references)
├── prd.md          — current best-understanding snapshot (goals / plan / file index)
├── progress.yaml   — process log (append-only checkpoints)
└── design.md       — design discussion archive (rejected options and reasons; optional)
```

## CLI layer

`packages/cli/` is built with [commander.js](https://github.com/tj/commander.js) and organizes commands with a "register function" pattern:

```typescript
// cli/src/index.ts — entry
const program = new Command();
registerInitCommand(program);      // ltc init
registerLinkCommand(program);      // ltc link
registerTaskCommand(program);      // ltc task ...
registerSpecCommand(program);      // ltc spec ...
// ... 20 command modules in total
```

Each command module exports a `registerXxxCommand(program: Command)` function, registered centrally at the entry. This keeps commands fully decoupled: adding a command means writing one file and adding one line at the entry.

### Command modules

| Module | Command | Responsibility |
|---|---|---|
| `init.ts` | `ltc init` | Initialization + AI client detection and injection |
| `uninject.ts` | `ltc uninject` | Remove files injected into AI clients |
| `link.ts` | `ltc link` | Manually register a project (creates lattice.json) |
| `unlink.ts` | `ltc unlink` | Unregister a project |
| `scan.ts` | `ltc scan` | Batch-scan git projects |
| `project.ts` | `ltc project ...` | Project management + relation management |
| `task.ts` | `ltc task ...` | Full task lifecycle |
| `spec.ts` | `ltc spec ...` | Spec management + templates |
| `export.ts` | `ltc export` | Export specs / tasks as Agent Skills directories |
| `context.ts` | `ltc context` | Context aggregation (core command) |
| `search.ts` | `ltc search` | RAG search |
| `config.ts` | `ltc config ...` | Config management |
| `status.ts` | `ltc status` / `ltc open` | Current project status / open the Lattice root |
| `doctor.ts` | `ltc doctor` | Health check + automatic repair |
| `sync.ts` | `ltc sync` | Sync spec templates |
| `user.ts` | `ltc user ...` | User management |
| `rag.ts` | `ltc rag ...` | RAG index management |
| `trash.ts` | `ltc trash ...` | Recycle bin management |
| `web.ts` | `ltc web` | Start the web UI |
| `fast-start.ts` | `ltc fast-start ...` | Lightweight-mode logging |

### Global option injection

After registering commands, the CLI entry recursively injects two global options into every leaf command:

- `--force` / `-f`: skip confirmation (required for AI calls to avoid blocking on user input)
- `--debug` / `-d`: print debug information

```typescript
// Recursively add --force / --debug to every leaf command
ensureForceOption(program);
ensureDebugOption(program);
```

### Process lifecycle

```typescript
async function main(): Promise<void> {
  // Ensure the DB closes correctly on process exit (WAL checkpoint, prevents data loss)
  process.on('exit', () => closeDb());

  // Startup self-check (failures do not block the main command)
  await runStartupSelfCheck();

  await program.parseAsync(process.argv);
}
```

## Data model

### Project identity

Project identity is one of Lattice's core designs. Each project has a set of IDs in the form `<prefix>:<content>`:

| Prefix | Source | Priority |
|---|---|---|
| `legacy:` | Random 16-character ID in `lattice.json` | 1 (highest) |
| `git:` | First 16 characters of the git first-commit SHA | 2 |
| `remote:` | First 16 characters of `sha256(normalize(git_remote))` | 3 |

A match on any ID means the same project. Priority is computed dynamically by `selectPrimaryId()` from `ID_PRIORITY_MAP`, not by array order.

**Virtual merge**: when multiple physical project registrations share IDs, the query layer aggregates them into one logical project with zero physical operations. Each keeps its own `project.json` / specs / tasks. This makes "the same project" recognizable across machines, forks and worktrees.

### Three-level spec hierarchy

```
Global   ~/.lattice/spec/                    — shared across users and projects
User     ~/.lattice/users/<user>/spec/       — reused across projects
Project  ~/.lattice/users/<user>/projects/<id>/spec/  — current project only
```

Priority: project > user > global. On a name conflict, the higher priority overrides the lower one; aggregation happens at runtime through `getCascadedSpecs()`.

### Task lifecycle

Tasks have four states, driven by CLI commands:

```
planning → in_progress → completed → archived
              ↑                │
              └─── can revert ─┘
```

The core task data structure `TaskMeta` contains:

- `projects` — associated project ID list (can span projects)
- `scopePaths` — extra paths involved in the task but outside registered projects
- `referencedSpecs` — referenced spec list
- `parentTaskId` — parent task ID (supports subtask trees)

## AI client integration (agent injection)

One of Lattice's core values is letting AI tools obtain project specs, tasks and related memory before writing code. This is implemented by `ltc init`'s AI client detection and injection.

### Three-layer injection model

Lattice injects three kinds of files into AI clients, forming a **Rules + Skill + Commands** three-layer workflow constraint:

```
~/.<client>/
├── rules/lattice.mdc        — always-on rules (alwaysApply, loaded for every conversation)
├── AGENT.md / CLAUDE.md     — native rules entry (some clients)
├── skills/lattice/SKILL.md  — skill entry (progressive loading, expands subdocuments on demand)
└── commands/                — slash commands (/lattice:task:start, etc.)
    ├── task/
    │   ├── start.md
    │   ├── checkpoint.md
    │   └── ...
    ├── context.md
    └── ...
```

| Layer | Loading strategy | Content | File source of truth |
|---|---|---|---|
| **Rules** | alwaysApply (always on) | System-level hard constraints (start contract / implementation loop / archive loop) | `platforms/lattice-rules.md` |
| **Skill** | Progressive (expand on demand) | Workflow overview + subdocument anchors (tasks / specs / projects / search) | `skills/SKILL.md` + subdocuments |
| **Commands** | User-triggered (slash) | Concrete operation flows (task start / task design / keep, etc.) | `commands/*.md` |

**Why three layers instead of one**: Rules guarantee that baseline constraints are never missed (even if the AI forgets to read the Skill); Skill provides complete context loaded on demand (avoiding a huge one-shot token dump); Commands provide standardized operation entry points (one sentence triggers a complete flow). They complement each other:

- Rules are "must obey" — hard constraints, prohibitions, mandatory loops.
- Skill is "should know" — the full workflow, decision criteria, command reference.
- Commands are "how to do it" — concrete steps and output formats.

### Multi-client adaptation

`ltc init` detects locally installed AI clients through `detectAndConfigureAITools()` and injects files according to each client's directory conventions:

| Client | Detection path | Rules landing | Skill landing | Commands landing | Agents landing |
|---|---|---|---|---|---|
| **Cursor** | `~/.cursor/` | `rules/lattice.mdc` | `skills/lattice/SKILL.md` | `commands/` | `agents/` |
| **Claude Code** | `~/.claude/` | `CLAUDE.md` + `rules/lattice.mdc` | `skills/lattice/SKILL.md` | `commands/` | `agents/` |
| **Qoder** | `~/.qoder/` | `AGENT.md` + `rules/lattice.mdc` | `skills/lattice/SKILL.md` | `commands/` | `agents/` |
| **Trae** | `~/.trae/` | `AGENT.md` + `rules/lattice.mdc` | `skills/lattice/SKILL.md` | `commands/` | `agents/` |
| **Agent** | `~/.agents/` | `AGENT.md` + `rules/lattice.mdc` | `skills/lattice/SKILL.md` | `commands/` | `agents/` |
| **Windsurf** | `~/.windsurf/` | `rules/lattice.md` | — | — | — |
| **Kiro** | `~/.kiro/` | `steering/lattice.md` | — | — | — |
| **Codex** | `~/.codex/` | `AGENTS.md` | `skills/lattice/SKILL.md` | Converted into standalone skills | — |

All clients share the same `lattice-rules.md` body. The differences are:

- **Cursor family** (`.mdc` format) prepends frontmatter (`alwaysApply: true`) to the body.
- **Claude Code / Qoder / Trae / Agent** also write native entry files (`CLAUDE.md` / `AGENT.md`) alongside the `.mdc` rules file.
- **Codex** has no native slash-command mechanism, so commands are converted into standalone skills (`deployCommandsAsSkills`).
- **Agent injection** uses incremental copying (overwrite same names + add new files; never delete user-defined agents). Platforms without subagent support are skipped.

### Marker-based updates

Rule injection wraps the body with `LATTICE:BEGIN` / `LATTICE:END` markers for idempotent updates:

```markdown
<!-- LATTICE:BEGIN -->
(Lattice rule body; updates replace only the content between the markers)
<!-- LATTICE:END -->
```

`injectLatticeBlock()` handles four cases:

| File state | Behavior |
|---|---|
| Complete markers present | Replace only the body between markers; preserve user content outside them |
| File missing / empty | Write the full content (including frontmatter) |
| No markers + overwrite mode | Overwrite the whole file with marker-wrapped content |
| No markers + append mode | Append the marker-wrapped block to the existing content |

This ensures that when a user mixes their own rules into the same `CLAUDE.md`, `ltc init` does not overwrite their content.

### Template rendering pipeline

```
packages/core/public/templates/          — template source of truth (shipped with the npm package)
├── languages.json                       — supported languages and default language
├── platforms/<lang>/lattice-rules.md    — rule body shared by all clients (zh authoritative / en translation)
├── skills/<lang>/SKILL.md + subdocs     — skill entry + subdocuments
├── commands/<lang>/*.md                 — slash command templates
├── agents/<lang>/*.md                   — predefined subagent templates
└── spec/<lang>/                         — spec templates (frontend / backend / api, etc.; zh / en each)
```

`template-assets.ts` reads, renders and distributes templates. `ltc init` resolves `zh` or `en` from `--lang` / `config-local.language` / the system locale, then selects the language pack through `getBundledTemplateDir(kind, language)`. Rendering adapts per platform:

```typescript
// All platforms point at the same template file
const platformTemplatePaths: Record<PlatformName, string> = {
  cursorRules: LATTICE_RULES_TEMPLATE,
  claudeCode: LATTICE_RULES_TEMPLATE,
  windsurfRules: LATTICE_RULES_TEMPLATE,
  kiroSteering: LATTICE_RULES_TEMPLATE,
};

// The Cursor family prepends the language-specific frontmatter
export function renderCursorRules(data?: TemplateData, language?: DocLanguage): string {
  const lang = language ?? getDefaultDocLanguage();
  return `${CURSOR_RULES_FRONTMATTER[lang]}${renderPlatformTemplate('cursorRules', data, lang)}`;
}
```

## Workflow design

Lattice is more than a data-management tool. Through AI client injection, it brings engineering memory and a structured workflow into the AI coding process.

### Skill + CLI dual drive

Lattice's workflow is driven by two engines:

1. **Skill-driven (AI side)**: skill documents injected into AI clients define "what the AI should do" — when to fetch context, when to read specs, when to checkpoint, when to update the PRD. This is declarative and relies on the AI following the document.
2. **CLI-driven (tool side)**: `ltc` commands are "the tools the AI actually executes" — create tasks, checkpoint, search specs, aggregate context. This is imperative and relies on the CLI's input/output contract to shape behavior.

Together they form a loop: Skill tells the AI "what to do"; the CLI provides "the tools to do it".

### PRD-driven development

Each task has a PRD file (`prd.md`) that is a "living snapshot of the current best understanding". It is not a requirements document written once and left alone; it is revised as work progresses:

```
Goals → Key constraints → Current plan → File index → Risks → Task completion summary
```

The workflow enforces "the PRD never lags behind the code": when a hard trigger (T1–T8) fires, the PRD must be updated before the code. This ensures that after context compaction, the AI can still recover correct understanding by reading the PRD.

### 11 checkpoint types

Task progress is appended to `progress.yaml`. The 11 types are grouped by information source and are completely orthogonal:

```
User-input type (3)          AI-judgment type (3)      Process-event type (5)
├── context (background)     ├── assumption (inference) ├── decision
├── correction               ├── followup (todo)        ├── pivot
└── constraint               └── note (fact)            ├── milestone
                                                        ├── issue (pitfall)
                                                        └── summary
```

**Design principle**: multiple types are complementary records, not duplicates. A single user input often needs several types at once — for example, when the user overturns a plan, record `pivot` (direction change) + `correction` (fix) + `constraint` (new constraint).

### Design vs implementation mode

Tasks have two modes:

- **Design mode**: read-only + analysis; business code changes are forbidden; discussion goes to `design.md`. It exits when the user explicitly says "start implementing".
- **Implementation mode**: the default after `ltc task start`; code changes are allowed.

This separates "think it through" from "build it", preventing the AI from writing code before the plan is settled.

## RAG search architecture

Lattice includes local RAG (Retrieval-Augmented Generation) search with no remote API dependency.

### Hybrid retrieval

Search combines **FTS (full-text index) + embeddings (semantic vectors)** and fuses rankings with RRF (Reciprocal Rank Fusion):

```
User query
   │
   ├──→ FTS5 full-text search (built into SQLite)
   │       └── keyword matching (title / content / tags / ngram)
   │
   ├──→ Semantic retrieval (bge-small-zh-v1.5 embeddings)
   │       └── cosine similarity ranking
   │
   └──→ RRF fusion
           ├── rank-based base score (1 / (K + rank))
           ├── title boost (exact / partial / keyword hit)
           ├── scope weighting (project > user > global)
           ├── type weighting (relation down-weighted)
           └── multi-dimensional rerank boost (domain / heading / tag / path)
```

**Why hybrid**: FTS excels at exact keyword matches ("lattice init"); semantic retrieval excels at conceptual similarity ("project registration" ≈ "project discovery"). Either alone has blind spots; RRF combines their strengths.

### Incremental indexing

`ltc rag update` is incremental by default — it only processes documents whose content hash changed, rather than rebuilding everything:

```
collectAllSearchDocuments()    — collect all indexable documents (spec / task / project / relation)
    │
    ├── New document → generate embedding + write FTS
    ├── Content changed → update embedding + update FTS
    └── Document removed → delete embedding + delete FTS
```

On failure it falls back to a full rebuild (`ltc rag rebuild`).

### Embedding model

Uses `Xenova/bge-small-zh-v1.5` (512 dimensions) by default with local inference in Node.js through `@huggingface/transformers` — no GPU or remote API required. `ltc init` offers built-in presets (MiniLM, multilingual E5, BGE Base); use `ltc init --model <id>` for non-interactive setup, plus `--dimension` (required when switching to a custom model) and optional `--query-prefix` / `--document-prefix`. Model files are cached under `~/.lattice/models/`; `HF_ENDPOINT` can switch to a regional mirror.

## Web visualization layer

Split into two packages: `packages/web` (server + static hosting) + `packages/web-ui` (shared UI used by both web and the VS Code webview).

```
web/src/                 — Fastify server (HTTP binding) + thin Vite entry (src/main.tsx)
├── server/
│   ├── app.ts           — Fastify app creation (initDb + route registration)
│   ├── index.ts         — server startup / port probing / browser opening
│   ├── routes/          — REST API routes (HTTP binding for @qcqx/lattice-services)
│   └── schemas.ts       — request / response schemas
└── shared/              — shared client/server types

web-ui/src/              — @qcqx/lattice-web-ui (shared UI surface)
├── ui.ts                — sole export (view components / state / theme / adapter types)
├── main.tsx             — browser boot (web host imports `@qcqx/lattice-web-ui/boot`)
├── store.ts             — global state management (valtio)
├── hooks/               — React hooks (data fetching + business logic)
├── adapters/            — data adapter layer (HttpAdapter / type ports)
├── components/          — UI components (graph / detail / sidebar / editor…)
└── styles/              — global styles
```

### Adapter pattern

The client calls the server REST API through `adapters/http.ts` and does not call core functions directly. This abstraction makes it possible to swap in WebSocket or another transport later.

```
React component → hooks → adapters/http → Express API → core functions
```

### Force-directed graph

Project relation visualization uses [Cytoscape.js](https://js.cytoscape.org) with COSE-Bilkent / fcose layouts and supports:

- Node dragging / zooming / click-to-view-details
- Relation-type filters (fork / depends-on / shares-component / nested-in)
- Automatic overlap resolution
- Radial / sequential layout switching

## Multi-host architecture (protocol + services)

> Landed in the 2026-10 refactor: the VS Code extension no longer shells out to `ltc --json` for data. It calls core/services in-process, sharing the same source as the web server.

### Layers and rules

| Layer | Package | Responsibility | Hard rule |
|---|---|---|---|
| Domain + storage | `core` | File source of truth, SQLite index, domain functions, platform ports (`DatabasePort`) | Zero host dependencies (no vscode/fastify/express imports) |
| Contracts | `protocol` | DTOs and method types (types-only) | DTOs reuse core types directly; no "lite shapes" |
| Use cases | `services` | Snapshot/detail/search/context/write operations; composition and fallback | Single implementation; automatic fallback to files when the DB is unavailable |
| Host bindings | `cli` / `web/server` / `vscode` | Transport binding + parameter normalization + view models | Bindings only; no business composition |

### Platform capability ports (host × capability matrix)

| Capability | CLI / web (Node) | VS Code extension (Electron) |
|---|---|---|
| File source-of-truth read/write | ✅ | ✅ |
| Project index / virtual merge | ✅ better-sqlite3 | ✅ node:sqlite (Electron ≥35) / disk-scan fallback |
| FTS full-text search | ✅ | ✅ (node:sqlite includes FTS5) |
| Vector retrieval (sqlite-vec) | ✅ | ❌ skipped in fallback |
| Semantic embeddings | ✅ (model optional) | ❌ not bundled (onnxruntime size) |

### Adding a client (checklist)

1. Data plane: implement `LatticeDataAdapter` (the web client already does this) or call `services` + `protocol` types directly.
2. Transport: HTTP (reuse the web server) / postMessage (reuse the VS Code bridge) / IPC/stdio — pick one; shapes stay the same.
3. Platform capabilities: bind `DatabasePort` (or rely on the host's existing DB) and `setLatticeRootOverride`.
4. UI: prefer `@qcqx/lattice-web-ui` (React components + adapter port + browser boot); a native client only needs the corresponding controls.
5. Tests: wire into the services contract tests (same fixture data root) + your own host smoke test.

## Evolution roadmap (2026-10)

- **P1 (landed)**: `protocol`/`services` became standalone packages; the VS Code extension fully migrated (removed the `ltc` data plane); smoke/integration/unit tests all green.
- **P2 (landed)**: web server routes migrated to services' HTTP binding (projects / tasks / specs / search / stats / trash / users / doctor / content and path resolution; sync-domain data fallback remains in the web layer); **three-way contract tests** landed — `pnpm test:contract` runs services direct calls / web HTTP (fastify inject) / VS Code bridge against the same fixture data root, so shape drift in any binding is caught (including guards for the historical crash: spec rows must carry frontmatter/fileName).
- **P3 (landed 2026-10-18)**: `web-ui` package split — `packages/web/src/client` → `packages/web-ui` (`@qcqx/lattice-web-ui`: sole export `ui.ts` + browser boot `./boot`; web keeps only the entry shell and Vite wiring; the VS Code webview imports the new package); cleanup of `packages/foundation`, `packages/e2e`, `packages/core/dist-types` leftovers; release strategy — the three new packages drop `private` and add `files`, with new `publish:protocol/services/web-ui` scripts; publish order: core → protocol/services → web-ui → web/cli (web depends on services + web-ui and must be published later).
- **P4 (landed 2026-10-18)**: open-source face — root README bilingual restructure (English primary + `README.zh-CN.md`, badges / three-entry matrix / 7-package table), root LICENSE, community health files (CONTRIBUTING / SECURITY / CODE_OF_CONDUCT / issue templates / PR template), READMEs for protocol·services·web-ui, `docs/` index, real product screenshots and social preview assets (`docs/assets/`).
- **P5 (landed 2026-10-18)**: deep VS Code host evolution — multi-user (switch/create/rename + read-only data-plane interception), content search across three views (name fields + FTS union), spec health in Problems, task detail WebviewView, 8-step Walkthrough, QuickPick modifier keys, batch/drag-and-drop, graph Git status; performance — webview code splitting (entry -43%), graph push merging and visibility gating, activation slimming; release — Open VSX and six npm packages live (extension ID later renamed to `qcqx.lattice-context` due to a Marketplace name placeholder).
- **Backlog (as needed)**: optionally move CLI write operations into services; add a standalone build output for `@qcqx/lattice-web-ui` if needed (currently TS source exports consumed by bundlers/tsc); unify core error-message i18n (edge paths).

## Key design decisions

### 1. Files first, DB as an aid

Lattice's source of truth is the filesystem (JSON + Markdown); SQLite is an index that accelerates queries. This means:

- Data is readable — `cat` shows the content directly.
- Git-manageable — `~/.lattice/` can be version-controlled.
- Manually recoverable — even if SQLite is corrupted, `ltc rag rebuild` can rebuild from files.
- DB sync is a constraint — after writing physical files, the DB must be synced (`syncProjectMetaToDb`, not a bare `upsertProject`).

### 2. Virtual merge with zero physical operations

When multiple physical projects share IDs, the query layer aggregates them into one logical project **without merging physical files**. Each keeps its own `project.json` / specs / tasks.

**Why**: `lattice link` can create multiple registrations pointing at the same repository in fork / worktree scenarios. Physical merging risks data loss (how do you choose between conflicting specs?). Virtual merging solves it in the query layer with zero risk.

### 3. Disk fallback scan

When `autoRegisterProject` misses in the DB, it falls back to scanning the disk projects directory and matches IDs from `project.json`. If found, it self-heals the DB.

**Why**: when the disk has a `project.json` but the DB has no record (an inconsistent state), querying only the DB would create a duplicate registration. The disk fallback covers this case.

### 4. Spec cascade inheritance

Nested projects (such as monorepo packages) automatically inherit ancestor project specs. `getCascadedSpecsWithAncestors` includes ancestor specs during aggregation, with lower priority than the current project.

**Why**: a root project convention (such as "all packages use pnpm") should automatically apply to subpackages without each one redeclaring it.

### 5. Global `--force` injection

The CLI entry recursively injects `--force` into every leaf command. AI calls often need to skip confirmation; without uniform injection, an undeclared `--force` would produce an `unknown option` error.

### 6. Close the DB on process exit

The CLI entry registers `process.on('exit', () => closeDb())` to ensure SQLite WAL checkpointing runs before exit. In WAL mode, un-checkpointed data can be lost; this line is the data-safety backstop.

## Further reading

- [Quick Start](./quick-start.md) — install, initialize, basic usage
- [Spec template repository layout](./spec-template-registry.md) — how to organize custom spec templates
- [Skill entry and workflow overview](../packages/core/public/templates/skills/en/SKILL.md) — the full AI workflow documentation
- [Always-on system rules](../packages/core/public/templates/platforms/en/lattice-rules.md) — hard constraints for AI
- [CLI command reference](../packages/core/public/templates/skills/en/command-reference.md) — all command options
- [Project identity and virtual merge](../packages/core/public/templates/skills/en/project-discovery.md) — deep dive into project identification
