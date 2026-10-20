# CLI parameters: project management

`ltc project` / `ltc link` / `ltc unlink` / `ltc scan` parameters. General conventions (`--force`/`--json`) in [command-reference.md#general-conventions]; project identification/registration/relation workflows in [project-discovery.md].

## `ltc link`

Register the current project with Lattice (based on git fingerprint + lattice.json).

**⚠️ AI must not call this automatically. A user-facing registration command.**

- `--name <name>` / `--description <desc>` / `--groups <groups>` / `--tags <tags>`
- `--template <templates>`: apply spec templates (comma-separated or `all`)
- `--restore <id>`: rebind an existing project
- `-y, --yes`: accepted with no behavioral difference — `link` is fully non-interactive (idempotent update when a registered project matches, creation otherwise)

## `ltc unlink`

Unregister the current project from Lattice.

- `--force` / `--remove-data` (also delete project data)

## `ltc project`

Manage registered projects.

### `ltc project list`

List all registered projects (keyword matching + RAG semantic fallback).

- `--group` / `--tag` / `--has-git` / `--orphaned` / `--with-relations` / `--json` / `--json-format`
- `--group <path>`: filter by group **subtree** (selecting `work` covers all descendants of `work/**`)
- `--json-full`: disables the trimming layer — keeps full timestamps and null-valued fields, **keeps the full `git_first_commit` (40-char sha; `id` contains only the first 16 chars, the remaining 24 are a trimming-layer omission)**, the in-row relation details under `--with-relations`, and does not convert to columnar (two-layer model see [command-reference.md#general-conventions]). **Duplicate representations are already removed in both modes**: snake_case raw DB columns that duplicate the parsed camelCase fields (`localPaths`/`gitRemotes`/`packageNames`/`monorepoPackages`/`groupPaths`), and `ids` that duplicates `id`
- `--with-relations`: under `--json` relation details appear once for the whole payload only in the **top-level `relations` table** (the same relation is not stored in both endpoint project rows); the in-row `relations` column degrades to an array of relation ids; `--json-full` keeps the nested in-row details
- `--search <keyword>`: case-insensitive match (name/ID/path/Git/package name/group/tag) + RAG semantic fallback
- `--keyword-only`: skip semantic search

### `ltc project where <path>`

Find which registered project a path belongs to (exact + parent-directory prefix + ID match). `--json` outputs `{queryPath, exact, prefixMatches}`: `exact` has the same shape as a `project list` row (parsed camelCase fields; raw DB columns removed as duplicate representations). This is a **detail command**: it only removes duplicate representations and keeps full precision and null-valued fields, so there is no `--json-full`. Absolute paths in the output can be fed directly back into `project where` / `Read` / `jq` (the CLI chain never abbreviates `~`).

### `ltc project register [paths...]`

Scan upward for the path's ID sources (.git / lattice.json) and register unregistered projects (cwd by default). Rule requirement: when a new non-cwd path appears and ltc will not be executed in that path, register in the same turn ([project-discovery.md#auto-registration-guard]).

- `--json` / `--json-format`

### `ltc project info <id>`

View project details. `--json`

### `ltc project update <id>`

Update project metadata.

`--name` / `--description` / `--tags` (comma-separated); groups: `--groups <paths>` (comma-separated **paths**, e.g. `work/frontend`; replaces the whole group set, missing paths are created automatically) / `--add-groups <paths>` / `--remove-groups <paths|grp-id>`; `--json`

### `ltc project group list`

List the project group tree (multi-level registry `project-groups.json`; the registry is the single source of truth for groups, and projects reference it by `groupId`). Output includes each group's path, descendant project count, and `grp-` id.

- `--json`: `{total, ungrouped, tree:[{id, path, count, children}]}`

### `ltc project group create <paths...>`

Create groups (supports `a/b/c` paths; parents are created automatically; repeated creation is idempotent).

### `ltc project group rename <ref> <newName>`

Rename the leaf of a group (`ref` is a path or `grp-` id; single-node write, then refresh the display paths of affected projects). `--force`

### `ltc project group move <ref> [newParent]`

Move a group to a new parent (cycle prevention + sibling name-collision check); `--root` moves it to the root level. `--force`

### `ltc project group remove <ref>`

Delete a group and its subgroups, and detach these groups from all referencing projects (confirms by default; `--force` skips).

### `ltc project remove <id>`

Delete project data (moved to trash, recoverable). `--force`

### `ltc project relation list [id]`

View inter-project relations (by default aggregates all user-defined relations).

- `--current-user` / `--user <users>` (mutually exclusive) / `--page <n>` + `--page-size <n>` / `--json` (columnar table) / `--json-format` / `--json-full`
- Default aggregates all users (other users annotated `[username]`)

### `ltc project relation add <project-a> <project-b>`

Create an inter-project relation (duplicate a/b/type is treated as the same relation and updates the description).

- `--type <type>`: default `related` (forked-from/depends-on/shares-component/nested-in/related)
- `--description <desc>`
- `--from-task <taskId>` / `--ai-inferred`

### `ltc project relation remove <relation-id>`

Delete an inter-project relation by id (ids come from `relation list`). `--force`

### `ltc project merge <from> <to>`

Physically merge two projects into one (from → to, transactional). `-f, --force`

### `ltc project profile check`

Detect which projects' profiles need updating. `--project <id>` / `--json` (each group is a columnar table `{cols,rows}`; entries omit the `status` that duplicates the group key) / `--json-full` (raw group array, keeps `status`)

Human output's first line gives a summary (`N projects total: needs update a · up to date b · no profile c · warnings d`), followed by `needs update` / `warnings` item by item with reasons and `no profile` item by item with names; with many projects use `--json` with jq.

### `ltc project profile brief <id>`

Get all lattice internal information needed for a project profile in one shot. `--json`

### `ltc project profile done <id>`

Mark profile generation as complete (collect cache + sync profileUpdated + trigger rag update).

### `ltc project profile show <id>`

View the project profile (summary + tags + cache status + file path). `--json`

### `ltc project profile path <id>`

Output the project profile directory path.

### `ltc project profile tags show <id>` / `tags set <id> --tags "a,b"` / `tags add` / `tags remove`

Manage project tags: `show` view / `set` full replacement / `add` append (deduplicated) / `remove` delete specified tags.

## `ltc scan`

Scan directories to discover all Lattice projects (simple scan; no cache writes, no interaction). `--dirs <dirs>`
