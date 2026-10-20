# /lattice/task/fast-start

**[Required before execution]** Before executing this command, you must first invoke the `lattice` skill with the Skill tool, then continue with the following steps.

**[Dependencies]** (all located in the lattice skill directory):
- project-context.md: default actions when entering a project
- spec-workflows.md: read relevant specs in full by task topic / capture criteria / write flow
- fast-start-workflows.md: complete fast-start workflow (startup / lightweight log / complexity detection / switch to normal mode / archive)
- subagent-delegation.md: conditional delegation principles (fast-start is exempt from delegation; the main thread collects serially)

**Goal**: Start working in lightweight mode—obtain project context and specs, but do not create a task, write a PRD, or add checkpoints. Optionally record a lightweight log.

## Difference from task/start

| | fast-start | task/start |
|---|---|---|
| Get project context (`ltc context`) | ✓ | ✓ |
| Read relevant specs in full | ✓ | ✓ |
| Create task / PRD / checkpoint | ✗ | ✓ |
| Implementation loop | ✗ | ✓ |
| Lightweight log (`ltc fast-start log`) | ✓ | — |
| Spec capture reminder | ✓ | ✓ |
| Switch to normal mode when complex | ✓ | — |

## Execution steps

1. **Get project context**: run `ltc context` serially on the main thread (fast-start is exempt from delegation, [subagent-delegation.md#conditional-delegation-principles])
2. **Read relevant specs in full**: read selectively on the main thread per [spec-workflows.md#read-related-specs-in-full-by-task-topic]
3. **Output a brief confirmation**: the project context loaded + which specs were read
4. **Start working directly**: do not create a task, write a PRD, or add checkpoints

## Complexity detection (automatically judged each turn)

When any of the following signals appears, **immediately prompt the user** to decide whether to switch to normal task mode:

- Involves modifying ≥3 business files
- Requirements are vague or the approach remains uncertain after multiple clarifications
- The task still cannot be completed after multiple conversation rounds
- Solution discussion is needed (suitable for design mode)
- Cross-project collaboration or complex dependencies are found to be needed

Prompt format: `⚠ The current task has high complexity (specific reason). It is recommended to switch to normal task mode to record progress and PRD. Switch? You can use /lattice/task/fast-start/to-normal.`

After the user confirms, execute [fast-start-workflows.md#switch-to-normal-mode-to-normal].

If the user chooses to continue fast-start → do not repeat the prompt for the same signal, but prompt again when a new signal appears.

## Lightweight log

Fast-start mode can optionally record a lightweight log so the work leaves a trace. Logs are stored under `~/.lattice/users/<username>/fast-tasks/`; file names use the creation timestamp; a single file is capped at 1000 entries, and a new file is created automatically when exceeded.

After completing a piece of work, record:

```bash
ltc fast-start log add "fixed argument parsing" -m "modified task.ts" --files packages/cli/src/commands/task.ts
```

View history:

```bash
ltc fast-start log list [--last N] [--current]
ltc fast-start log search <query>
ltc fast-start log show <id>
ltc fast-start log stats
```

Not mandatory every turn—the log is an optional traceability mechanism ([fast-start-workflows.md#lightweight-log]).

## Spec capture

Fast-start mode **does not create a task**, but spec capture capability is unaffected:

- When reusable content is found (behavioral constraints / project knowledge / trial-and-error experience) → proactively ask the user whether to capture it per [spec-workflows.md#capture-criteria]
- The user can use `/lattice/spec/update/{project|user|global}` at any time to capture
- The capture flow is the same as in normal mode ([spec-workflows.md#write-flow])

## Archive

When `/lattice/task/archive` is run in fast-start mode, because no task was created, the archive command will first create a task and then archive it according to the normal flow ([fast-start-workflows.md#archive]).

## Constraints

- Do not create a task, write a PRD, or add checkpoints (these are the core characteristics of fast-start, not omissions)
- Do not follow [lattice-rules.md#3-implementation-loop]
- Reading specs in full is still mandatory—fast-start only omits task records, not project knowledge
- If the current directory is not a registered project, note that project context cannot be obtained; the user can choose to continue without it or register the project first
