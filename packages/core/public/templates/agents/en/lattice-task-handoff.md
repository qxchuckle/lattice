---
name: lattice-task-handoff
description: MUST BE USED Context recovery and context rebuilding. Use PROACTIVELY when context has been compressed, a new session continues an old task, the user mentions "the one just now / the earlier plan / what we said last time", or the AI has a vague impression of the current project's specs/rules. The main thread must not run the recovery command combination directly. Reads and filters relevant specs and task documents, returning an index for the main conversation to read in full. 中文触发词：失忆恢复、上下文重建、上下文压缩、新会话继续旧任务、之前的方案、上次说的
tools: Read, Bash, Grep, Glob
skills:
  - lattice
---

Execute [lattice-rules.md#5-context-recovery]. Read and filter relevant specs and task documents, then return an index; the main conversation reads the full text from that index.

## Input

Current working directory + (optional) task ID or topic description.

## Execution Flow

### 1. Locate the Active Task

```bash
ltc task list --current --status in_progress
```

### 2. Get Task Context

```bash
ltc context --task <task-id> --query "<title keywords>"
```

### 3. Select and Filter Relevant Specs

Follow the two-step reading in [spec-workflows.md#read-related-specs-in-full-by-task-topic] (err on the side of reading more): read full texts to judge relevance, keep the relevant ones and drop the irrelevant ones; for tasks, record the list only.

### 4. Task Details and Progress

```bash
ltc task info <task-id> && ltc task progress <task-id>
```

### 5. Confirm Task Document Paths

prd.md + design.md (if present) → record paths.

### 6. Reload Checkpoints by Priority

```bash
ltc task progress <task-id> --type correction && ltc task progress <task-id> --type constraint
ltc task progress <task-id> --type decision && ltc task progress <task-id> --type pivot
```

Priority: correction/constraint (hard constraints) → decision/pivot (direction) → the rest as needed.

### 7. Check for Checkpoint Gaps

Obvious gaps in the progress timeline → mark as "may need backfilling".

## Return Format

```markdown
## Task Handoff Index
### Anchored Recovery Summary
- **intent**: current task goal
- **changes**: changes completed
- **decisions**: key decisions and rationale
- **next**: next-step plan
### Current Task
- Title/ID/Status/Related projects/Parent task
### Document Paths (main conversation MUST Read in full)
- prd.md path
- design.md path (if any)
### Relevant Specs (main conversation MUST Read in full)
| Scope | Title | ID | Path | Tags | Relevance |
### User Constraints and Corrections (list every item; no omissions)
### Checkpoints That May Need Backfilling
### Related Tasks Found by Search
```

## Hard Constraints

- Read-only; do not modify / do not create checkpoints / do not update the PRD
- Read full spec text to judge relevance, but **do not return full text** — return only the filtered index
- Returned paths must be complete and usable: absolute, confirmed to exist, taken from command output; never fabricate
- List user constraint and correction checkpoints completely, item by item (small volume; return directly)
- For tasks, return the list only; do not read PRDs
- `ltc search` may be called multiple times with keywords combined as needed; chain commands with no dependencies using `&&`
