---
name: lattice
description: >-
  Local-first engineering memory and workflow via the Lattice CLI: specs, tasks, decisions and search. Trigger words include:
  Lattice, engineering memory, spec, convention, project standard, project knowledge, module responsibility, domain
  knowledge, past solution, similar project, cross-project experience, current task, shared
  component, cross-repo requirement, ~/.lattice, lattice CLI. Also use proactively in these
  workflow scenarios: on first entering a registered project, fetch memory and layered specs
  first; before coding, confirm project-level / user-level / global-level rules; when the user
  asks "which project did something similar before", "is there a reusable solution" or "what
  conventions does the current project have", search and aggregate memory first; when a
  requirement involves multiple repos, shared components or cross-project tasks, check tasks and
  related projects first; when new long-term rules, architecture decisions, module
  responsibilities, domain concepts or development methodology emerge in a session, decide
  whether to capture them as project-level, user-level or global-level specs.
  中文触发词：Lattice、研发记忆、spec、规范、约定、项目标准、项目认知、模块职责、领域知识、历史方案、类似项目、跨项目经验、当前任务、共享组件、跨仓库需求、上下文、~/.lattice、lattice CLI
---

# Lattice

Local-first engineering memory and workflow layer: `projects` + `tasks` + `specs` + search. Data root `~/.lattice/`, CLI alias `ltc`.

## When to Use

- Entering/switching project directories → project identity and context
- Confirming rules before coding; asking "where was something similar done" / "is there a reusable solution" → project knowledge
- Multiple repos, shared components, cross-project tasks → cross-project collaboration
- A lattice task exists or is about to be created → full task lifecycle
- Rules/decisions/concepts/methodology worth capturing emerge → knowledge capture

## Document Loading

All referenced documents live in the same directory as this file (the skill's base directory when loaded).

**Required reading** (first time + re-read after compaction):

| Document | Responsibility |
|---|---|
| [lattice-rules.md] | kickoff / implementation loop / context recovery / archive hard constraints / answer closure self-check |
| [project-context.md] | actions on entering a project, search, nested inheritance |
| [spec-workflows.md] | spec read/write, capture decision |
| [task-workflows.md] | full task lifecycle |
| [subagent-delegation.md] | delegation decision, dispatch prompt contract, return format |

**On demand** (read before performing the corresponding action):

- Registering/identifying a project · multi-path detection · AI-inferred project relations · non-cwd path seen for the first time → [project-discovery.md]
- Executing or indexing an agent command · unsure which slash commands are available → [agent-commands.md]
- Using the fast-start flow · `ltc fast-start` related operations → [fast-start-workflows.md]
- Using an uncertain `ltc` command/parameter/option · need to confirm the full argument format → [command-reference.md] (entry point for CLI argument routing; forwards to cli-*.md sub-documents by command category)
- Procedural `ltc` command errors · abnormal RAG search results · index/data inconsistency → [troubleshooting.md]

## Autonomous Information Gathering

Insufficient information → call ltc proactively, do not act from memory. Principles: be fully prepared before acting · check when unsure · acquire incrementally · summarize conclusions after acquiring

| Situation | Command |
|---|---|
| Unfamiliar module/concept | `ltc spec show <name>` → Read / `ltc spec list` |
| Tech choice/architecture | `ltc search "keyA keyB" --type task --json` → read PRD |
| Error/compatibility | `ltc search "<error>" --json` |
| "Did something similar before" | `ltc search "<description>" --json` |
| Unsure about conventions | `ltc context --query "<topic>"` |
| Reference a completed task | `ltc task progress <id>` → read PRD |
| Find a project/source | `ltc project list --search <kw>` |
| Project of the current directory | `ltc project where .` / `ltc status` |
| Register a non-cwd project | `ltc project register <paths...>` |
| Relations between projects | `ltc project list --with-relations` |
| Active tasks | `ltc task list --current` |
| Index anomalies | `ltc doctor` / `ltc rag status` |
| Task progress | `ltc task progress <id> [--last N] [--type <type>]` |
| Cross-user | `ltc search --json` / `ltc spec show <name> --user <u>` / `ltc task list --current --all-user` |

## Metadata Maintenance (Sync Discovered Changes in the Same Round)

- New project/path → `ltc task associate` (for non-cwd use `--project <id>`)
- Reference spec → `ltc task ref-spec`
- Unrecorded relation → `ltc project relation add --ai-inferred`

**task.json is the single source of machine-readable metadata; PRD prose cannot replace it.**

**At answer closure**: review the table above item by item for triggers ([lattice-rules.md#10-answer-closure-self-check]).

## Index Maintenance

After spec/PRD/project changes → `ltc rag update`; on errors → `ltc rag rebuild`.

## Reading Terminal Output

- **Read in full**: Lattice documents (spec/PRD/design/progress/skill), `ltc search`/`context`, troubleshooting, `ltc doctor`
- **Filterable**: git log, build logs (`grep -nC 5`), `git status --short`
- **Self-check**: truncated/missing expected keywords → re-run in full
- Chain independent commands with `&&`; ltc commands must be called with `--json` (except `config set`: its `--json` is the input value to parse)

## --force

AI callers must pass `-f`: `init` / `init scan` / `uninject` / `unlink` / `project relation remove` / `project merge` / `user rename` / `user remove` / `trash purge` / `fast-start log clear`. Full list: [command-reference.md#general-conventions].
