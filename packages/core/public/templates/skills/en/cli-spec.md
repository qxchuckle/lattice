# CLI parameters: spec management

`ltc spec` / `ltc spec template` parameters. General conventions (`--force`/`--json`) in [command-reference.md#general-conventions]; spec read/write/capture workflows in [spec-workflows.md].

## `ltc spec`

Manage spec files.

### `ltc spec list`

List spec files (by scope / tag).

- `--scope <scope>`: `project`/`user`/`global`
- `--tag <tag>` / `--page <n>` + `--page-size <n>` / `--json`
- `--json-format`: indent-formatted JSON (compact by default)
- `--json-full`: output raw grouped objects (including each spec's full `content`); by default `--json` strips content (body via `spec show`), keeps title/filePath/id/description/tags, each group's `specs` is a columnar table (see [command-reference.md#general-conventions]), and when paginated it flattens across scopes into a single table

### `ltc spec show <file>`

View the full text of a single spec.

- `<file>` **recommended to pass the spec ID** (globally unique): exact lookup across global + user + **all registered projects**, **not limited by cwd** (including specs of other registered projects not open in the workspace).
- Passing a name / title / glob: project-level scope is limited to the **cwd project** (+ user + global levels) — names can be ambiguous across projects, so it is narrowed; to view across projects use the spec ID instead.
- Output includes the spec's **id** (plain output `id: spec-xxxxxxxx` line / `--json`'s `id` field) — after finding by name you can use the id directly with `task ref-spec`.
- `--user <username>` / `--detail` (show full content)
- `--json`: a detail command; only **duplicate-representation removal** (drops `fileName` and `relativePath` when it degenerates to a basename; use `filePath` for locating), keeps full precision and the `--detail` body, so no `--json-full`

### `ltc spec conflicts`

Detect same-name spec conflicts across levels (global/user/project with the same relativePath); each conflicting level's output includes `id` (to distinguish same-name specs at different levels).

- `--json`: columnar table `{cols,rows}`, **one row per level** (columns `fileName`/`scope`/`specId`/`filePath`/`snippet`); no conflicts → `{cols:[],rows:[]}`
- `--json-full`: raw conflict array (`fileName` + nested `levels`)
- When the current directory is not a Lattice project: under `--json` the message goes to stderr + exit code 1 (stdout stays clean and parseable); in human mode it goes to stdout

### `ltc spec init <relative-path>`

Create a spec file (writes frontmatter + placeholder title only; the body is edited by AI with search_replace).

- `--scope` / `--title` (required) / `--description` / `--tags` / `--force`

### `ltc spec set <file>`

Modify spec frontmatter (supports fuzzy matching and glob).

- `--scope` / `--title` / `--description` / `--add-tag` / `--rm-tag` / `--id`
- `<file>` supports full paths: specs in any project/location are written back to the original file directly, not limited by the cwd project

### `ltc spec suggest-description`

List specs missing `description` and show context to help fill it in. Project-level covers **all registered projects** (same view as `ltc export`, not limited to the cwd project).

- `--scope <scope>` (`all` default / `global` / `user` / `project` = all projects) / `--limit <n>` (only affects the number displayed; `total` always gives the full count) / `--json` (`specs` is a columnar table with columns `id` / `level` / `projectName` / `contentSnippet`) / `--json-full` (`specs` is a raw object array, no columnar; `relativePath` degenerating to a basename is a duplicate representation, removed in both modes)
- Both plain output and `--json` include the spec `id`, usable directly with `task ref-spec` / `spec set`
- Fix hints are `spec set` commands with absolute paths, which can be written to disk across projects directly

### `ltc spec lint [file]`

Validate spec frontmatter integrity (id/title are errors, description/updated/tags are warnings; exit code non-zero when there are errors).

- `<file>` supports fuzzy matching and glob; `--scope` limits the level
- `--all` batch scan (project-level covers all registered projects) / `--json` (columnar table `{cols,rows}`, columns `filePath`/`specId`/`ok`/`issues`; `ok` = no error-level issues, warnings do not flip it) / `--json-full` (raw report array, keeps nulls, no columnar; `relativePath` degenerating to a basename is a duplicate representation, removed in both modes)
- In plain output's full mode each spec section includes an `id` line

### `ltc spec migrate [name]`

Batch-migrate legacy specs: auto-add id / refresh updated / add title (does not auto-add description). Must run after editing a spec body. Project-level covers all registered projects (consistent with lint / suggest-description, not just cwd). Write operations have a confirmation gate: interactive runs confirm first before writing specs of projects outside cwd; `-f`/`--dry-run`/`--json`/non-TTY skip it (does not block scripts). `--scope` (default all) / `--dry-run` / `--json` / `--json-format`; output carries per-entry level labels `[project · name]` / `[user]` / `[global]`, and `--json`'s migrated/needsDescription/errors entries include `level`/`projectName`.

## `ltc spec template`

Manage spec templates: `list [--json] [--json-full]` lists available templates (`--json` is a columnar table with columns `name`/`description`/`defaultScope`/`source`/`files`; `--json-full` is a raw object array) / `apply <name>` applies to the current project / `pull <repo>` pulls custom templates from a Git repo / `sync [--repo]` syncs configured template repos / `sync-builtins [--template <names>] [--all]` syncs built-in templates to the global directory.

### `ltc spec template registry`

Manage template repos: `list [--json] [--json-full] [--page-size <n>]` lists registered repos (`--json` is a columnar table; `rows` is empty when there are no repos) / `remove <repo>` deletes a registered repo.
