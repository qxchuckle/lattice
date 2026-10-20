# /lattice/task/design

**[Required before execution]** Before executing this command, you must first invoke the `lattice` skill with the Skill tool, then continue with the following steps.

**[Dependencies]**:
- task-workflows.md: task modes (design vs implementation) / title summarization and dedup / checkpoint types
- lattice-rules.md: answer closure self-check (#10. Answer closure self-check; applicable to design: ref-spec / project registration / project relations)
- spec-workflows.md: read relevant specs in full by task topic (read selectively when the discussion needs spec support)

**Goal**: Enter "solution discussion mode" — analyze and propose only, do not modify code files, until the user explicitly asks to start implementation.

## Core constraints

| Allowed | Forbidden |
|---|---|
| read_file / grep_code / search / lsp | search_replace / create_file / delete_file |
| ltc context / search / spec show | Modifying any business code file |
| Proposing solutions, drawing comparison tables, listing pros/cons | Silently starting implementation |
| Writing / appending to `design.md` | Modifying the approach section of `prd.md` (except writing back conclusions) |
| Recording `checkpoint --type decision` | run_in_terminal for commands with side effects |

**Sole exception**: Writing `design.md` and `prd.md` under the task directory is allowed (only when writing back the final conclusion).

## Command argument parsing

- `design <task-id>` → enter discussion mode for an existing task
- `design <description/topic>` → follow "title summarization and dedup" to create a task ([task-workflows.md#when-the-argument-is-not-a-task-id-title-summary-and-dedup]) → enter discussion mode
- `design` (no arguments) → check for an active task; if one exists, enter it; otherwise ask the user what they want to discuss

## Execution steps

### Case 1: Argument is an existing task ID

```bash
ltc context --task <task-id>
ltc task progress <task-id> --last 5
```

Use read_file to read the task's `design.md` (if it exists) and learn the previous discussion history.

### Case 2: Argument is not a task ID

Follow [task-workflows.md#when-the-argument-is-not-a-task-id-title-summary-and-dedup] to complete **project positioning (step 0, mandatory)** + summarize the title + dedup + create (step 4, chained create→start in one go), then perform [task-workflows.md#kickoff-actions-after-task-start].

### Case 3: No arguments

```bash
ltc task list --current --status in_progress
```

If there is an active task, ask whether to enter discussion mode for it; otherwise ask the user what topic they want to discuss.

## After entering discussion mode

1. **Read context**: PRD, progress, existing design.md
2. **Start discussing**: analyze around the user's question, propose candidate solutions, compare pros and cons
3. **Record in real time**: append discussion content to `design.md`
4. **Answer closure**: before sending each reply, review the applicable items per [lattice-rules.md#10-answer-closure-self-check] (ref-spec / project registration / project relations / checkpoint)

### design.md writing format

Append a new section each time you enter design mode:

```markdown
## YYYY-MM-DD <discussion topic>

### Background
<why this needs discussion>

### Candidate solutions
- **Solution A**: ...
  - Pros: ... / Cons: ...
- **Solution B**: ...
  - Pros: ... / Cons: ...

### Discussion points
<key questions, user feedback, constraints>

### Conclusion
<the final adopted solution and rationale>
```

Also add a checkpoint each time a key decision is reached:

```bash
ltc task checkpoint <task-id> --type decision --title "<decision title>" -m "<decision content>"
```

## Exit design mode

Exit when any of the following is met, returning to a state where code can be modified:

- The user explicitly says "start implementing" / "let's go" / "go with solution X" / "you can write code now"
- The user runs `/lattice/task/start`
- The user issues an explicit code modification instruction

On exit:

1. Write the conclusions of this round back into the corresponding sections of `prd.md`
2. Ensure the "Conclusion" section for this round in `design.md` is filled in
3. If there are unrecorded key decisions, add the missing checkpoints

## Implicit trigger: when design discussion arises naturally in conversation

Updating `design.md` is not limited to explicitly running this command. When there is an active task (`in_progress`) and any of the following occurs in the conversation, the AI should **proactively** append to `design.md`:

- The user proposes multiple candidate solutions for you to compare and analyze
- The conversation develops into a pros/cons discussion of approaches / architecture decisions / technology selection
- The user rejects a solution and gives reasons
- The discussion produces constraints, boundary definitions, or design principles
- The user asks design-type questions such as "do you think A or B is better", "will this work"

**Note**: Implicit triggering does not enter the "no code changes" constraint; it is only responsible for recording the design discussion process. If the user discusses solutions and writes code at the same time, the discussion part should still be recorded in `design.md`.

## Output requirements

- Clearly tell the user that discussion mode has been entered and no code will be modified for now
- When creating a new task, state the task ID and the title adopted
- If there is discussion history (design.md is not empty), briefly summarize the previous discussion progress
- Focus on solution analysis during discussion; avoid outputting code implementation details
- When exiting discussion mode, clearly tell the user "discussion mode has exited; implementation can begin now"
