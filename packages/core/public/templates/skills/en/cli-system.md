# CLI parameters: install and system maintenance

`ltc init` / `ltc uninject` / `ltc open` / `ltc config` / `ltc doctor` / `ltc rag` / `ltc trash` / `ltc web` parameters. General conventions (`--force`/`--json`) in [command-reference.md#general-conventions]; command troubleshooting in [troubleshooting.md].

## `ltc init`

Initialize Lattice (`~/.lattice/`).

- `-f, --force`: skip confirmation
- `--username <name>`: specify the username
- `--git [boolean]`: enable Git management (on by default)
- `--git-remote <url>`: Git remote
- `--scan-dirs <dirs>`: scan directories (comma-separated)
- `--registry-template <urls>`: pull template repos
- `--lang <lang>`: language of injected docs (`auto` | `zh` | `en`; defaults to `language` from `config-local.json`, then the system locale)

### `ltc init scan`

Scan local git projects and register them with Lattice (writes the scan cache; has interactive configuration).

- `--dirs <dirs>`: scan directories (comma-separated); if omitted, uses the `scanDirs` config
- `--auto`: use `scanDirs` from config, skip interaction

## `ltc uninject`

Clear the documentation side effects that `ltc init` injected into external AI clients (**does not touch `~/.lattice` data**). By default it runs a full sweep first, prints the deletion list, and executes after confirmation.

- `-f, --force`: skip confirmation and clear directly (mandatory for AI calls)
- `--tool <ids>`: clear only the specified platforms (comma-separated, e.g. `qoder,cursor`)
- `--dry-run`: only report what would be cleared, do not execute

Cleanup rules: `skills/lattice`, `commands/lattice`, Codex `skills/lattice-*` are deleted as whole directories; `agents/lattice-*.md` are deleted per the bundled list (user-custom agents are kept); rules files (`lattice.mdc` / `CLAUDE.md` / `AGENT.md` / `AGENTS.md`) have the `<!-- LATTICE:BEGIN/END -->` marker block removed — if the file is empty after removal it is deleted, otherwise user content is kept. The full sweep is the single source of truth; `init-meta.json` is only a hint, and cleanup correctness does not depend on it.

## `ltc open`

Open the Lattice root directory (file manager). `-t, --terminal`: open in the terminal instead of the file manager.

## `ltc config`

View and modify global config.

`show [--json] [--scope] [--diff-defaults]` (show full config) / `get <key> [--json] [--scope]` (read a single entry, dot path) / `set <key> <value> [--json] [--scope]` (set a single entry, dot path) / `unset <key> [--scope]` (remove a single entry, dot path)

`set`'s `--json` is **input semantics** (an exception to the global "call with --json" rule):

| Call | value parsing |
|---|---|
| `set <key> <value>` | JSON-like values (`{...}` / `[...]` / double-quoted strings) are parsed automatically; everything else is stored as a string as-is |
| `set <key> <value> --json` | force the entire value to be parsed as JSON; a parse failure is an error (a plain string like `alice` always errors) |

Scalar JSON (`123` / `true` / `null`) requires `--json` to be written by type; objects / arrays don't need it.

## `ltc doctor`

Detect and fix Lattice configuration health issues.

- `--fix` / `--migrate` / `--rebuild-fingerprints` / `--recheck-scope-paths` / `--json`

## `ltc rag`

Manage the RAG index: `status [--json]` shows index status / `update` incremental update (only changed documents) / `rebuild` rebuilds the full embedding index.

## `ltc trash`

Trash management (view, restore, purge deleted content): `list [--type] [--json] [--json-full] [--page-size <n>]` lists contents (`--json` is a columnar table; full timestamps via `--json-full`) / `restore <id>` restores deleted content / `purge [id] [-f] [--all]` permanently deletes (unrecoverable).

## `ltc web`

Start the Lattice web UI service. `-p, --port <port>` (default 3000) / `--no-open`
