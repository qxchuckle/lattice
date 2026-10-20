# /lattice/spec/update/global

**[Required before execution]** Before executing this command, you must first invoke the `lattice` skill with the Skill tool, then continue with the following steps.

**[Dependencies]** (all located in the lattice skill directory):
- spec-workflows.md: spec definition / levels (user / global must include `## Scope`) / capture criteria / write flow
- SKILL.md: index maintenance
- lattice-rules.md: 7. Spec priority

**Goal**: Capture high-level rules that hold for multiple users and multiple projects into global specs.

## When to use

Core question: **Is this rule no longer a preference of a particular project or user, and does it have clear generality and stability, such that making it a global default reduces repeated communication?**

For the dual role of specs, see [spec-workflows.md#spec-definition]. Global specs should only keep **high-value, low-controversy, transferable** content:

- **General constraints**: naming principles, general documentation structure rules, task management habits, and general collaboration rules that hold across users and projects
- **General knowledge / methodology**: cross-project common knowledge (general code organization mental models, naming intuition), standard methodologies applicable to multiple users and projects, general troubleshooting or delivery cadence

For the full capture criteria, see [spec-workflows.md#capture-criteria].

## Execution steps

**Follow [spec-workflows.md#write-flow] uniformly.**

### Requirements specific to global level

1. **Must declare `## Scope`**: Global specs affect all users and all projects, so the applicable boundary must be explicit to avoid blind application ([spec-workflows.md#levels])
2. **Writing principles**:
   - Global specs only keep high-value, low-controversy, transferable rules
   - Content suitable for global: naming principles, documentation structure, task management habits, general collaboration rules
   - **Do not write tech-stack-specific rules or team-private conventions into global specs**
3. **Conflict detection**: Global rules are defaults, but lower levels (user / project) may already have more specific rules. Read lower-level content to confirm the new rule will not cause confusion with lower levels; if a lower level already has a stricter special case, confirm whether the global rule is still a reasonable default

## Output requirements

- **Explain why this rule is suitable for the global level**
- State which global spec file was updated
- When semantic conflicts with lower-level specs are detected, clearly report: conflict point / suggested resolution
- Remind the user that project-level and user-level rules can still override global defaults
