# CLI parameters: knowledge export

`ltc export` parameters. General conventions (`--force`/`--json`) in [command-reference.md#general-conventions]; spec read/write/capture workflows in [spec-workflows.md]. Migration: the former `ltc spec export` is equivalent to `ltc export --only spec` (option names unchanged).

## `ltc export`

Export specs and tasks as a standard Agent Skills directory (`SKILL.md` entry + `project-index.md` project index + `spec-catalog.md` / `task-catalog.md` progressive catalogs + `manifest.yaml` hash manifest + `global/` + `user/` + project folders + `tasks/`). SKILL.md is self-describing for Agents without a Lattice environment: its description is a fixed template (what the knowledge base is for + when reading is mandatory, no counts or other data-plane content); the body contains "How to use" and "Contents". The project index table records each involved project's package names / git remote / description and spec·task counts (external AI first matches projects in the local environment); task records contain "Related projects / Related specs" references, the task directory is grouped by project and each project section carries spec catalog references — project ↔ spec ↔ task can be read as a chain. Cross-document references are Markdown relative links (`[title](relative path)`, clickable by humans; a deliberate exception to the AI doc-reference convention for the dual-consumer (AI + human) scenario). Task file names use the short id form (`<user>__<date>-<shortid>.md`; the full taskId and title live in frontmatter / body / catalog line) to avoid the duplicate representation of embedding title slugs in paths. When content contains local paths / Lattice references, a "Usage notes" section is generated automatically to guide consumers to find the corresponding objects in their own environment. Output size optimization happens only at the structural layer (duplicate-representation removal / catalog layering / empty column omission); no knowledge content is truncated or clipped. Repeated exports compare manifest hashes and rewrite only changed files.

Quick start:

- Full personal knowledge base (current user, default scope): `ltc export`
- Team spec distribution: `ltc export --filter hbos --only spec --name hbos-specs -o <distribution repo>/hbos-specs` (run `--dry-run` first; when updating the distribution repo add `--prune` to clean stale files)
- Multi-user + exclude projects: `ltc export --user all --exclude-project 'chord,lattice'`
- In-progress work handoff: `ltc export --only task --task-status in_progress`
- Time-range retrospection: `ltc export --task-since 2026-09-01 --task-until 2026-09-30`

Filtering (combination semantics: type narrowing → OR within the same kind, exclusions take precedence → AND across different kinds; except for `--filter`, multi-value options accept repetition or commas):

- `--only <kind>`: spec / task (repetition or commas; default all registered kinds)
- `--scope <level>`: global / user / project (spec level, combinable)
- `--user <name>` / `--exclude-user <name>`: user (default current user; `all` = all users)
- `--project <v>` / `--exclude-project <v>`: project id / name / package name / git remote (no wildcard = substring; with wildcards (`*` `?` `[…]` `{a,b}`) glob matches the whole string, `*` matches `/` — e.g. `github.com/qxchuckle/*`); the project whitelist keeps only project-level specs, and the blacklist means "exclude if involved" for tasks
- `--tag <tag>` / `--exclude-tag <tag>`: spec tag (exact)
- `--filter <kw>` / `--exclude-filter <kw>`: keywords (spec metadata + project metadata; task title + PRD + design record + process log; free text, repetition only)
- `--spec <v>` / `--exclude-spec <v>`: exact spec entries (id / file name; no wildcard = prefix match, with wildcard = glob whole-string match)
- `--task <v>` / `--exclude-task <v>`: exact task entries (id; no wildcard = prefix match, with wildcard = glob whole-string match)
- `--task-status <s>`: planning / in_progress / completed / archived / all (default archived)
- `--task-since <date>` / `--task-until <date>`: task creation time window (YYYY-MM-DD, UTC, inclusive on both ends)
- `--task-depth <d>`: digest (default: frontmatter + PRD + related projects + related specs + design record + process log) / prd (frontmatter + PRD only) / full (directory as-is + README)

Output and validation:

- `--name <name>` (kebab-case, default lattice-knowledge) / `--description <d>` (overrides the auto-generated description)
- `-o, --output <dir>`: output directory, default `~/.lattice/.cache/export-skill/<skill name>/`
- `--dry-run`: preview (filters/stats/warnings/list of files to write and clean), no disk writes
- `--prune`: delete stale files recorded in the old manifest but not exported this time (distribution repo update scenario; mutually exclusive with `--clean`)
- `--clean`: clear the target directory then re-export (regardless of whether it was produced by this tool; mutually exclusive with `--overwrite`/`--prune`)
- `--overwrite`: overwrite-merge when the target is non-empty and not managed by this tool (same paths overwritten, the rest kept; mutually exclusive with `--clean`)
- `--verify <dir>`: no export, only validate directory/manifest consistency (compatible with legacy spec export directories)
- `--strict`: warnings become errors (non-zero exit code, CI-friendly)
- `--json`: structured report (stats / written / skipped / deleted / warnings / projectMatches in full)

Semantics to note:

- Safe-write default: when the target directory is non-empty and not managed by this tool (no manifest.yaml), **refuse by default and prompt** — use `--clean` to clear and re-export or `--overwrite` to overwrite-merge; a directory containing this tool's manifest.yaml is allowed incrementally by default (repeated exports just rerun)
- `--project` keeps only project-level specs (user/global are excluded as well); for "all-layer specs related to a project" use `--filter`
- Task `--filter` is recall-oriented (it matches the PRD body; the hit surface can be large); run `--dry-run` first to see hit counts, then narrow
- When selecting tasks precisely, note the default is archived only: add `--task-status all` to include other statuses
- After exclusion filters, re-exporting to the same directory does not delete old files automatically; use `--prune` to clean leftovers
