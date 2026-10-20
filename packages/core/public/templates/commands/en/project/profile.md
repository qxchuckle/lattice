# /lattice/project/profile

**[Required before execution]** Before executing this command, you must first invoke the `lattice` skill with the Skill tool, then continue with the following steps.

**[Dependencies]** (all located in the lattice skill directory):
- command-reference.md: `ltc project profile` parameter dictionary (check / brief / tags / done / show / path)

**Goal**: Generate/update an intelligent profile for a project (summary.md + tags), supporting incremental updates.

## Command parameters

- No arguments → current project
- `--all` → all registered projects
- `--project <id/name>` → specified project
- `--force` → ignore the cache and force a full regeneration

## Execution steps

### 1. Detect which projects need updating

```bash
ltc project profile check --json
# Or specify a project:
ltc project profile check --project <id> --json
```

- With `--force`, skip detection and update all target projects directly
- No stale projects and not force → output "All profiles are up to date" and end

### 2. For each stale project, gather information

**Step A: Get all Lattice-internal information with one command**

```bash
ltc project profile brief <id>
```

Output includes: project metadata, profile directory path, existing summary.md content, existing tags, project-level spec list (ID/title/summary), associated task list (ID/title/status), project relations.

**Step B: AI reads file system information itself**

- Git log (Git projects): run `git log --oneline -30` under localPaths
- Top-level directory structure: `ls` the first level of each localPath
- README: read the root README + each package's README one level deep
- Manifests such as package.json / Cargo.toml

**Reading strategy**: The AI decides independently what to read and how deep. For incremental updates, refer to the old summary in the brief and keep content that is still correct.

### 3. Generate summary.md

Format (functional/business perspective, no code structure or technical details):

```markdown
# <project name>

<one-sentence positioning: what it does, who it is for>

## Core features
- Feature/capability (described from a business perspective)

## Package structure (monorepo/multi-package projects only)
- Each package's functional responsibility (business perspective, not technical implementation)

## Ecosystem role
<business positioning within the project ecosystem>
```

Description language adapts automatically (follows the user's conversation and context).

Write directly to `<profileDir>/summary.md` using the file editing tool.

### 4. Set tags

```bash
ltc project profile tags set <id> --tags "tag1,tag2,tag3"
```

Tags are a flat string array describing the project's functional, technical, and business domains.

### 5. Mark done

```bash
ltc project profile done <id>
```

This command automatically: collects the current state into cache.json + syncs project.json profileUpdated + triggers rag update.

### 6. Output statistics for batch runs

```
Update complete: 3 projects
  Project A — /path/to/a
  Project B — /path/to/b
  Project C — /path/to/c
Skipped: 57 (no changes)
```

## Constraints

- If localPaths does not exist / is empty: skip file reading and generate only from Lattice-internal data (spec/tasks/relations/metadata)
- Ignore uncommitted local file changes; track only committed/persisted state
- summary.md does not include: tech stack, directory structure, code-level details
