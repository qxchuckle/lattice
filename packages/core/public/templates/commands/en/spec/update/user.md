# /lattice/spec/update/user

**[Required before execution]** Before executing this command, you must first invoke the `lattice` skill with the Skill tool, then continue with the following steps.

**[Dependencies]** (all located in the lattice skill directory):
- spec-workflows.md: spec definition / levels (user / global must include `## Scope`) / capture criteria / write flow
- SKILL.md: index maintenance
- lattice-rules.md: 7. Spec priority

**Goal**: Capture cross-project reusable experience that still reflects the current user's way of working into user-level specs.

## When to use

Core question: **Is this rule reusable across projects, but not so universal that it fits all users and all projects?**

For specs' dual role, see [spec-workflows.md#spec-definition]. Both types suit the user level (**precondition**: reusable across projects and a declared "scope of application"):

- **Behavioral constraints**: practices an individual / team repeatedly adopts across multiple projects, cross-project code style / architecture preferences / collaboration methods
- **Knowledge / methodology**: general debugging routines, troubleshooting checklists, and diagnostic techniques; domain knowledge reused across projects (common pitfalls of a tech stack, standard modeling approaches for a class of business problems); personally preferred workflow methodologies (design discussion flow, PR review checklist)

For the full capture criteria, see [spec-workflows.md#capture-criteria].

## Execution steps

**Follow [spec-workflows.md#write-flow] uniformly.**

### Requirements specific to user level

1. **Must declare `## Scope`**: User-level specs affect all projects, so they must specify which projects / languages / frameworks the standard applies to, and the cases where it does not apply ([spec-workflows.md#levels])
2. **Writing principles**:
   - Focus on reusable workflows, code style, architecture preferences, and collaboration methods
   - Try to avoid tightly binding the tech stack to a specific project
   - When conflicting with project-level specs, **do not force them to be flattened**; let the project level keep its special case
3. **Conflict detection**: Before writing, you must read existing global-level and project-level specs to judge semantic contradictions. If the new rule is inconsistent with the global level, explain whether this is an intentional override or should be merged

## Output requirements

- **Clearly explain why this rule is suitable for the user level rather than the project level**
- State which file was updated
- On semantic conflicts, clearly report: conflict point / impact scope / suggested resolution
- Remind the user that project-level specs can still override this rule
