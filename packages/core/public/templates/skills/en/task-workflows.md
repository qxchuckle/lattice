# Task Workflows

Full task lifecycle: create / kickoff / implementation loop / checkpoint / archive. Hard constraints in [lattice-rules.md]; specs in [spec-workflows.md].

## Task Directory Structure

```
~/.lattice/users/<username>/tasks/<task-id>/
├── task.json       # single source of metadata (id/title/status/projects/scopePaths)
├── prd.md          # snapshot of current best understanding, revised as work proceeds (no YAML frontmatter)
├── progress.yaml   # append-only process log (11 checkpoint types)
└── design.md       # solution discussion archive (the only home for rejected options)
```

PRD governs "what should be", progress governs "what happened", design governs "how it was discussed".

## Task Modes: design vs implementation

`design (discuss) → start (implement) → design (mid-way) → implement → archive`

- **design**: read-only + analysis; business code changes forbidden; discussions go into design.md
- **implementation**: default after start
- No explicit design mode but solution discussion arises → proactively append to design.md
- On exiting design → condense the conclusion section into core decisions ([lattice-rules.md#2-design-mode-constraints])

## Whether to Create a New Task: Lightweight Changes Attach to an Existing Task

Changes meeting all three conditions below → **do not create a new task**; change directly and record it in the **most recent topically related task** (archived tasks can be appended to as well):

| Condition | Determination |
|---|---|
| Scope | Single topic, no solution design, no multi-round decisions (copy/comment fixes, deleting a converged duplicate, adding one documentation rule) |
| Ownership | A topically related existing task exists whose PRD can naturally accommodate this change (same module / continuation of the same issue) |
| Record | The change still goes into the PRD + checkpoint — this is **not** bypassing records, just not creating a new task shell |

Any one unmet → create a new task via [task-workflows.md#when-the-argument-is-not-a-task-id-title-summary-and-dedup].

**Mandatory actions when attaching to an existing task**:

1. Append a PRD section (goal of this round / changes / acceptance / relation to existing rounds), and sync the "modified file index" and "open items"
2. `ltc task checkpoint <id> --type <type>` — use `decision` for a call, `correction` to overturn an existing judgment, `milestone` when verification passes
3. If the task is already archived and its summary checkpoint was written before this round → **you must add a summary checkpoint covering all rounds** (the old one is stale; what `ltc search` / `task progress` returns would be an incomplete summary)
4. `ltc rag update`

**Violation check**: code was changed but no new task was created and nothing was attached to any PRD → this hits "bypassing the PRD to change code" in [lattice-rules.md#8-prohibitions]. "No new task" only waives the task shell, not the record.

## When the Argument Is Not a Task ID: Title Summary and Dedup

0. **Locate the project (mandatory)**: with a path → `ltc project where <path>`; with semantics → `ltc project list --search <kw>`; chain with `ltc task list --current` in one `&&`; located → `--project <id>`, not located → `--current`
1. Summarize a concise title
2. Dedup and fill gaps: `ltc search "<title>" --type task --json`
3. Similar in_progress task → list candidates for user confirmation
4. `ID=$(ltc task create "<title>" [--current | --project <id>] [--parent <id>] -q) && ltc task start "$ID"`

## Parent/Child Tasks

```bash
ltc task create "<title>" --parent <parent-id>
ltc task lineage <id> / ltc task tree <id> [--descendants]
ltc task update <id> --parent <id> / --clear-parent
```

## Kickoff Actions After Task Start

**Must delegate to the `lattice-task-start` subagent (fall back to serial when unsupported); objective no-delegation conditions in [subagent-delegation.md#conditional-delegation-principles].**

```bash
ltc task start <task-id>
```

Information gathering (`ltc context --task <task-id> --query "<topic>"` + selective spec reading) is performed by the delegated subagent; when delegation is waived per [subagent-delegation.md#conditional-delegation-principles], the main line executes the same checklist serially.

1. Read specs in full by topic ([spec-workflows.md#read-related-specs-in-full-by-task-topic]): select from the context list + fill gaps via `ltc search`. After reading in full → link with `ltc task ref-spec <task-id> <spec-id>` (the subagent only reads, it does not link; the main line handles that)
2. Reference PRDs of similar past tasks (read the relevant ones by complexity)
3. Refine the PRD (goals, constraints, solution, file index, risks); if design.md exists → read it first. Do not leave the default blank title; record only current best understanding
4. Output a PRD scope summary (which key sections are covered)
5. Sync project associations ([task-workflows.md#project-association-sync]): new paths `--paths`, newly registered projects `--project <id>`
6. Output an overall confirmation (ID + status + title + associated projects + parent task + key constraints)

## Implementation Loop

Loop on every user input:

```
user input → 1.PRD hard trigger? → 2.selective spec reading? → 3.write code → 4.checkpoint → 5.answer closure self-check ([lattice-rules.md#10-answer-closure-self-check])
```

### 1. PRD Hard Triggers (T1~T8)

On hit → first `read_file prd.md` → revise the corresponding section → decision/pivot checkpoint → then continue. No hit → skip.

| # | Trigger condition |
|---|----------|
| T1 | New requirement/requirement change/solution overturned |
| T2 | Technical solution adopted/rejected |
| T3 | Adding/removing modified files |
| T4 | ≥3 business files changed in one round |
| T5 | Unexpected compatibility/boundary/migration issue |
| T6 | New dependency/module boundary/cross-package call |
| T7 | About to record a milestone |
| T8 | PRD mentions a path/package/spec but task.json is not synced |

### 2. Selective Spec Reading + Historical Task Reference (Check Every Round)

Trigger conditions (any): topic keyword appears for the first time this round · user mentions "spec/convention/history/similar/cross-project" · involves level determination · unfamiliar module boundary/cross-package · implementation is hard and history needs checking

Discovery: select from `ltc context` heading list + fill gaps via `ltc search "<keywords>" --json` → read_file in full. If implementation is hard or precedent is needed → `ltc search "<description>" --type task --json` for historical tasks; if relevant, read their PRDs.

### 3. Anchor Before Writing Code

Changing ≥3 business files → first `read_file prd.md` to verify the file index. Missing → T3, update the PRD first.

### 4. PRD Self-Check Before Checkpoint

Confirm: changed files are in the index · decisions written into the "current solution" section · no unsynced hard triggers. Failed → update the PRD first.

### 5. Answer Closure Self-Check

Review item by item against the condition table in [lattice-rules.md#10-answer-closure-self-check]; on hit, perform the closure actions. Insufficient information → proactively call `ltc search` / `ltc context` to verify.

## Checkpoint Types

```bash
ltc task checkpoint <task-id> --type <type> --title "<title>" -m "<content>"
```

| type | Trigger | Format |
|---|---|---|
| `context` | user provides background/rules/constraints | verbatim or summary + quote |
| `correction` | AI made a mistake (user pointed it out / self-discovered) | **three parts**: what went wrong · why it was wrong · correct approach |
| `constraint` | user imposes a hard constraint | state explicitly "must/don't" |
| `assumption` | AI's key assumption | inferred content + impact if overturned |
| `followup` | should be done but deferred | why not now |
| `note` | objective fact / fallback after 3 rounds without a checkpoint | note the source |
| `decision` | choosing between options | decision + rationale |
| `pivot` | overall direction overturned | old → new + reason |
| `milestone` | stage result verified | — |
| `issue` | non-AI error (environment/dependency) | — |
| `summary` | summary before archiving | — |

**Type selection**: user speaks → user-input type; AI inference → AI-judgment type; objective event → process-event type; multiple meanings → split into multiple entries.

Rejected options → design.md. View: `ltc task progress <id> [--last N] [--type <type>]`

## Project Association Sync

| Scenario | Command |
|---|---|
| Project of the current directory | `ltc task associate <id> --current` |
| Other registered project | `ltc task associate <id> --project <pid>` |
| Unregistered path | `ltc task associate <id> --paths <path>` |

Locate the project ID: `ltc project where <path>` / `ltc project list --search <kw>`. Execute in the same round when a new path/project is discovered.

### Spec References + Metadata Consistency

```bash
ltc task ref-spec <task-id> <spec-id>
ltc task unref-spec <task-id> <spec-id>
```

task.json structured fields are the single source of machine-readable metadata. PRD mentions a path/project/spec → record it via CLI at the same time (T8).

### Project Relations

```bash
ltc project relation add <a> <b> --type <type> --description "evidence" --ai-inferred --from-task <task-id>
```

| Phenomenon | Type |
|------|------|
| Shared first commit / fork | `forked-from` |
| dependencies reference | `depends-on` |
| Shared monorepo package | `shares-component` |
| Same org with no strong evidence | `related` |

## Archive

**Must delegate to the `lattice-task-archive` subagent (fall back to serial when unsupported); objective no-delegation conditions in [subagent-delegation.md#conditional-delegation-principles].**

### Pre-Collection

**Mandatory** — writing an archive summary without reading PRD + progress + design.md = guaranteed to miss key decisions.

```bash
ltc task info <id> && ltc task progress <id>
```

Full progress already contains all checkpoints; focus on correction/constraint/context types for reconciliation and capture decision. Also needed: read prd.md + design.md + `git diff --stat`.

**Commit verification**: check `git log --oneline` / `git status` to confirm whether changes are committed. Commits or staged changes not made by you are normal — someone may be operating on the same repo in parallel; don't fuss over ownership, just confirm the changes landed.

### Flow

```bash
# 1. pre-collection → 2. reconcile + fill PRD (final solution + summary + open items) → 3. summary checkpoint
ltc task checkpoint <id> --type summary --title "..." -m "..."
# 4. complete + archive + rag update
ltc task complete <id> && ltc task archive <id> && ltc rag update
```

### Cross-Check

Before writing the PRD summary, reconcile against progress: all decisions in PRD/checkpoint · no missed changes · experience capture ([spec-workflows.md#capture-criteria]) · project relations backfilled. Gaps → fill them before continuing.

### Archive Inference with No Arguments

`ltc task list --current` + `ltc search "<topic>" --type task --json`. Only one in_progress task and it matches → archive directly; multiple candidates → list them for the user.

## Output Principles

**Concise**: do not restate CLI output, do not list commands, do not paste JSON.

**Never silent**: output immediately at key points — after creation (title + ID + project) · status switches · association changes · similar tasks (list candidates) · archive completion (result + key points).

Before entering implementation, add an overall confirmation: ID + status + title + associated projects + parent task + key constraints.
