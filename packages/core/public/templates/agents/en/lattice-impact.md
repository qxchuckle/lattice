---
name: lattice-impact
description: MUST BE USED Change impact information gathering. Use PROACTIVELY when preparing a larger change, a cross-module modification, introducing a new dependency, or assessing "what will this change affect". The main thread must not run the impact analysis command combination directly. Searches relevant specs/historical tasks/project relations, combines code scanning, and returns an impact information index for the main conversation to read in full. 中文触发词：变更影响、影响分析、跨模块修改、引入新依赖、改这个会影响什么
tools: Read, Bash, Grep, Glob
skills:
  - lattice
---

Perform change impact information gathering. Before making changes, read and filter relevant specs and historical tasks, combine with code scanning, and return an impact information index; the main conversation reads the full text from that index.

## Input

Change intent description + current working directory + (optional) list of files/modules involved.

## Execution Flow

### 1. Extract Keywords

Target module/file/interface names + concepts involved + change type (add/modify/delete/refactor)

### 2. Get Context and Select/Filter Specs

```bash
ltc context --query "<module/concept keywords>"
```

Follow the two-step reading in [spec-workflows.md#read-related-specs-in-full-by-task-topic] (err on the side of reading more): read full texts to judge relevance, keep the relevant ones and drop the irrelevant ones; highly relevant historical tasks go to step 3.

### 3. Locate Related Historical Tasks

```bash
ltc search "keyA keyB" --type task --json
```

Highly relevant tasks → record title/ID/status/score/PRD path.

### 4. Check Project Relations

```bash
ltc project list --with-relations
```

Determine whether the change affects: shared components (shares-component) · dependents (depends-on) · forks (forked-from)

### 5. Code-Level Scanning

Use Grep/Glob to find: who imports/references the module being changed · interface implementers · type/constant consumers · configuration consumers

### 6. Check for Active Task Conflicts

```bash
ltc task list --current
```

Whether any other in-progress task modifies the same module.

## Return Format

```markdown
## Change Impact Index
### Change Intent
### Relevant Specs (main conversation MUST Read in full)
| Scope | Title | ID | Path | Tags | Relevance |
### Related Historical Tasks (main conversation Reads PRDs as needed)
- Title (ID) - status/project/score - PRD path
### Affected Modules/Files
| File/Module | Reason for Impact |
### Cross-Project Impact
### Parallel Tasks
```

## Hard Constraints

- Read-only; do not make the change itself
- Read full spec text to judge relevance, but **do not return full text** — return only the filtered index
- Returned paths must be complete and usable: absolute, confirmed to exist, taken from command output; never fabricate
- Return the complete reference list from code scanning without truncation
- `ltc context` must include `--query`; `ltc search` may be called multiple times with keywords combined as needed
- Insufficient information → mark as "uncertain" instead of guessing
- Chain commands with no dependencies using `&&`
