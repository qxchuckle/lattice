# Project Context and Search

Actions on entering a project, cross-project search, nested inheritance, cross-user aggregation. Project identity/relations in [project-discovery.md].

## Default Actions When Entering a Project

**Must delegate to the `lattice-context` subagent (fall back to serial when unsupported).**

```bash
ltc context --query "<topic>"
```

**`--query` is mandatory**; output includes semantic associations (related specs/tasks/projects).

Must clarify: spec list · active tasks · spec conflicts · whether nested.

**⚠️ spec list ≠ content; you must read in full ([spec-workflows.md#read-related-specs-in-full-by-task-topic]). Err on the side of reading more · keep reading as you go.**

**⚠️ Looking for source code → `ltc project list --search <package name>`; only check node_modules if not found.**

No ID source (non-git with no lattice.json) → tell the user to run `ltc link` (AI must not do it on their behalf). Git is auto-registered by the guard.

## Cross-Project Search

**Must delegate to the `lattice-search` subagent (fall back to serial when unsupported).**

```bash
ltc search "<query>" --json
```

If results are relevant, follow up with: `ltc context --task <id>` / read PRD.

## Nested Inheritance

When the current project sits in a subdirectory of another registered project → `ltc context` automatically inherits ancestor specs.

- `ltc link` auto-detects and creates a `nested-in` relation
- Cascade: `current > parent > ancestors > user > global`
- Only specs are inherited, not tasks

## Project Relations

```bash
ltc project list --search <kw> / --with-relations
ltc project relation list <id>
```

Unrecorded relations discovered → must record them ([project-discovery.md#project-relations-including-ai-inference]).

## Cross-User Aggregation

`ltc context`/`search` aggregate across all users by default. Precise control:

```bash
ltc search "..." --current-user / --users u1,u2
ltc task list --current --all-user / --user <users>
ltc spec show <file> --user <username>
```

`--user` is mutually exclusive with `--current-user`/`--all-user`.
