# /lattice/task/fast-start/to-normal

**[Required before execution]** Before executing this command, you must first invoke the `lattice` skill with the Skill tool, then continue with the following steps.

**[Dependencies]** (all located in the lattice skill directory):
- fast-start-workflows.md: switch to normal mode (to-normal)
- task-workflows.md: when the argument is not a task ID: title summarization and dedup / kickoff actions after task start / implementation loop
- spec-workflows.md: read relevant specs in full by task topic

**Goal**: Convert the current fast-start session into normal task mode—create a task, backfill the PRD, and then continue with the normal implementation loop.

## Preconditions

- The current session is in fast-start mode (no lattice task created)
- The conversation already contains substantive work (otherwise using `/lattice/task/start` directly is more appropriate)

## Execution steps

### 1. Summarize the task title

Summarize a concise title from the conversation context, and dedup per [task-workflows.md#when-the-argument-is-not-a-task-id-title-summary-and-dedup] (if there are similar in_progress tasks → list candidates for the user to confirm).

### 2. Create and start the task

```bash
ID=$(ltc task create "<title>" --current -q) && ltc task start "$ID"
```

For kickoff information collection, follow [task-workflows.md#kickoff-actions-after-task-start] (specs were already read during the fast-start phase; if [subagent-delegation.md#conditional-delegation-principles] exempts delegation, run serially on the main thread / continue using existing context).

### 3. Backfill the PRD

Backfill the work completed during the fast-start phase into the PRD:

- **Goal**: the complete goal of the entire task (not just the remaining part)
- **Current approach**: completed work + remaining approach
- **Modified file index**: files already modified and files still to be modified
- **Key constraints**: constraints discovered during the fast-start phase

### 4. Associate the project

```bash
ltc task associate <task-id> --current
```

### 5. Continue in normal mode

From this point on, follow [task-workflows.md#implementation-loop] completely.

## Output requirements

- After creating the task: task ID + title + associated project
- After backfilling the PRD: a summary of the key sections covered by the PRD
- Overall confirmation: task ID + status + title + associated project + overview of the backfilled work

## Constraints

- The conversion is one-way: after switching to normal mode, you cannot go back to fast-start
- Do not miss work completed during the fast-start phase when backfilling the PRD
- If there are decisions or corrections worth recording during the fast-start phase, add checkpoints of the corresponding type after switching to normal mode
