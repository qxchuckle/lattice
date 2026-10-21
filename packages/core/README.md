# @qcqx/lattice-core

> English | [简体中文](./README.zh-CN.md)

The domain logic core of Lattice. Path management, configuration, database, projects, tasks, specs, search, RAG and templates are all implemented here. The CLI and other consumers call the exported functions directly.

## Install

```bash
pnpm add @qcqx/lattice-core
```

## Module layout

```
src/
├── browser.ts          → browser-safe entry
├── cache/              → scan cache
├── config/             → global & local config read/write
├── db/                 → SQLite database (project index, FTS, vector search)
├── maintenance/        → startup self-check and data migration
├── paths/              → path calculation and file utilities
├── project/            → project registration, multi-ID model, virtual merge, cross-user discovery, relations
├── rag/                → embedding generation, incremental/full indexing, semantic search
├── search/             → hybrid search (semantic + FTS) and context aggregation
├── spec/               → spec parsing, cascade, conflict detection, validation
├── task/               → task CRUD, checkpoint progress tracking
├── trash/              → soft delete and restore
├── types/              → public type definitions
├── utils/              → utility functions
├── template-assets.ts  → template distribution and sync
└── index.ts            → unified export entry
```

## Core exports

### Paths and files

`getLatticeRoot()` / `getUserDir()` / `getProjectDir()` / `getTaskDir()` and the full path-calculation family, plus file utilities such as `ensureDir` / `readJSON` / `writeJSON`.

### Configuration

`readResolvedConfig()` / `getUsername()` / `isInitialized()` — read the merged global + local config.

### Projects

`registerProject()` / `unregisterProject()` / `findProjectByPath()` / `findProjectByAnyId()` / `scanForProjects()` / `selectPrimaryId()` / `normalizeProjectMeta()` / `getRelatedProjectIds()` / `mergeProjects()` — project registration, multi-ID lookup, batch scanning, virtual merge and physical merge.

### Tasks

`createTask()` / `updateTask()` / `archiveTask()` / `addCheckpoint()` / `listCheckpoints()` — the full task lifecycle.

### Specs

`getCascadedSpecs()` / `detectSpecConflicts()` / `parseSpec()` / `writeSpec()` — three-level cascade, conflict detection and read/write.

### Search and context

`hybridSearch()` / `getSmartContext()` / `formatContextAsMarkdown()` — semantic + full-text hybrid search and context aggregation.

### RAG

`incrementalIndex()` / `rebuildIndex()` / `semanticSearch()` / `getRAGStatus()` — index management and vector search.

### Templates

`applySpecTemplate()` / `syncSpecTemplateRegistry()` / `renderPlatformTemplate()` — template application and platform rule rendering.

## Public assets

The `public/templates/` directory ships with the package and contains:

- `languages.json` — supported languages (`zh` / `en`) and the default language
- `skills/<lang>/` — AI agent workflow docs (SKILL.md, command-reference.md, etc.; `zh` is authoritative, `en` is the translation pack)
- `platforms/<lang>/` — platform rule templates (lattice-rules.md)
- `commands/<lang>/` — Agent Command templates
- `agents/<lang>/` — predefined subagent templates
- `spec/<lang>/` — built-in spec templates (frontend / backend / api / architecture, etc.; one set per language)

## Development

```bash
# Build
pnpm --filter @qcqx/lattice-core build

# Watch mode
pnpm --filter @qcqx/lattice-core dev

# Type check
pnpm --filter @qcqx/lattice-core check-types
```

## License

MIT
