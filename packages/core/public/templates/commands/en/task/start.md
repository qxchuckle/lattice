# /lattice/task/start

**[Required before execution]** Before executing this command, you must first invoke the `lattice` skill with the Skill tool, then continue with the following steps.

**[Dependencies]** (all located in the lattice skill directory):
- task-workflows.md: title summarization and dedup / kickoff actions / implementation loop / checkpoint types / output principles
- spec-workflows.md: read relevant specs in full by task topic
- project-context.md: default actions when entering a project / nested inheritance
- lattice-rules.md: hard rules for kickoff and implementation / 10. Answer closure self-check
- subagent-delegation.md: delegation decision / dispatch prompt contract (delegate kickoff to `lattice-task-start`)

**Goal**: Start a task and keep the current session consistent with the task state.

## Command argument parsing

- An existing task ID after the command → `ltc task start <task-id>` directly
- A non-ID description / keyword / file reference / requirement paragraph after the command → follow the "title summarization and dedup" flow ([task-workflows.md#when-the-argument-is-not-a-task-id-title-summary-and-dedup])

## Execution steps

### Case 1: Argument is a task ID

```bash
ltc task start <task-id>
```

### Case 2: Argument is not a task ID

Follow [task-workflows.md#when-the-argument-is-not-a-task-id-title-summary-and-dedup] to complete **project positioning (step 0, mandatory)** + summarization + dedup + creation (step 4: chained create→start in one go: capture the ID from the `-q` output via command substitution and pass it to start; see that section), then perform [task-workflows.md#kickoff-actions-after-task-start].

## After starting the task (mandatory)

Follow [task-workflows.md#kickoff-actions-after-task-start].

## Implementation loop (mandatory every turn while the task is in progress)

Follow [task-workflows.md#implementation-loop] step by step; do not skip steps.

## Progress tracking

[task-workflows.md#checkpoint-types].

## Output requirements

[task-workflows.md#output-principles].
