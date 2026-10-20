# /lattice/task/archive

**[Required before execution]** Before executing this command, you must first invoke the `lattice` skill with the Skill tool, then continue with the following steps.

**[Dependencies]**:
- task-workflows.md: Archive > pre-collection / Archive > flow / Archive > cross-check / archive inference with no arguments
- spec-workflows.md: capture criteria / write flow / levels
- fast-start-workflows.md: archive (case 3: fast-start mode)
- subagent-delegation.md: delegation decision / dispatch prompt contract / conditional delegation principles (delegate archiving to `lattice-task-archive`)

**Goal**: End and archive a task, while determining whether any standards need to be captured.

## Command argument parsing

- A task ID after the command → "case 1"
- No content after the command or not a valid task ID → "case 2" automatic inference ([task-workflows.md#archive-inference-with-no-arguments])

## Execution steps

### Case 1: A task ID follows the command

Complete archive loop [task-workflows.md#archive]; when [subagent-delegation.md#conditional-delegation-principles] exempts delegation, run this loop serially on the main thread (still read progress / PRD from disk for the cross-check):

1. **Pre-collection of information (must read before writing)**: [task-workflows.md#pre-collection]. **Skipping is forbidden**—writing an archive summary without reading PRD + progress + design.md = inevitably missing key decisions
   - Includes code change review: if the project uses git, review the code changed by this task via `git diff --stat`, and read the full source files when necessary
2. **Cross-check + update PRD**: Before writing the PRD, cross-check against progress ([task-workflows.md#cross-check])—all decisions in the PRD/checkpoints · no missed changes · project relations; after the cross-check passes, add the final approach, key results, trade-offs, remaining issues, and a "task completion summary" section
   - If the task has parent / child tasks, first use `ltc task lineage` / `ltc task tree --descendants` to check whether the chain is still reasonable
3. **summary checkpoint** + **complete** + **archive** + **`ltc rag update`**
4. **Spec capture decision**: [archive.md#pre-archive-check-spec-capture-criteria]

### Case 2: Argument is empty / not a task ID

Infer automatically per [task-workflows.md#archive-inference-with-no-arguments]:

- **Automatic archive** (no user confirmation needed): archive directly when all conditions are met: "`in_progress` is unique or a strong match + the conversation has substantive work around the task + the AI is confident"
- **User confirmation needed**: multiple candidates cannot be determined / the conversation is not centered on a clear task / the AI lacks confidence → list candidates and ask the user to confirm
- **No matching candidate**: clearly tell the user there is no suitable candidate at the moment, and that a new task can be created based on the current conversation and then archived

### Case 3: fast-start mode archive

The current session is in fast-start mode (started with `/lattice/task/fast-start`, no lattice task created) → follow [fast-start-workflows.md#archive]: create the task retroactively + backfill the PRD (work completed during the fast-start phase), then finish with the normal archive flow.

Although there is no task record in fast-start mode, the substantive work in the conversation and the spec capture decision still apply; the task is created at archive time so the work results remain traceable.

## Pre-archive check (spec capture criteria)

For the full criteria, see [spec-workflows.md#capture-criteria]. The archive output must additionally include:

- **Mandatory capture decision**: Is there any explicit user behavioral instruction / project knowledge proactively provided by the user → if either exists, capture is **mandatory**; it must not be left only in the conversation and disappear
- **Recommended capture decision** (check both types): behavioral constraints + project knowledge
- Should these rules or knowledge update the project spec? Should part of them be promoted to user spec or global spec?
- Core question: **Will the next person / AI entering this project still need this information?**
- Has `prd.md` been updated with the final approach and task completion summary?
- If the PRD has been split, is `prd.md` still retained as the task's main entry point?
- Does the current task still have unhandled follow-up child tasks? If so, state their status and follow-up arrangements clearly in the archive notes

## Output requirements

- Tell the user the task has been archived, with a brief summary of the task results
- When the command argument is empty and the AI can determine the task, state the confirmed task directly and archive it
- When a unique candidate cannot be determined, list candidates and ask the user to confirm
- When there is no matching candidate, inform the user and add "can help the user create a task based on the conversation and then archive it"
- Update `prd.md` before archiving, adding the task description and completion summary
- When standards should be captured, explicitly state which `/lattice/spec/update/*` command is recommended
