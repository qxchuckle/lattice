# /lattice/context

**[Required before execution]** Before executing this command, you must first invoke the `lattice` skill with the Skill tool, then continue with the following steps.

**[Dependencies]**:
- project-context.md: default actions when entering a project / nested inheritance / cross-user aggregation
- spec-workflows.md: read relevant specs in full by task topic
- project-discovery.md (as needed): how to run `ltc link` when the current directory is not registered
- subagent-delegation.md: delegation decision / dispatch prompt contract (delegate `lattice-context` for groundwork, `lattice-search` for search)

**Goal**: Quickly obtain high-signal context for the current project or current task, as the starting point for subsequent implementation and analysis.

## Execution steps

1. When the current directory belongs to a registered project: delegate to the `lattice-context` subagent (when unsupported, fall back to running `ltc context --query "<current request/topic>"` serially) ([project-context.md#default-actions-when-entering-a-project])

2. When the user provides a task ID after the command, additionally run:

   ```bash
   ltc context --task <task-id>
   ```

3. **Read relevant specs in full by the current request / task topic** (mandatory): [spec-workflows.md#read-related-specs-in-full-by-task-topic]. The `ltc context` output is only a list of spec titles; **summaries are often missing—seeing titles does not mean knowing the content**.

## Output requirements

- Do not dump the entire context directly; distill the rules and risks most relevant to the current request
- When summarizing, prioritize: the most critical spec rules for the current project (distilled after reading the full text with read_file, not a list of titles) / current active tasks and their status / whether multi-level spec conflicts exist / whether there are related projects worth referencing
- When the current directory is not a Lattice project, clearly tell the user and suggest they run `ltc link` (non-Git projects) or `ltc scan` (Git projects) themselves; the AI must not run these on their behalf
