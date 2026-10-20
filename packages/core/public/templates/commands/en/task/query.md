# /lattice/task/query

**[Required before execution]** Before executing this command, you must first invoke the `lattice` skill with the Skill tool, then continue with the following steps.

**[Dependencies]** (all located in the lattice skill directory):
- project-context.md: project / task context queries
- task-workflows.md: task status / progress / checkpoint query semantics
- command-reference.md: CLI parameter dictionary
- subagent-delegation.md (optional): delegate to a subagent in multi-word, multi-type parallel research scenarios

**Goal**: Pure information query mode — answer the user's questions about projects, tasks, and progress; **do not modify any files or create tasks**.

## Core constraints (read-only)

| Allowed | Forbidden |
|---|---|
| `ltc task list / info / progress` | Creating, modifying, or deleting any file |
| `ltc context / search / spec show` | Creating or modifying tasks |
| `ltc project list / info` | run_in_terminal for commands with side effects |
| `read_file` to inspect PRD / progress / design | `checkpoint` / `complete` / `archive` |
| Give conclusive answers after synthesizing information | Dumping large raw CLI output without summarizing |

## Command argument parsing

- `query <specific question>` → call the appropriate CLI command to get information and answer based on the question
- `query` (no arguments) → ask the user what they want to know

## Typical questions and corresponding strategies

| User question | Information source |
|---|---|
| "What tasks are there now" / "What is the current task" | `ltc task list --status in_progress` |
| "What was completed recently" | `ltc task list --status completed` |
| "Progress of task XX" | `ltc task info <id>` + `ltc task progress <id>` |
| "What standards does this project have" | `ltc spec show --project <id>` |
| "Has anything similar been done before" | `ltc search "keyA keyB" --json` |
| "What projects are there" / "What relations exist between projects" | `ltc project list --with-relations` |
| "What is the design for task XX" | read_file the task's `design.md` |
| "What is the PRD for this task" | read_file the task's `prd.md` |

For the full CLI parameters, see [command-reference.md].

## Execution steps

1. **Understand the question**: parse the intent and determine which information sources are needed
2. **Gather information**: call the corresponding CLI command or use read_file
3. **Synthesize the answer**: conclusion first, then supporting details; do not mechanically copy CLI output

## Output requirements

- Answers must be conclusive: give the answer first, then supporting details
- When multiple tasks / projects are involved, organize with tables or lists
- When the question is vague, proactively ask follow-up questions to narrow it down
- When nothing is found, say so clearly; do not guess
