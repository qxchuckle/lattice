# Fast-start Workflows

fast-start is a lightweight variant of `task/start`: it fetches context and reads specs in full, but does not create a task/PRD/checkpoint. Normal task flow in [task-workflows.md].

## When to Use

**Suitable**: deterministic lightweight tasks (bug fixes, small features, config tweaks) · tasks you don't want recorded · the user knows it is simple

**Not suitable** (use `/lattice/task/start`): unclear requirements · multiple files and modules · needs solution design and decision records

## Startup Flow

fast-start waives delegation ([subagent-delegation.md#conditional-delegation-principles]): priming and selective spec reading are executed serially by the main line.

1. `ltc context`
2. Read related specs in full ([spec-workflows.md#read-related-specs-in-full-by-task-topic])
3. Output a brief confirmation
4. Start working directly

## Differences from Normal Mode

| | fast-start | task/start |
|---|---|---|
| context + full spec reading | ✓ | ✓ |
| task/PRD/checkpoint | ✗ | ✓ |
| implementation loop | ✗ | ✓ |
| lightweight log | ✓ | — |
| spec capture | ✓ | ✓ |
| complexity detection + switch to normal | ✓ | — |

Does not follow [lattice-rules.md#3-implementation-loop] or [lattice-rules.md#6-task-completion-closed-loop].

## Constraints During Work

- Full spec reading is still mandatory (fast-start only saves task records, not project knowledge)
- Do not create tasks/PRDs/checkpoints
- Spec capture still applies ([spec-workflows.md#capture-criteria])
- Current directory is not a registered project → notify the user

## Lightweight Log

Stored in YAML files under `~/.lattice/users/<u>/fast-tasks/`. Optional records, not enforced.

```bash
ltc fast-start log add "title" -m "content" [--files ...]
ltc fast-start log list [--last N] [--project <id>] [--current] [--json]
ltc fast-start log search <query> [--last N] [--project <id>] [--current]
ltc fast-start log show <id>
ltc fast-start log stats
ltc fast-start log clear [--force]
```

Differences from checkpoints: no task dependency · no type classification · no PRD linkage · coarse-grained.

## Complexity Detection

Any of these signals → suggest switching to normal mode: vague requirements with repeated clarifications · still unfinished after multiple rounds · needs complex solution discussion · needs cross-project collaboration

Prompt: `⚠ High complexity (reason). Recommend switching to normal mode. Use /lattice/task/fast-start/to-normal.`

If the user chooses to continue → do not repeat the same signal.

## Switch to Normal Mode (to-normal)

Precondition: currently in fast-start + the conversation already contains substantive work.

1. Summarize the title + dedup ([task-workflows.md#when-the-argument-is-not-a-task-id-title-summary-and-dedup])
2. `ID=$(ltc task create "<title>" --current -q) && ltc task start "$ID"`; kickoff information gathering per [task-workflows.md#kickoff-actions-after-task-start]
3. Backfill the PRD (complete goals + completed work + remaining solution + file index + constraints)
4. `ltc task associate <id> --current`
5. From then on, follow the normal implementation loop

Constraints: one-way conversion · do not lose completed work · add checkpoints for decisions/corrections.

## Archive

Under fast-start, run `/lattice/task/archive`:

1. Summarize the title → `ID=$(ltc task create "<title>" -q) && ltc task start "$ID"`
2. Backfill the PRD (goals/final solution/file index/completion summary)
3. `ltc task associate <id> --current`
4. Follow the normal archive flow ([task-workflows.md#archive])
