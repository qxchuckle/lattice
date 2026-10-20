# Subagent Delegation

When the platform supports subagents, hand Lattice's **IO-heavy, multi-path parallel** information-gathering flows to subagents. Information-provider subagents read and filter relevant specs and tasks, returning a filtered catalog (path + ID + metadata + relevance note); **the main line Reads the required documents in full from that catalog and may proactively call `ltc search` / `ltc context` to fill gaps**. Read has no truncation limit, and the main line holds the full conversation context, so it judges the full-read scope better than a subagent.

**Hard constraint: the scenarios below must be delegated; the main line is forbidden to run the corresponding command combinations directly.** When the platform does not support subagents, fall back to serial execution (run the same command list in order, proactively shrinking output). Objective no-delegation conditions in [subagent-delegation.md#conditional-delegation-principles].

| Scenario | Subagent that must be delegated | Commands the main line is forbidden to run directly |
|------|---------------------|------------------------|
| Task kickoff information gathering | `lattice-task-start` | `ltc context --task` + `ltc search` + Read combo |
| Task archiving | `lattice-task-archive` | `ltc task progress` + PRD completion + checkpoint + archive combo |
| Project context priming | `lattice-context` | `ltc context` + `ltc spec list` combo |
| Cross-project search | `lattice-search` | multi-path `ltc search --json` in parallel |
| Context recovery | `lattice-task-handoff` | all commands in the recovery flow |
| Full spec reading | `lattice-spec-digest` | `ltc context` + `ltc search` + Read combo |
| Change impact analysis | `lattice-impact` | context + search + grep combo |
| Health check | `lattice-health` | `ltc doctor` + `rag status` + `spec conflicts` combo |

## Conditional Delegation Principles

The scenarios above must be delegated by default (fall back to serial when unsupported). When any objective condition below applies, delegation is waived and the main line runs the same command list defined for that subagent serially (passing `--json`, proactively shrinking output):

| Scenario | Objective no-delegation condition | Extra main-line obligation when waived |
|---|---|---|
| Information-gathering type (kickoff / priming / full spec reading / cross-project search / impact analysis) | the main line has already Read in full, in this session, the documents required by that flow | directly reuse what was already read |
| Task archiving | no compaction / context-recovery signal in this session ([lattice-rules.md#5-context-recovery]) | still read on-disk progress / PRD and reconcile before writing the summary |
| fast-start mode (priming + spec reading) | currently in fast-start lightweight mode | main line runs `ltc context` + selective reading serially; restore delegation after switching to normal mode as complexity rises |

**`lattice-task-handoff` is never exempt from delegation**: its trigger means the main line's context is missing, so no no-delegation condition holds.

**Violation check**: the main line claims a no-delegation condition but this session has no corresponding Read record, or a compaction / context-recovery signal exists yet delegation was skipped → the condition does not hold; delegation is required.

## Predefined Subagents (Prefer These)

| name | Responsibility | Trigger |
|---|---|---|
| `lattice-task-start` | task kickoff information gathering | starting a new task |
| `lattice-task-archive` | archive pre-collection + archive execution | archiving a task |
| `lattice-context` | project context priming | entering a new project/session start |
| `lattice-search` | cross-project search | "have we done something similar before" |
| `lattice-health` | health check (diagnose only, no fixes) | troubleshooting anomalies |
| `lattice-task-handoff` | context recovery / context rebuild | after context compaction |
| `lattice-spec-digest` | spec digest | unfamiliar modules / many specs |
| `lattice-impact` | change impact analysis | before larger changes / cross-module edits |

**Scheduling rule**: scenario matches the table above → must delegate to the predefined subagent; not covered → use the ad-hoc delegation test below. `lattice-task-archive` is the only predefined subagent that performs writes (it only writes Lattice metadata).

## Ad-Hoc Delegation Test

Enable only when all hold: 1. the platform supports subagents 2. the command is read-only 3. output volume is large or parallelism is needed 4. the main line only needs a catalog or conclusion. Any one unmet → main line serial.

## Scenarios Suitable for Ad-Hoc Delegation

| # | Scenario | Example commands | Return format |
|---|---|---|---|
| 1 | Parallel review of multiple tasks | run `context --task` / `progress` in parallel for N tasks | grouped by id: `{title,status,last_checkpoint,blockers}` |
| 2 | Cross-project metadata rollup | `project list --with-relations` + parallel `project info` | `{projectId,name,mainPath,relations}` list |
| 3 | link candidate ID investigation | parallel `project info` / `project where` for candidates | candidate comparison table |

## Delegation Prohibited

- Any **write operation** (exception: the predefined `lattice-task-archive`)
- `ltc link` (a manual user command; AI must not call it)
- Commands requiring interactive user confirmation
- Single fast queries (no parallel gain)
- Small-scope queries tightly coupled to the current edit

## Main Line ↔ Subagent Contract

1. Commands carry `--json`
2. Information-provider type (context / task-start / spec-digest / task-handoff / search / impact): read and filter relevant specs and tasks, return a filtered catalog (path + ID + metadata + relevance note), **do not return full document text**; returned paths must be fully usable (absolute, confirmed to exist, taken from command output)
3. **After receiving the catalog, the main line must Read the relevant documents in full** (spec / PRD / design.md) — this is a hard obligation, not an optional action; skipping Read = working without spec constraints
4. The dispatch prompt content is constrained by subagent type:
   - **Information-provider type**: **provide only input parameters** (task ID, topic, working directory); execution steps and return format are controlled by the subagent definition file — do not ask in the prompt to "return the full text / return complete content" or restate the execution flow; violation = overriding the "do not return full text" hard constraint in the subagent definition with the prompt
   - **Executor type**: every metadata fact in the prompt (parent/child chain / task status / whether committed / associated projects) **must be verified via `ltc` this round**; write nothing unverified, let the subagent look it up itself. Asserting from memory = injecting false premises into the execution flow (observed consequence: the main line asserted "this task has no parent/child chain" while an in_progress subtask actually existed → the subagent followed it and archived incorrectly). Violation check: the prompt contains status / chain statements but this round has no corresponding `ltc task info` / `ltc task tree` call record → delete the statement or verify first
5. The main line may proactively call `ltc search` / `ltc context` to fill gaps — not limited by the subagent's catalog; for a single `ltc search`, separate multiple related keywords with spaces to form a keyword group, and use different keyword groups across calls until information is sufficient
6. Analysis type (health): return diagnostic conclusions and fix recommendations
7. Executor type (task-archive): return an execution report; **when the report contradicts the main line's statements, disk / CLI output wins** — a contradiction means the main line's premise is wrong; re-check before deciding the next step, and never override the subagent's measured results with memory
8. No recursive delegation
9. Failure fallback: subagent reports insufficient information → the main line runs the full set itself, then judges

## When Subagents Are Unsupported

Run the same commands serially and proactively shrink output: pass `--json` · merge queries · for health checks run only `ltc doctor`.
