# Project Discovery, Identification and Association

Project identity: multi-ID model, `project where`, `ltc link`, task association, project relations (including AI inference), data integrity. Context priming after entering a project in [project-context.md].

## Core Model

- Every project has **multiple IDs** (`ids: string[]`), formatted `<prefix>:<content>`; any match means the same project

| Prefix | Generation | Priority |
|---|---|---|
| `legacy:` | id in `lattice.json` (produced only by user action) | 1 (highest) |
| `git:` | first 16 chars of the `git_first_commit` SHA | 2 |
| `remote:` | first 16 chars of `sha256(normalize(git_remote))` | 3 |

- `selectPrimaryId` is computed dynamically by priority, not by array order
- Directories with no ID source require manual `ltc link`
- `localPaths` is an array (multi-path binding: worktrees, different clones)
- **Virtual merge**: IDs intersect → the query layer automatically treats them as one group (zero physical operations). Projects with a `legacy:` ID match only on the `legacy:` intersection (protection mechanism)
- Project relations use `relations.json` as the source of truth, each with a unique `rel_xxxxxxxx` id

## On Entering an Unknown Directory

```bash
ltc project where <path>            # exact + parent-directory prefix + ID matching
ltc project list --search <keyword> # keyword search
```

## Auto-Registration (Guard)

Any ltc command automatically walks **upward** from cwd level by level looking for an ID source (`.git` / `lattice.json`), and auto-registers it if unregistered (idempotent). No exceptions for any command.

| Scenario | Action |
|---|---|
| Will run ltc commands in that path | the guard handles it; no manual action |
| Non-cwd path where no ltc command will be run | `ltc project register <paths...>` |
| `ltc scan --dirs X` | register X and its ancestors upward first, then scan downward recursively |
| `ltc task associate --paths X` misses | auto-register upward and retry → on hit, goes into `projects[]` |

## Register or Restore Binding (ltc link)

**⚠️ AI must not call `ltc link` without user approval**. Git projects are auto-registered by the guard; no link needed. `ltc link` is mainly for non-git directories or scenarios that need `lattice.json`.

| Scenario | Behavior |
|---|---|
| Path matched + has a `legacy:` ID | idempotent update, writes `lattice.json` |
| Path matched + no `legacy:` (matched by other IDs) | create a new project (new `legacy:` ID), virtually merged with the original project |
| Not found | create a new project + `lattice.json` |

```bash
ltc link --restore <id>    # bind directly when the id is known
ltc link --force-new       # skip matching and force-create
ltc link --yes             # non-interactive (candidates only warn and create new)
```

Nested auto-detection: after link, search upward for a parent → auto-create a `nested-in` relation.

## lattice.json Points to a Nonexistent id

Fix: `ltc link --restore <id>` / `ltc link` (goes through ID matching) / `ltc link --force-new`

## A Task's "Project Set" and "Path Set"

- `projects[]`: registered project ids
- `scopePaths[]`: extra paths involved in the task but not registered

```bash
ltc task associate <id> --project <pid>
ltc task associate <id> --current
ltc task associate <id> --paths /p1 /p2 [--note "..."]
ltc task associate <id> --remove-path /p / --remove-project <pid> / --clear-paths
```

`--paths` smart behavior: hits a registered project → goes into `projects[]`; miss → resolve upward, register and retry → still no ID source → goes into `scopePaths[]`.

## Project Relations (Including AI Inference)

Check existing first: `ltc project list --with-relations` / `ltc project relation list [id]`

| Phenomenon | Type |
|------|------|
| Shared git first commit / fork | `forked-from` |
| A's dependencies reference B | `depends-on` |
| Same monorepo package | `shares-component` |
| Directory nesting | `nested-in` (automatic via link) |
| Same org with no strong evidence | `related` |
| Same basename only | do not create |

```bash
# user instruction
ltc project relation add <a> <b> --type <type> --description "..."
# AI inference
ltc project relation add <a> <b> --type <type> --description "evidence" --ai-inferred --from-task <task-id>
```

Delete: `ltc project relation remove <relation-id>`

## Data Integrity Maintenance

```bash
ltc doctor --migrate              # upgrade legacy fields + backfill DB
ltc doctor --rebuild-fingerprints # re-collect fingerprints
ltc doctor --recheck-scope-paths  # scopePaths promotion check
ltc project merge <from> <to>     # physical merge (transactional)
```

Virtual merge is usually enough; `merge` is only for when duplicates truly need to be eliminated.

## Manual Scan

```bash
ltc scan --dirs /p1,/p2
```

For each target path: first register **upward** (the path itself and ancestor ID sources), then scan **downward** recursively for `.git` → collect IDs → register or append `localPaths`.
