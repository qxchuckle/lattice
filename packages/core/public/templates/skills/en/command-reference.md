# CLI command parameter reference

Lookup-style dictionary routing. Route to the matching sub-document by command category; if unsure which command to call → read the workflow docs ([task-workflows.md] / [spec-workflows.md] / [project-context.md] / [project-discovery.md]).

## General conventions

`-f, --force` skips the secondary confirmation. AI calls to the following commands **must** include `-f`/`--force` (otherwise the command hangs at the interactive confirmation):

| Command | Confirmation |
|---|---|
| `ltc init` | Scan directories + select/download the embedding model |
| `ltc init scan` | Scan directories (or `--auto` to skip interaction) |
| `ltc uninject` | Clear injections (delete directories/files, remove marker blocks) |
| `ltc unlink` | Unregister the project |
| `ltc project relation remove <a> <b>` | Delete a project relation |
| `ltc project merge <from> <to>` | Merge projects (irreversible) |
| `ltc user rename <old> <new>` | Rename a user (database + filesystem) |
| `ltc user remove <name>` | Delete a user and all their data |
| `ltc trash purge [id]` / `--all` | Permanently delete trash contents (unrecoverable) |
| `ltc fast-start log clear` | Clear the log |

`ltc project remove <id>` / `ltc task delete <id>` are soft deletes (moved to trash, recoverable with `ltc trash restore`), **no confirmation prompt, no `-f` needed**.

`--json`: accepted by all **leaf** commands, **not by parent commands** (e.g. `ltc sync` / `ltc config`). Passing `--json` to a parent command reports `unknown option` to stderr and exits 1 — workaround: call a subcommand instead (`ltc sync domain list --json` / `ltc config show --json`).

Commands **with** a JSON exit → return JSON; **without** → success still prints human-readable text (stdout, exit code 0), failure enters machine mode (stderr, exit code 1, see the next paragraph). Semantic exception: `config set --json` parses the input value as JSON; it does not control output format (see [cli-system.md#ltc-config]).

**Positional arguments starting with `-`**: free text **containing spaces** (titles, queries, etc.) is already parsed as positional arguments automatically, **no `--` needed** (`ltc search "query starting with --json" --json` works), and options may still follow. `--` is still needed in two cases: **the value exactly equals a registered option** (`ltc search -- "--json"` searches for the literal; without `--` it is swallowed as an option and reports `missing required argument`), and **the value starts with `-` and contains no spaces** (`ltc task create -- "--fix"`). When using `--`, all options must come before it (`ltc search -- "q" --json` reports `too many arguments`). Misspelled options still report `unknown option`; they are not swallowed as positional arguments.

Machine mode (`--json` / `-q`) **failures and empty states**: failure → the message goes to **stderr** + exit code **1**, stdout stays empty (never emits human-readable text); success but empty result → still a valid empty payload (`{cols:[],rows:[]}`, `{total:0,...}`). So `$(ltc ... --json)` and pipes never capture non-data bytes; failures are identified by exit code. In human mode these messages still go to stdout and the exit code is unchanged.

`--json-format`: every command that accepts `--json` also accepts it automatically (except `config set` — its `--json` is input-parsing semantics); changes the **layout** to indented formatting (default single-line compact) without changing fields or shape.

`--json-full`: disables the **trimming layer** — restores omitted null-valued fields, full ISO timestamps, RAG internal scoring/debug meta, detail body (`spec list`'s content), `task list`'s referencedSpecs details, and the `status` of profile check entries; also does not convert to columnar tables. It **does not restore duplicate representations** — the dedup layer is active in both modes (it removes redundant copies mechanically derivable from sibling fields, with zero information loss). Given alone (without `--json`) it is equivalent to `--json --json-full`. Applicable commands: `context` · `search` · `status` · `project list` · `project relation list` · `project profile check` · `task list` · `task progress` · `fast-start log list` · `fast-start log search` · `spec list` · `spec template registry list` · `spec conflicts` · `spec template list` · `spec lint` · `spec suggest-description` · `user list` · `trash list`.

Columnar tables: field names are declared once for the whole payload, each `rows` entry takes values in `cols` order with missing values as `null`; an empty result set is `{cols:[],rows:[]}`. Align values by `cols` index, **do not hardcode column positions** (column order follows field appearance order). `project list --with-relations` is special: relation details appear once for the whole payload in a **top-level `relations` table**; the in-row `relations` column degrades to an array of relation ids. Detail commands (`task info` / `spec show` / `project info` / `project where` / `fast-start log show`) only remove duplicate representations and keep full precision and body, so they have no `--json-full`.

`--page <n>` / `--page-size <n>`: **generic pagination for list commands** (`task list` / `task progress` / `project list` / `project relation list` / `spec list` / `spec template registry list` / `user list` / `trash list` / `fast-start log list` / `fast-start log search`). Not passing them = output everything; passing `--page-size` windows the output; on a columnar table `--json` adds pagination metadata alongside `{cols, rows, page, pageSize, total, totalPages}`. Pagination applies after existing filters (`--last`/`--project`/`--type`, etc.); when `--json-full` and `--page-size` are used together it does not convert to columnar, and the pagination payload is `{entries, page, pageSize, total, totalPages}`. `spec list` is special: by default grouped by scope with each group's `specs` forming its own table; when paginated it flattens into a single spec table (each entry carries a scope column). `search` does not support pagination; its count lever is the `--limit` family.

## Command category routing

General conventions (`--force`/`--json`) apply to all commands. Read the parameter dictionary by category:

| Category | Commands covered | Parameter dictionary |
|---|---|---|
| Context and search | `status` / `context` / `search` | [cli-context-search.md] |
| Project management | `project` (incl. relation / profile) / `link` / `unlink` / `scan` | [cli-project.md] |
| Task lifecycle | `task` (incl. checkpoint / progress / associate / ref-spec) / `fast-start` | [cli-task.md] |
| Spec management | `spec` (incl. list / show / set / lint / migrate) / `spec template` | [cli-spec.md] |
| Knowledge export | `export` | [cli-export.md] |
| Sync and multi-user | `sync` (incl. domain) / `user` | [cli-sync-user.md] |
| Install and system maintenance | `init` / `uninject` / `config` / `doctor` / `rag` / `trash` / `web` | [cli-system.md] |
