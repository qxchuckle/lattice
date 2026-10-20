# /lattice/task/checkpoint

**[Required before execution]** Before executing this command, you must first invoke the `lattice` skill with the Skill tool, then continue with the following steps.

**[Dependencies]**:
- task-workflows.md: 1. PRD hard triggers (T1~T8) / 4. PRD self-check before checkpoint / checkpoint types
- lattice-rules.md: answer closure self-check (#10. Answer closure self-check)

**Goal**: Record key progress of the current task, ensuring process information is persisted in a structured way and can be tracked across sessions.

## Command argument parsing

- A task ID after the command → add a checkpoint to that task directly
- No task ID after the command → infer the current task via `ltc task list --current --status in_progress`; ask the user to confirm if there are multiple

## Execution steps

### 1. Determine the target task

```bash
ltc task info <task-id>     # when there is an ID
ltc task list --current     # when there is no ID, choose the in_progress one
```

### 2. PRD self-check prerequisite (mandatory; must pass before adding a checkpoint)

Before executing `ltc task checkpoint`, **you must first pass the following self-check**—if any item is hit and the PRD is not synced, **you must first `read_file prd.md` → `search_replace prd.md` to sync, then add the checkpoint** ([task-workflows.md#4-prd-self-check-before-checkpoint]):

- [ ] Did this turn trigger any item in [task-workflows.md#1-prd-hard-triggers-t1t8]?
- [ ] Do all files changed this turn appear in the PRD's "modified file index"?
- [ ] Have this turn's approach / decisions / rejection rationale been written into the corresponding PRD sections?
- [ ] Have the new constraints / boundaries / risks discovered this turn been written into the PRD's "key constraints" or "risks" sections?

**Adding a checkpoint without passing the self-check = writing key decisions only into the checkpoint and not flowing them back to the PRD; this is the most common path to cross-session amnesia.**

### 3. Summarize the current session progress

Derive type / title / message from the conversation. **Type selection and trigger timing**: [task-workflows.md#checkpoint-types].

### 4. Write

```bash
ltc task checkpoint <task-id> --type <type> --title "<title>" -m "<content>"
```

## Output requirements

- Tell the user the checkpoint has been recorded; show the checkpoint ID / type / title
- If it was implicitly triggered, briefly explain why it is being recorded now

## Notes

- Do not record on every conversation turn; record only when there is substantive progress
- Keep titles concise; message can be detailed
- If one conversation has multiple noteworthy progress points, call the command multiple times
- Checkpoints record process information (decision events / issue events / adjustment events) and **cannot replace the PRD's current best understanding**—any decision that would change the PRD must be synced to the PRD; do not write it only into the checkpoint
- After the checkpoint is complete, still go through the remaining items of [lattice-rules.md#10-answer-closure-self-check] (ref-spec / project relations / associate, etc.)
