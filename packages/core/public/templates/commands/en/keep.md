# /lattice/keep

A lightweight reminder for keeping to the Lattice workflow. Can be used frequently throughout a conversation.

By default, do not run multiple CLI commands, write files, or output long tables. Only remediate on demand when the self-check finds genuine drift.

**[Dependencies]** (read on demand during this command; do not load everything):
- SKILL.md: navigation + kickoff contract (mandatory by default)
- lattice-rules.md: implementation loop / checkpoint timing / hard rules for spec updates / 10. Answer closure self-check
- task-workflows.md: task identity unclear / implementation loop unclear / checkpoint trigger conditions unclear
- spec-workflows.md: spec inventory not remembered / spec levels and conflicts unclear

## Usage

- Bare `/lattice/keep`: self-check and brief only
- With a request `/lattice/keep <user request>`: self-check first (one-line brief), then handle the request

## Self-check list (in order; remediate in parentheses on failure)

**Prerequisite**: Read the `SKILL.md` of the lattice skill (navigation + kickoff contract). When any step below reveals a knowledge gap, use the progressive loading navigation in `SKILL.md` to **read only the corresponding sub-document**; do not load everything.

1. **Task identity**: Are the active task ID + title explicitly statable in the current context?
   - No → `ltc task list --current --status in_progress`; if there are multiple and you cannot decide → list the candidates and ask the user to confirm; do not guess; if the task creation / progress / archive flow is also unclear → read task-workflows.md
2. **Workflow constraints**: Are the implementation loop / checkpoint timing / spec update rules in lattice-rules.md explicitly statable in the current context?
   - No → read SKILL.md + lattice-rules.md; implementation loop / checkpoint timing unclear → also read task-workflows.md; spec update rules unclear → also read spec-workflows.md
3. **Spec inventory**: Can the available spec list for the current project (which topics exist at project / user / global level) be explicitly enumerated in the current context?
   - No → `ltc context` to re-fetch the context and spec list (inventory level only, do not read full texts); if spec levels / conflicts / template mechanism are also unclear → also read spec-workflows.md
4. **PRD scope**: Does the current request fall within the active task PRD's goals / scope / constraints?
   - No → prompt the user to create a new task via `/lattice/task/start`; do not silently expand scope
5. **Drift inventory**: Any unrecorded changes since the last checkpoint? Have goals / scope / constraints / approach changes agreed upon in the conversation been synced to the PRD?
   - Unrecorded changes → run `ltc task checkpoint` immediately
   - PRD drift → `search_replace` to sync the PRD + add `decision` / `pivot` checkpoints
   - checkpoint type / trigger conditions uncertain → read [task-workflows.md#checkpoint-types]
6. **Answer closure**: Review whether this turn missed any metadata maintenance actions (ref-spec / project registration / relations / associate / rag update) according to the condition table in [lattice-rules.md#10-answer-closure-self-check]
   - Insufficient information → proactively call `ltc search` / `ltc context` / `ltc project list` to verify ([SKILL.md#autonomous-information-gathering])
   - Hit → perform the corresponding closure action immediately

This command only verifies whether the spec **inventory** is remembered; losing awareness of spec **content** to the point where behavioral compliance cannot be judged is severe drift and must go through the escalation path.

## Output (must be minimal)

- No drift: `✓ Workflow still on track: [short task ID]-[task title].` (one line)
- Corrected: `✓ Corrected: added N checkpoints / synced PRD in x places.` (one line)
- With an additional request: continue handling the request directly after the line above, without a separator
- Severe drift: [keep.md#severe-drift-escalation]

Forbidden: outputting tables by default / multi-section headings / listing raw CLI output.

## Severe drift escalation

Any one of the following counts as severe drift:

- ≥3 missing checkpoints spanning multiple work units
- Paragraph-level drift between PRD and actual code
- The current conversation topic is completely different from the active task PRD topic
- Loss of key spec awareness to the point where behavioral compliance cannot be judged

Handling: output one line `⚠ Found N severe drifts: xxx; switching to full realignment.`, then immediately execute the process in [lattice-rules.md#5-context-recovery]; do not hand the decision to the user. Defer any additional request until realignment is complete.

## Constraints

- If there is no drift, do not invent checkpoints / PRD changes
- Only allowed writes: `ltc task checkpoint` / `ltc task associate` / `search_replace` on the same PRD / closure actions from [lattice-rules.md#10-answer-closure-self-check] (ref-spec / register / relation add / spec migrate / rag update)
- Not in a Lattice project directory → maintain only skill-level and conversation-level discipline, inform the user, then continue
- No active task → skip steps 1 / 4 / 5 / 6; only verify workflow constraints and spec inventory
- Does not replace regular checkpoints: checkpoints due during the implementation loop must still be added; do not pile them up to be triggered by this command
