# CLI parameters: context and search

`ltc status` / `ltc context` / `ltc search` parameters. General conventions (`--force`/`--json`) in [command-reference.md#general-conventions].

## `ltc status`

Show Lattice status: by default outputs the current project (bound paths + spec list + active tasks + nested ancestors); `--global` outputs a global overview (project/task counts + DB size + Git switch + scan directories).

- `--global`: global status
- `--json`
- `--json-format`: format JSON output (compact by default)
- `--json-full`: unprojected raw objects (full timestamps, `activeTasks` keeps full `referencedSpecs` details, no columnar); by default `--json`'s `activeTasks`/`ancestors` are columnar tables `{cols,rows}`, referencedSpecs degrades to an id array

## `ltc context`

Output aggregated context for the current project (spec list + active tasks + `--query` semantic associations). Must be called as part of the task-start contract.

- `--task <id>`: get context by task
- `--project <id>`: get by project
- `--query <text>`: semantic query (**AI must include it**, passing the current topic/intent)
- `--current-user`: only the current user
- `--json`
- `--json-format`: indent-formatted JSON (compact by default)
- `--json-full`: disables the trimming layer — each section is a raw object array (`querySearch` restores nested `meta` and RAG internal scoring/debug fields, full timestamps, no columnar); by default `--json` sections are columnar tables and `querySearch` keeps only whitelisted fields, `meta` is flattened into columns, `matchedSections` only headingPath (two-layer model see [command-reference.md#general-conventions]). The `specs` section lists everything in both modes, includes description, excludes content (body via `spec show`)

Nested projects automatically inherit ancestor specs. Cascade: `current > parent > ancestor > user-level > global`.

Each spec in the spec section includes the **id** (markdown `- id: spec-xxxxxxxx` line / `--json`'s `id` field), usable directly with `task ref-spec`.

## `ltc search <query>`

Semantic search across specs / tasks / projects / checkpoints / relations. The main entry point for finding past solutions, similar tasks, and reusable knowledge.

- `--type <type>`: `spec`/`task`/`project`/`checkpoint`/`relation`
- `--project <id>`
- `--users <names>`: comma-separated
- `--current-user`
- `--limit <n>`: number of results per category; **when omitted it is computed dynamically from data volume** (logarithmic scaling, not a fixed value)
- `--spec-limit <n>` / `--task-limit <n>` / `--project-limit <n>`: override the count for a single category (takes precedence over `--limit`)
- `--no-rerank`
- `--json`: AI should prefer including it
- `--json-format`: indent-formatted JSON (compact by default)
- `--json-full`: disables the trimming layer — raw result array, nested `meta` includes RAG internal scoring/debug fields, full precision, no columnar; by default `--json` keeps only whitelisted fields, `meta` is flattened into columns, `matchedSections` only headingPath (two-layer model see [command-reference.md#general-conventions]). **Duplicate-representation removal is active in both modes**: `matchedVia` drops `docType` (derivable from the path segment); with multiple task references only `tasks` is kept (`docTitle`/`docPath`/`taskId` are all derived from it); with a single task, `docTitle`+`docPath` are kept (the full title cannot be mechanically reconstructed from the path slug, so it is relevant information and is not removed); `snippet` identical to `filePath`/`title` is omitted

`spec` results include the **id** (plain output `id: spec-xxxxxxxx` line / `--json`'s `specId` column, `meta.specId` under `--json-full`), usable directly with `task ref-spec` (the dependency index already contains ids: after adding the column you need to run `rag rebuild` once to backfill existing data).
