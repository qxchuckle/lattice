# Quick Start

> English | [简体中文](./quick-start.zh-CN.md)

Lattice is a local-first engineering memory and workflow layer. It captures specs, tasks, decisions, project relations and experience in `~/.lattice`, and serves them to people and AI agents through a CLI, an editor extension and a web workbench.

This guide walks you through installing, initializing and using Lattice from scratch.

## Prerequisites

- **Node.js** >= 18
- **Git** (Lattice identifies projects through git fingerprints)

## 1. Install

```bash
# Global install; provides the lattice and ltc commands
npm install -g @qcqx/lattice-cli
```

Verify the installation:

```bash
ltc --version
```

> `lattice` and `ltc` are two aliases of the same command. This guide uses `ltc` throughout.

## 2. Initialize Lattice

```bash
ltc init
```

Initialization does the following:

- Creates the `~/.lattice/` directory structure (see [Directory & configuration](./directory-and-config.md))
- Sets the current user (the system username by default)
- Optionally scans local git projects and registers them
- Optionally injects the Lattice workflow into AI clients (Cursor / Claude Code / Qoder / Trae and others)

### Common options

```bash
# Set the username
ltc init --username myname

# Skip git management during initialization
ltc init --git false

# Set scan directories during initialization
ltc init --scan-dirs ~/projects,~/work

# Import a custom spec template repository
ltc init --registry-template https://github.com/myorg/spec-templates.git

# Download the embedding model immediately (for RAG search)
ltc init --download-model

# Skip the model download even in non-interactive/-f mode
ltc init -f --no-download-model

# Choose the RAG embedding model during initialization
ltc init --model Xenova/all-MiniLM-L6-v2

# Custom model: specify dimension and prefixes (E5 / private models)
ltc init --model my-org/my-embedding --dimension 768 \
  --query-prefix 'query: ' --document-prefix 'passage: '

# Set the document language injected into AI clients (auto | zh | en; auto follows the system locale)
ltc init --lang en
```

In an interactive terminal, `ltc init` also lets you choose the embedding model; the default is `Xenova/bge-small-zh-v1.5` (512 dimensions). Non-interactive runs skip prompts, keep the current config, or use the default when no model is configured; the username falls back to the current config or the system user. Use `--username` / `--model` to override either value. For custom models, `--dimension` is required when switching models; `--query-prefix` / `--document-prefix` default to empty and can be set explicitly.

### AI client integration

`ltc init` detects locally installed AI clients and asks whether to inject the Lattice workflow files. Once injected, the AI reads project specs, tasks and related memory before writing code.

Supported tools:

- **Cursor** (`.cursor/`)
- **Claude Code** (`.claude/`)
- **Qoder** (`.qoder/`)
- **Trae** (`.trae/`)

### Document language

Injected skill / command / agent / rules documents follow the system locale by default: `zh*` → Chinese, everything else → English. You can override it explicitly:

```bash
# Inject English for this run (also writes config-local.json for later init runs)
ltc init --lang en

# Or change the config first, then re-run init
ltc config set language zh --scope local
ltc init
```

`language` accepts `auto` / `zh` / `en`. After switching languages, re-run `ltc init` to replace the injected documents; `ltc doctor` reports a mismatch between the injected language and the current config. The built-in spec templates installed by `ltc init` follow the same setting.

### Remove injections (when you no longer use Lattice)

If you no longer want AI clients to load the Lattice workflow, use `ltc uninject` to remove the documents that `ltc init` injected into external clients (**it does not touch business data in `~/.lattice`; it only syncs the injection record in `.cache/init-meta.json`**):

```bash
# Preview what would be removed (no deletion)
ltc uninject --dry-run

# Full scan → print the removal list → remove after confirmation
ltc uninject

# Remove only from specific clients
ltc uninject --tool qoder,cursor
```

Removal is based on a full scan: Lattice-owned directories such as `skills/lattice` and `commands/lattice` are removed as a whole; shared files (such as `CLAUDE.md`) only lose the `<!-- LATTICE:BEGIN/END -->` block, preserving your own content; under `agents/`, only `lattice-*.md` files injected by Lattice are removed, never your custom agents. To restore, run `ltc init` again.

## 3. Register projects

Lattice identifies projects through git fingerprints. Choose a registration method based on the project type:

### Option 1: Automatic scan (recommended for Git projects)

```bash
# Scan all git projects under the given directory
ltc scan --dirs ~/projects

# Or scan directly during initialization
ltc init scan
```

The scan discovers and registers git projects automatically and detects nested project relations (such as monorepo packages). In most cases this is the easiest path: point it at your project root and Lattice handles identification and registration.

### Option 2: Manual registration (for non-Git projects)

For purely local projects (without a `.git` directory), register manually:

```bash
cd ~/my-project
ltc link
```

`ltc link` creates `lattice.json` in the project root and registers the project with Lattice. You can attach metadata:

```bash
ltc link --name "My project" --description "Project description" --tags "frontend,react"
```

### Verify registration

```bash
# Check whether the current project is registered
ltc status
```

## 4. Use Lattice through Agent Commands

After installation, initialization and project registration, the main way to use Lattice day to day is **Agent Commands** — type `/lattice/...` commands in an AI coding assistant (Cursor / Claude Code / Qoder / Trae) to trigger the workflow.

### Division of labor between the CLI and Agent Commands

| | CLI (`ltc`) | Agent Command (`/lattice/...`) |
|---|---|---|
| **User** | Called automatically by AI workflows / run manually by humans | Typed by humans in an AI assistant |
| **Role** | Low-level execution (read/write, search, state updates) | Workflow entry point (organize tasks, retrieve engineering memory, distill experience) |
| **Frequency** | High-frequency AI calls | Human-triggered as needed |

> The AI client files injected by `ltc init` contain the full agent command definitions. If they were not injected, re-run `ltc init` as described in [Initialization](#2-initialize-lattice).

### Agent Command reference

| Command | Purpose | When to use |
|---|---|---|
| `/lattice/context` | Get project or task context | Entering a new project / switching working directories / starting a new session |
| `/lattice/keep` | Lightweight workflow self-check | Quickly verify task identity / workflow constraints / PRD scope during a long conversation |
| `/lattice/task/query` | Query project status / task progress / history (read-only) | You want to understand the current task, prior solutions or project specs |
| `/lattice/task/design` | Discuss options / analyze design (no code changes) | You need to analyze architecture, compare options or assess feasibility |
| `/lattice/task/start` | Start implementation | The plan is settled and you are ready to write code |
| `/lattice/task/checkpoint` | Record key task progress | A technical decision is made / the user adds a constraint / a problem is found |
| `/lattice/task/archive` | Finish a task and decide whether to distill rules | The task is complete and you are wrapping up |
| `/lattice/task/delete` | Delete a task | The task was created by mistake / needs cleanup |
| `/lattice/spec/update/project` | Distill project-specific rules | Project-level conventions, architecture knowledge |
| `/lattice/spec/update/user` | Distill cross-project reusable rules | Cross-project experience, user-level preferences |
| `/lattice/spec/update/global` | Distill multi-user, multi-project shared rules | Global defaults |

### Typical flow

```
New session starts
  │
  ├─ Need information?
  │    └─ /lattice/task/query  ← read-only, changes nothing
  │
  ├─ Need to discuss a plan?
  │    └─ /lattice/task/design ← read-only analysis; discussion goes to design.md
  │
  ├─ Ready to implement?
  │    └─ /lattice/task/start  ← create/start the task and enter implementation mode
  │         │
  │         ├─ (AI calls the ltc CLI automatically, including checkpoints)
  │         │
  │         └─ /lattice/task/checkpoint  ← can also be triggered manually to record progress
  │
  ├─ AI drifting away from the Lattice workflow?
  │    └─ /lattice/keep         ← lightweight self-check to get back on track
  │
  ├─ Task complete?
  │    └─ /lattice/task/archive ← archive + AI decides whether to distill a spec
  │
  └─ Reusable experience?
       └─ /lattice/spec/update/{project|user|global}  ← distill into a spec at the right level
```

> The detailed Agent Command workflows are driven by the Lattice skill documents. After receiving a command, the AI loads the corresponding skill and follows its process. Humans only need to know **which command to use and when**.

## 5. CLI reference

> These CLI commands are mainly called by AI as part of Agent Command workflows. You can also run them manually, but day-to-day use is better triggered through [Agent Commands](#4-use-lattice-through-agent-commands).

### Get project context

```bash
ltc context
```

This is Lattice's context aggregation command. It combines the current project's specs, tasks and related memory:

- **Spec list**: project-level / user-level / global specs
- **Active tasks**: tasks currently in progress
- **Related projects**: relations with other projects

```bash
# Show context for a specific project
ltc context --project <project-id>

# Show context for a task
ltc context --task <task-id>
```

### Manage specs

A spec is Lattice's reusable knowledge unit. It records project conventions, architecture knowledge, development experience and more.

#### Three-level hierarchy

| Level | Path | Scope |
|---|---|---|
| **Project** | `~/.lattice/users/<user>/projects/<id>/spec/` | Current project only |
| **User** | `~/.lattice/users/<user>/spec/` | Reusable across projects |
| **Global** | `~/.lattice/spec/` | Shared across users and projects |

Priority: project > user > global. On a name conflict, the higher priority overrides the lower one.

#### Basic operations

```bash
# List all specs
ltc spec list

# Show a spec (supports fuzzy matching)
ltc spec show frontend-conventions

# Detect conflicts across levels
ltc spec conflicts

# Create a new spec file
ltc spec init coding-style.md
```

#### Use spec templates

```bash
# List available templates
ltc spec template list

# Apply a template
ltc spec template apply frontend

# Pull a remote template repository
ltc spec template pull https://github.com/myorg/spec-templates.git
```

> See [Spec template repository layout](./spec-template-registry.md) for how to organize template repositories.

### Task management

Lattice provides full task lifecycle management with cross-project tracking.

#### Create a task

```bash
# Create a task associated with the current project
ltc task create "Implement user login" --current

# Create a subtask
ltc task create "Login form validation" --current --parent <parent-task-id>
```

#### Start a task

```bash
ltc task start <task-id>
```

#### Record progress (checkpoints)

While a task is in progress, use checkpoints to record key decisions, corrections, constraints and other information:

```bash
# Record a decision
ltc task checkpoint <task-id> --type decision --title "Use JWT" -m "Chose JWT over sessions because it is stateless and easy to scale"

# Record a user constraint
ltc task checkpoint <task-id> --type constraint --title "Do not use localStorage" -m "Security requirement: tokens may only be stored in httpOnly cookies"

# Record a correction
ltc task checkpoint <task-id> --type correction --title "Fixed missing token refresh" -m "The refresh logic was missing; added it"
```

Checkpoint types:

| Type | Purpose |
|---|---|
| `context` | Background, requirements or domain knowledge provided by the user |
| `correction` | Correction record |
| `constraint` | Hard constraint / red line |
| `decision` | Technical decision or option selection |
| `pivot` | Direction change |
| `milestone` | Stage result |
| `issue` | External problem or pitfall |
| `note` | Objective fact |
| `assumption` | Implicit assumption |
| `followup` | Follow-up item |
| `summary` | Task summary |

#### View progress

```bash
# Show recent progress
ltc task progress <task-id>

# Show the last five entries
ltc task progress <task-id> --last 5

# Filter by type
ltc task progress <task-id> --type correction
```

#### Complete and archive

```bash
# Mark a task complete
ltc task complete <task-id>

# Archive a task
ltc task archive <task-id>
```

#### Other common operations

```bash
# List active tasks in the current project
ltc task list --current

# Show task details
ltc task info <task-id>

# Show the task tree (including subtasks)
ltc task tree <task-id>

# Associate a task with a project or path
ltc task associate <task-id> --current
ltc task associate <task-id> --paths ~/my-project/src

# Add a spec reference to a task
ltc task ref-spec <task-id> frontend-conventions
```

### Search

Lattice includes local RAG search (embedding vectors + full-text index) across specs, tasks, projects, checkpoints and relations.

```bash
# Basic search
ltc search "authentication design"

# Restrict the result type
ltc search "login" --type task
ltc search "component conventions" --type spec

# Restrict to a project
ltc search "API design" --project <project-id>

# JSON output (for programmatic use)
ltc search "authentication" --json
```

Search covers all users by default. To search only the current user's data:

```bash
ltc search "authentication" --users myname
```

### Web UI

```bash
# Install the web package
npm install -g @qcqx/lattice-web

# Start the web UI (default port 14527)
ltc web

# Use a custom port
ltc web --port 8080

# Do not open a browser automatically
ltc web --no-open
```

The web UI provides:

- Project relation graph (force-directed layout)
- Task / spec / project browsing
- Cross-project relation visualization

### Health check

```bash
# Check Lattice configuration health
ltc doctor

# Automatically fix detected issues
ltc doctor --fix
```

## Next steps

- **Architecture**: [architecture.md](./architecture.md)
- **Directory & configuration**: [Directory & configuration](./directory-and-config.md)
- **Agent Commands**: [`packages/core/public/templates/skills/en/agent-commands.md`](../packages/core/public/templates/skills/en/agent-commands.md)
- **AI workflow**: [`packages/core/public/templates/skills/en/SKILL.md`](../packages/core/public/templates/skills/en/SKILL.md)
- **Always-on rules**: [`packages/core/public/templates/platforms/en/lattice-rules.md`](../packages/core/public/templates/platforms/en/lattice-rules.md)
- **CLI reference**: [`packages/core/public/templates/skills/en/command-reference.md`](../packages/core/public/templates/skills/en/command-reference.md)
- **Spec template registry**: [Spec template repository layout](./spec-template-registry.md)
- **Task workflows**: [`packages/core/public/templates/skills/en/task-workflows.md`](../packages/core/public/templates/skills/en/task-workflows.md)
- **Spec workflows**: [`packages/core/public/templates/skills/en/spec-workflows.md`](../packages/core/public/templates/skills/en/spec-workflows.md)
