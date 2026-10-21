# Core Concepts

> English | [简体中文](./concepts.zh-CN.md)

Lattice organizes engineering context into four kinds of assets: specs, tasks, checkpoints and project relations. They live under `~/.lattice` as plain files, so they outlive a session, a repository or an agent.

## Specs are layered

Lattice resolves specs at three scopes:

1. **Global** — organization-wide conventions, independent of one user.
2. **User** — rules that follow one person across projects.
3. **Project** — architecture, boundaries and conventions for one repository.

The closer scope wins: project over user, user over global. `ltc context` returns the resolved view with provenance, so an agent can tell which layer a rule came from. Nested projects also inherit specs from their ancestors.

## Tasks carry intent

A task is the unit of work, not the unit of memory. It keeps three files:

| File | What it answers |
|---|---|
| `prd.md` | What should be true now |
| `progress.yaml` | What happened, as typed checkpoints |
| `design.md` | How the solution was discussed, including rejected options |

Tasks move through `planning`, `in_progress`, `completed` and `archived`. They can span several projects, carry scope paths outside a registered repository and nest as subtasks.

Archiving is not deletion: it is where a finished task is distilled into reusable memory.

## Checkpoints carry decisions

Lattice records checkpoints instead of a chat transcript. The eleven types cover three sources:

| Source | Types |
|---|---|
| User input | `context`, `correction`, `constraint` |
| AI judgement | `assumption`, `followup`, `note` |
| Process events | `decision`, `pivot`, `milestone`, `issue`, `summary` |

A checkpoint is worth writing when it changes future work. If it only repeats the task title, skip it.

## Projects form a graph

Relations connect projects explicitly:

- `depends-on` — one project consumes another.
- `shares-component` — a package or module is used by both.
- `forked-from` — a shared first commit or fork.
- `related` — same organization, no stronger evidence yet.
- `nested-in` — one project lives inside another Git repository.

The graph is what lets a change in one repository pull the right context from another.

## Search is local

Lattice indexes local files and supports keyword and semantic retrieval. The index is a cache, not the source of truth: deleting it must never delete your memory.

## Sync is optional

Local files are the primary store. `ltc sync` shares the same structure across your machines; sync domains share selected experience with other people. There is no required cloud service and no telemetry.

## Next

- [Quick start](./quick-start.md) — install and initialize Lattice.
- [Web workbench](./web-workbench.md) — the same model in the browser.
- [Architecture](./architecture.md) — how the layers are built.
