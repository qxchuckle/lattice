# Agent Commands

**Scope of this document**: the list of `/lattice/...` workflow commands injected by agent platforms + their corresponding commands file paths.

This document **does not cover the workflows behind the commands**: what to do after receiving `/lattice/task/start` → [task-workflows.md]; what to do after receiving `/lattice/spec/update/...` → [spec-workflows.md]; what to do after receiving `/lattice/context` → [project-context.md].

This document is also **not the same as CLI subcommands**: agent commands are agent entry points; for the CLI subcommand argument dictionary see [command-reference.md].

Lattice injects a set of workflow commands into agents that support commands. They are agent entry points and **are not equivalent to CLI subcommands themselves**.

## Command List and Usage

When to read: a command starting with `/lattice/` is received / you need to look up the commands file name for a command. The agent client loads the corresponding commands file automatically; this table is for lookup only.

| Command | When to Use | Skill sub-documents it relies on | commands file |
|---|---|---|---|
| `/lattice/context` | quickly get project or task context | [project-context.md] | `context.md` |
| `/lattice/keep` | a lightweight reminder that keeps the Lattice workflow in view; can be used frequently during long single-window conversations; quickly verifies task identity / workflow constraints / spec list / PRD scope / drift; one-line briefing by default; arguments may append the user's follow-up request | [SKILL.md] + [lattice-rules.md] | `keep.md` |
| `/lattice/task/query` | query project status / task progress / past completion (**read-only**) | [project-context.md] + [task-workflows.md] | `task/query.md` |
| `/lattice/task/design` | discuss solutions / analyze design without touching code | [task-workflows.md#task-modes-design-vs-implementation] | `task/design.md` |
| `/lattice/task/start` | start implementing a task and sync context | [task-workflows.md] + [spec-workflows.md] + [project-context.md] | `task/start.md` |
| `/lattice/task/fast-start` | start working in lightweight mode (fetch context and specs, without creating a task / PRD / checkpoint) | [fast-start-workflows.md] + [project-context.md] + [spec-workflows.md] | `task/fast-start.md` |
| `/lattice/task/fast-start/to-normal` | switch a fast-start session to normal task mode | [fast-start-workflows.md#switch-to-normal-mode-to-normal] + [task-workflows.md] | `task/fast-start/to-normal.md` |
| `/lattice/task/checkpoint` | record key task progress | [task-workflows.md#checkpoint-types] | `task/checkpoint.md` |
| `/lattice/task/archive` | finish a task and decide whether to capture rules | [task-workflows.md#archive] + [spec-workflows.md#capture-criteria] | `task/archive.md` |
| `/lattice/task/delete` | delete a task (natural-language matching / delete the current task / risk confirmation) | [task-workflows.md] + [command-reference.md] | `task/delete.md` |
| `/lattice/spec/update/project` | capture rules / knowledge specific to the current project | [spec-workflows.md#write-flow] | `spec/update/project.md` |
| `/lattice/spec/update/user` | capture cross-project reusable rules / knowledge belonging to the current user | [spec-workflows.md#write-flow] | `spec/update/user.md` |
| `/lattice/spec/update/global` | capture default rules shared by multiple users and projects | [spec-workflows.md#write-flow] | `spec/update/global.md` |
| `/lattice/spec/sediment` | AI autonomously identifies capturable content and decides the level; batch-writes after user confirmation | [spec-workflows.md#capture-criteria] + [spec-workflows.md#write-flow] | `spec/sediment.md` |
| `/lattice/project/profile` | generate/update an intelligent profile for a project (summary.md + tags), incremental support | [command-reference.md] | `project/profile.md` |

**Note**: commands files are deployed under the client's `commands/lattice/` directory, which is not the same relative path as this skill. When the AI receives a `/lattice/...` command, the agent client loads the corresponding commands file automatically; this table is only for looking up file names and the skill sub-documents they rely on.

## Level Selection (spec/update/*)

When to read: any variant of `/lattice/spec/update/{project|user|global}` is received, or the AI proposes capturing a rule but is unsure of the level. Choose the level along the ladder in [spec-workflows.md#capture-criteria]; do not default to global.

## Relationship with the CLI

When to read: when considering "what is the relationship between agent commands and the CLI" or deciding output detail. Assemble the response per this division of labor.

- **Agent Commands organize the workflow** (by verb: enter context / query / discuss / start / archive / capture)
- **The CLI performs the actual execution** (read/write, search, list, status updates) — arguments in [command-reference.md]
- When outputting, summarize key conclusions; do not mechanically echo command results ([SKILL.md#reading-terminal-output])
