# /lattice/task/delete

**[Required before execution]** Before executing this command, you must first invoke the `lattice` skill with the Skill tool, then continue with the following steps.

**[Dependencies]** (all located in the lattice skill directory):
- task-workflows.md: task directory structure / checkpoint types
- command-reference.md: `ltc task delete` / `ltc task list` / `ltc search` parameter dictionary

**Goal**: Delete a task. Supports natural-language matching of candidate tasks for user confirmation; with no arguments, deletes the current in_progress task; when risk factors exist, forces a second user confirmation.

## Command argument parsing

- A task ID (or prefix) after the command → "case 1"
- A natural-language description / keywords after the command → "case 2"
- No content after the command → "case 3"

## Execution steps

### Case 1: Argument is a task ID

```bash
ltc task info <id>          # confirm the task exists + get metadata
ltc task progress <id>      # check whether there are checkpoint records
ltc task tree <id>          # check whether there are child tasks
```

After obtaining the task information, proceed to [delete.md#risk-assessment-and-confirmation].

### Case 2: Argument is a natural-language description

Find candidates by cross-matching search + list:

```bash
ltc search "<description>" --type task --json
ltc task list --current
```

Matching rules:
- Sort search results by score and take highly relevant candidates
- Exclude `archived` tasks (unless the user explicitly wants to delete an archived task)
- No search results → fall back to `ltc task list --current` and fuzzy-match by title keywords
- Still no match → tell the user no task was found, and suggest using `/lattice/task/query` to look around

Once there are candidates → list them (title + ID + status + brief information) for the user to choose → after obtaining the task ID, proceed to [delete.md#risk-assessment-and-confirmation].

### Case 3: No arguments

Delete the task currently being executed:

```bash
ltc task list --current
```

- Filter for `in_progress` tasks
- **Exactly one** → proceed directly to [delete.md#risk-assessment-and-confirmation]
- **Multiple** → list candidates for the user to choose
- **No in_progress task** → tell the user there is currently no task being executed

## Risk assessment and confirmation

After locating the target task, you **must** perform a risk assessment and have the user confirm; this cannot be skipped.

### Risk factor checks

| Check item | Command | Handling when at risk |
|---|---|---|
| Has child tasks | `ltc task tree <id>` | **Refuse deletion**; prompt the user to migrate / delete / archive child tasks first |
| Status is in_progress | `ltc task info <id>` | Warning: the task is in progress; it cannot continue after deletion |
| Has checkpoint records | `ltc task progress <id>` | Warning: N progress records will be lost |
| Has associated projects | `ltc task info <id>` | Note: the task is associated with N projects |

### Confirmation flow

1. Output a task information summary (title + ID + status + child task count + checkpoint count + associated projects)
2. Output the risk assessment result (list the risk factors hit, or "no additional risk factors")
3. Explicitly ask the user whether to confirm deletion
4. User confirms → execute deletion; user refuses / does not explicitly confirm → abort without deleting

**Forbidden**: Executing deletion without explicit user confirmation. Even if the user expresses deletion intent in a natural-language description, you must first show the task information and risk factors and then confirm.

## Execute deletion

After user confirmation, run:

```bash
ltc task delete <task-id>
```

Deletion is a soft delete (moved to trash). You can view it with `ltc trash list` and restore it with `ltc trash restore <id>`.

## Output requirements

- When listing candidate tasks: title + ID + status; do not paste raw search JSON
- Risk assessment: concisely list the risk factors hit; also state when there are no risks
- After successful deletion: tell the user the task was moved to trash + how to restore it
- When deletion is aborted: explain the reason (user refused / has child tasks / task not found, etc.)
- When there are no arguments and no in_progress task: clearly state that there is currently no task being executed
