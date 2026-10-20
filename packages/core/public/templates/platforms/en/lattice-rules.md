# Lattice Workflow (System-Level Standing Rules)

Hard constraints for cross-project engineering memory and workflow. Each `[xxx.md#section]` link expands into a sub-document; this file does not restate the workflows.

**Language**: Always respond in the user's language. The documentation language does not determine the reply language.

**Before acting, always run through:**

1. Looking at source code → `ltc project list --search <package name>`
2. Project conventions → read specs
3. Uncertain → check historical tasks
4. Programmatic workflows (task start/archive/context priming/search/health check/context recovery/spec digest/impact analysis) → MUST delegate to a subagent; fall back to serial execution when unsupported ([subagent-delegation.md])
5. Path outside cwd and ltc will not be run there → `ltc project register <paths...>` ([project-discovery.md#auto-registration-guard])

ltc commands automatically register from cwd upward. If you will run ltc at that path → no manual register needed.

## 1. Kickoff Contract (First Thing in a New Session)

1. `ltc context --query "<topic>"` ([project-context.md#default-actions-when-entering-a-project])
2. Read specs in full by topic, err on the side of reading more ([spec-workflows.md#read-related-specs-in-full-by-task-topic])
3. Active task exists → `task info` + `task progress` + read design.md ([task-workflows.md#kickoff-actions-after-task-start])
4. User mentions "conventions/before/similar/history/cross-project" → `ltc search --json`
5. Multiple repositories → `ltc project list --with-relations`; relations not recorded → `relation add --ai-inferred`
6. Looking at source code → `ltc project list --search <package name>`

## 2. Design Mode Constraints

After design, modifying business code is forbidden. Allowed: read / grep / search / lsp / ltc / writing design.md. Forbidden: search_replace / create_file / delete_file / commands with side effects.

Exit: the user explicitly says "start implementation". Record: discussion → design.md; decisions → checkpoint; conclusions → prd.md. No explicit design but solution discussion occurs → append to design.md.

## 3. Implementation Loop

Each round: PRD sync → selective spec reading → code changes → checkpoint → answer closure self-check ([task-workflows.md#implementation-loop]).

Fallback: 3 rounds without a checkpoint → add a `note`. fast-start does not follow the loop, but full spec reading and capture still apply.

Lightweight changes (single topic + an existing task related to the topic) do not create a new task shell; attach to the existing task's PRD + checkpoint ([task-workflows.md#whether-to-create-a-new-task-lightweight-changes-attach-to-an-existing-task]); only the task shell is exempt, not the record.

## 4. Project Association Sync

Maintain task.json `projects`/`scopePaths`/`referencedSpecs` in real time. When a new project/path/spec is found, sync it in the current round ([task-workflows.md#project-association-sync]).

**task.json is the single source of machine-readable metadata; the PRD cannot replace it.** (T8)

## 5. Context Recovery

Signals: "summary"/"continued from previous" appears · you do not remember the start of the session · vague impression of specs/rules.

Recovery must delegate to `lattice-task-handoff` (serial when unsupported), rebuild context according to its template, and produce a 4-field recovery summary (intent / changes / decisions / next).

## 6. Task Completion Closed Loop

Before `task complete`, execute the [task-workflows.md#archive] closed loop.

fast-start archive: create task → start → backfill PRD → follow the closed loop above.

## 7. Spec Priority

`Project-level > user-level > global`. On conflict, project-level wins; inform the user.

## 8. Prohibitions

**[Kickoff]** Skipping context and modifying an unfamiliar project based on experience

**[Implementation]** Writing long-term specs for one-off requirements · changing code while bypassing the PRD · not doing a PRD self-check before checkpoint · modifying business code during design · ignoring compression signals · not running `ltc spec migrate` after editing specs · partial reading of Lattice documents (must read in full)

**[Archive]** Filling in the PRD only at archive time · deleting/archiving directly while subtasks exist

**[Security]** Recording sensitive information in the body (→ `~/.lattice/.cache/sensitive/`) · proactively syncing the source of truth to copies · proactively running build/init/rag update (unless the task requires it) · running confirmation-required commands without `--force`

## 9. Concise Output

Omit subjects, preambles, transitions, and restatements. Chain commands with no dependencies using `&&`. Do it directly; do not explain first.

## 10. Answer Closure Self-Check

With an active task, review each item before sending every round's answer (execute only when matched; skip otherwise):

1. Read/referenced a new spec → `ltc task ref-spec <task-id> <spec-id>`
2. A new path outside cwd appears (unregistered) → `ltc project register <paths...>`
3. Found an unrecorded relation between projects → `ltc project relation add <a> <b> --type <t> --description "evidence" --ai-inferred --from-task <id>`
4. Involves a new project/path (task not associated) → `ltc task associate <task-id> --project <pid>` / `--paths <p>`
5. PRD contains paths/package names/specs but task.json is not synced → sync via CLI (T8)
6. Code changes completed but no checkpoint this round → `ltc task checkpoint <task-id> --type <type> --title "..." -m "..."`
7. Overturned/changed the solution direction → checkpoint `--type pivot`
8. Produced reusable knowledge/rules → ask the user whether to capture it as a spec
9. Edited spec body → `ltc spec migrate`
10. spec/PRD/project structure changed → `ltc rag update`

No active task → skip this entire section.
