# /lattice/spec/update/project

**[Required before execution]** Before executing this command, you must first invoke the `lattice` skill with the Skill tool, then continue with the following steps.

**[Dependencies]** (all located in the lattice skill directory):
- spec-workflows.md: spec definition / levels / capture criteria / write flow
- SKILL.md: index maintenance
- lattice-rules.md: 7. Spec priority

**Goal**: Capture long-term-valid experience for the current project from this session into project-level specs.

## When to use

Core question: **Will the next person / AI entering this project still need this information?**

Specs serve both as behavioral constraints and project knowledge ([spec-workflows.md#spec-definition]). Both types are suitable for project-level specs:

- **Behavioral constraints**: coding standards / commit flow / naming rules / architecture boundaries / directory conventions / dependency direction / integration methods / deployment flow / stable practices for recurring problems that are valid only for the current project
- **Project knowledge**: this project's structural map (which package does what, module responsibilities, directory conventions) / unique domain concepts / business terminology / data structure semantics / key design motivations / architecture selection rationale / rejected proposals and why / standard methodology for solving a class of problems / module entry points / call chain overview / extension points and adaptation approaches

For the full capture criteria (must / recommended / do not capture), see [spec-workflows.md#capture-criteria].

## Execution steps

Follow [spec-workflows.md#write-flow] uniformly.

### Writing principles specific to project level

- **One file focuses on one topic only**
- Write actionable rules, not vague slogans
- Prioritize recording "when to do this, when not to do this"
- Do not turn one-off temporary requirements into long-term standards
- **Project-level specs do not need a `## Scope` section** (they naturally apply only to the current project)

### Level decision specific to project level

Decide whether the rule should stay at project level or be promoted to user / global:

- If the rule is also valid in other similar projects → consider promoting it to user level
- If it is already a default rule that holds for multiple users and projects → consider promoting it to global level

For level criteria, see [spec-workflows.md#levels].

## Output requirements

- State which spec file was updated
- State the core rules added / modified
- On semantic conflicts, clearly report: conflict point / project level will override upper-level rules / suggested resolution (keep the special case / merge / delete redundancy)
