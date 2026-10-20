# /lattice/spec/sediment

**[Required before execution]** Before executing this command, you must first invoke the `lattice` skill with the Skill tool, then continue with the following steps.

**[Dependencies]** (all located in the lattice skill directory):
- spec-workflows.md: spec definition / levels / capture criteria / write flow
- SKILL.md: index maintenance
- lattice-rules.md: 7. Spec priority

**Goal**: The AI autonomously scans the current session for capturable content, decides on its own which level each item belongs to (project/user/global), confirms with the user, and then writes. The user does not need to specify the level manually.

## Difference from spec/update/{project|user|global}

| | `/lattice/spec/update/<level>` | `/lattice/spec/sediment` |
|---|---|---|
| Who decides the level | User specifies | AI decides autonomously |
| Who identifies capturable content | User specifies or implies | AI extracts from conversation/tasks |
| When to use | The user knows exactly what to capture and where it belongs | Batch capture at the end of a conversation / before task archiving |

## Execution steps

### Step 1: Identify capturable content

Review the current session (including PRD, checkpoints, design.md, conversation history), and filter by the three-tier criteria in [spec-workflows.md#capture-criteria]: skip the "do not write" category, keep the "must write" and "recommended to write" categories as candidates.

### Step 2: Decide the level autonomously

For each candidate, assign a level using the following decision tree (rationale in [spec-workflows.md#levels]):

```
Is this information valid only for the current project?
  ├─ Yes → Project level
  └─ No → Reusable across projects but a personal/team preference?
           ├─ Yes → User level
           └─ No → Common to multiple users/projects and low-controversy?
                    ├─ Yes → Global level
                    └─ No → User level (when in doubt, default to user level)
```

### Step 3: Confirm the capture plan with the user

Output a capture plan table in the format:

```
## Capture plan

| # | Content summary | Level | Target file | Rationale |
|---|---|---|---|---|
| 1 | ... | Project level | xxx.md | Valid only for the current project structure |
| 2 | ... | User level | yyy.md | Cross-project troubleshooting methodology |

Confirm execution? You can change the level or exclude an item.
```

Wait for user confirmation. The user can:
- Confirm directly
- Adjust the level of an item
- Exclude an item
- Add missed items

### Step 4: Write

After user confirmation, follow [spec-workflows.md#write-flow] for every item. Multiple specs may be written in batches, but conflict detection must be done independently for each.

## Command parameters

- No arguments: scan the entire current session
- `--task <id>`: scan the specified task's PRD + progress + design.md
- Followed by description text: only determine the level and capture the content specified by the user (no full scan)

## Output requirements

- The confirmation table in step 3 must be output; do not skip confirmation and write directly
- After writing, report: which spec files were updated/created + their levels
- If conflicts are detected, mark them in the confirmation table and let the user decide
