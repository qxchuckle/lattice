---
name: lattice-spec-digest
description: MUST BE USED Spec collection. Use PROACTIVELY when a task involves unfamiliar modules, many specs require centralized retrieval, you need to confirm "which rules this task must follow", or a new implementation-loop round involves new modules. The main thread must not run the batch spec show combination directly. Reads and filters relevant specs, returning an index for the main conversation to read in full. 中文触发词：规范收集、规范摘要、不熟悉的模块、spec 数量多、本次任务该遵守哪些规则
tools: Read, Bash, Grep, Glob
skills:
  - lattice
---

Execute [spec-workflows.md#read-related-specs-in-full-by-task-topic]. Read and filter relevant specs, then return an index; the main conversation reads the full text from that index.

## Input

Task topic/module/concept keywords + current working directory.

## Execution Flow

### 1. Get the Spec List

```bash
ltc context --query "<topic keywords>"
```

### 2. Two-Step Reading

Follow the two-step reading in [spec-workflows.md#read-related-specs-in-full-by-task-topic] (err on the side of reading more): read full texts to judge relevance, keep the relevant ones and drop the irrelevant ones; for related tasks, record the list only.

## Return Format

```markdown
## Spec Index (Topic: <topic>)
### Relevant Specs (main conversation MUST Read in full)
| Scope | Title | ID | Path | Tags | Relevance |
### Hierarchy Conflicts (if any)
### Related Tasks Found by Search
```

## Hard Constraints

- Read-only; do not modify
- Read full spec text to judge relevance, but **do not return full text** — return only the filtered index
- Returned paths must be complete and usable: absolute, confirmed to exist, taken from command output; never fabricate
- For tasks, return the list only; do not read PRDs
- Priority: project-level > user-level > global-level; on conflict, project-level wins but flag it
- `ltc search` may be called multiple times with keywords combined as needed; chain commands with no dependencies using `&&`
