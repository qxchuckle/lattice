# CLI parameters: task lifecycle

`ltc task` / `ltc fast-start` parameters. General conventions (`--force`/`--json`) in [command-reference.md#general-conventions]; task workflows in [task-workflows.md], fast-start workflows in [fast-start-workflows.md].

## `ltc task`

Manage cross-project tasks.

### `ltc task list`

List tasks (filtered by status / project / user).

- `--status <status>`: `planning`/`in_progress`/`completed`/`archived`/`all`
- `--project <id>` / `--current`
- `--all-user` / `--user <users>` (mutually exclusive; must be combined with `--project`/`--current`)
- `--json`
- `--json-format`: indent-formatted JSON (compact by default)
- `--json-full`: output a raw task object array (full `referencedSpecs` details relativePath/scope/projectId/firstReadAt, full timestamps); default `--json` is a columnar table (see [command-reference.md#general-conventions]), referencedSpecs degrades to an array of spec ids and timestamps to dates

### `ltc task create <title>`

Create a task.

- `-p, --project <ids...>` / `--current` / `--parent <id>` / `-q, --quiet` (output only the task ID, for chaining like `ID=$(ltc task create ... -q) && ltc task start "$ID"`)
- `--current`: write-class command — when the user provides a path/semantic description you must first locate it with `ltc project where`/`ltc project list --search`, and use `--project <id>` once located

### `ltc task info <id>`

View task details (metadata + associations + referenced specs).

- `--lineage` / `--tree` / `--descendants` (human-view switches) / `--json`
- `--json` always loads the graph views but **drops the fully duplicated copy** (part of the duplicate-representation layer, same in both modes, so this command has no `--json-full`): when `descendants` and `tree` are structurally identical only one is output, and `lineage` is omitted when it contains only the task itself (no parent task). Detail command: keeps full timestamps and the full `prd`

### `ltc task update <id>`

Update task metadata (title / status / project associations / parent task).

- `--title` / `--status` / `-p, --project <ids...>` / `--add-project` / `--remove-project` / `--clear-projects` / `--add-current-project` / `--parent <id>` / `--clear-parent`

### `ltc task tree <id>` / `ltc task lineage <id>`

`tree` views the task tree (subtasks) / `lineage` views the parent chain. `--descendants` / `--json`

### `ltc task start <id>` / `complete <id>` / `archive <id>` / `reopen <id>`

State transitions: `start` sets in_progress / `complete` sets completed / `archive` archives / `reopen` reopens and sets in_progress.

### `ltc task delete <id>`

Delete a task (moved to trash, recoverable). `-f, --force`. Refuses to delete when subtasks exist.

### `ltc task checkpoint <id>`

Add a task checkpoint record (append-only process log; for type semantics see [task-workflows.md#checkpoint-types]).

- `--type <type>`: required. `context`/`correction`/`constraint`/`assumption`/`followup`/`note`/`decision`/`pivot`/`milestone`/`issue`/`summary`
- `--title <title>`: required
- `-m, --message <message>`
- `--json`

### `ltc task progress <id>`

View task progress records (checkpoint history).

- `--last <n>` / `--type <type>` / `--id <checkpointId>` (single-entry detail, no pagination) / `--page <n>` + `--page-size <n>` / `--json` / `--json-format`
- `--json-full`: raw object array (full timestamps); default `--json` is a columnar table with checkpoint times reduced to dates (ordering is still preserved by row order)

### `ltc task associate <id>`

Maintain a task's project / path associations (writes structured metadata to task.json; the single machine-readable source).

- `-p, --project <ids...>` / `--current` / `--paths <paths...>` / `--note <note>`
- `--remove-path <path>` / `--remove-project <id>` / `--clear-paths` / `--json`

### `ltc task ref-spec <task-id> <spec...>` / `unref-spec <task-id> <spec-id...>`

Associate / disassociate specs referenced by a task.

- `ref-spec`'s `<spec...>` **recommended to pass spec IDs** (`spec-xxxxxxxx`, globally unique): resolving by ID covers global + user + project-level specs of **all registered projects**, so you can associate project-level specs of any project across projects; it also supports file name / fuzzy title / glob (these three are limited to the cwd project + user + global).
- When a project-level spec is hit, `referencedSpecs` records its owning `projectId`, for cross-project reverse lookup of physical paths (search enrichment).
- `unref-spec` takes spec IDs.

## `ltc fast-start`

fast-start lightweight mode log (process records when not going through the full task lifecycle).

### `ltc fast-start log add <title>`

Add a fast-start log entry.

- `-m, --message` (required) / `--files <files...>` / `--cwd <dir>` / `--project <id>` / `--json`

### `ltc fast-start log list`

List fast-start logs. `--last <n>` / `--page <n>` + `--page-size <n>` (pagination see [command-reference.md#general-conventions]) / `--project <id>` / `--current` / `--json` (columnar table, `message`/`files` kept in full) / `--json-format` / `--json-full` (raw object array, full timestamps)

### `ltc fast-start log search <query>`

Keyword search over fast-start logs (title / content / files / directories). `--last <n>` / `--page <n>` + `--page-size <n>` / `--project <id>` / `--current` / `--json` (columnar table) / `--json-format` / `--json-full`

### `ltc fast-start log show <id>` / `stats`

`show` views a single log / `stats` views log statistics. `--json`

### `ltc fast-start log clear`

Clear all fast-start logs. `-f, --force`
