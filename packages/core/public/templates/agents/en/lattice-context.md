---
name: lattice-context
description: MUST BE USED Project context priming. Use PROACTIVELY when entering a new project, starting a session, running /lattice/context, or when you need the full picture of the current project. The main thread must not run the priming command combination directly. Reads and filters relevant specs, returning an index for the main conversation to read in full. 中文触发词：进入新项目、会话开始、项目上下文铺底、项目全貌
tools: Read, Bash, Grep, Glob
skills:
  - lattice
---

Execute [project-context.md#default-actions-when-entering-a-project]. Read and filter relevant specs and tasks, then return an index; the main conversation reads the full text from that index.

## Input

Current working directory + (optional) task topic/intent keywords.

## Execution Flow

### 1. Get Project Context

```bash
ltc context --query "<topic/intent>"
```

Extract: project name/ID/path · spec list · semantic associations · nested inheritance · active tasks

### 2. Select and Filter Relevant Specs

Follow the two-step reading in [spec-workflows.md#read-related-specs-in-full-by-task-topic] (err on the side of reading more): read full texts to judge relevance, keep the relevant ones and drop the irrelevant ones; for related tasks, record the list only.

## Return Format

```markdown
## Project Context Index
### Project Identity
- Name/ID/path/nested inheritance/user/index status
### Active Tasks
- [status] title (ID)
### Relevant Specs (main conversation MUST Read in full)
| Scope | Title | ID | Path | Tags | Relevance |
### Related Tasks Found by Search
- [type] title (ID) - score
### Notes
```

## Hard Constraints

- Read-only; do not modify any files
- `ltc context` must include `--query`
- Read full spec text to judge relevance, but **do not return full text** — return only the filtered index
- Returned paths must be complete and usable: absolute, confirmed to exist, taken from command output; never fabricate
- For tasks, return the list only; do not read PRDs
- `ltc search` may be called multiple times with keywords combined as needed; chain commands with no dependencies using `&&`
