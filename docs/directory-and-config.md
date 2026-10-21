# Directory & Configuration

> English | [简体中文](./directory-and-config.zh-CN.md)

This document describes Lattice's data directory layout and configuration options, to help you understand storage, back up or migrate data, and customize configuration.

## Directory layout

All Lattice data lives under `~/.lattice/`.

> Set the `LATTICE_HOME` environment variable to override the root directory (see [LATTICE_HOME](#lattice_home-environment-variable)).

### Full directory tree

```
~/.lattice/                              # Lattice root
├── config/                              # Configuration files
│   ├── config.json                      # Global config (can be committed to git)
│   └── config-local.json                # Machine-local config (gitignored; contains username, etc.)
├── spec/                                # Global specs (shared by all users and projects)
├── templates/                           # Templates
│   ├── spec/                            # Spec templates (frontend / backend / api, etc.)
│   └── registries/                      # Pulled remote template repositories
├── models/                              # RAG embedding model files
├── .cache/                              # Runtime cache (gitignored)
│   ├── lattice.db                       # SQLite database (project/task index)
│   ├── lattice.db-wal                   # SQLite WAL log
│   ├── lattice.db-shm                   # SQLite shared memory
│   ├── huggingface/                     # Hugging Face model download cache
│   ├── last-scan.json                   # Result of the most recent scan
│   ├── web-server.json                  # Web server runtime state
│   └── sensitive/                       # Sensitive cache (tokens/cookies/keys; never written into docs)
├── .trash/                              # Soft-delete recycle bin (deleted tasks/projects)
├── .sync-domains/                       # Domain sync mirrors (gitignored; one git repo per domain, directory name = domain hash)
│   └── <domain-hash>/                   # Read-only local materialized view of one domain, cloned per machine
├── .git/                                # Git repository (optional; versions ~/.lattice)
├── .gitignore                           # Git ignore rules
└── users/                               # User data
    └── <username>/                      # Isolated by username
        ├── spec/                        # User-level specs (reused across projects)
        ├── projects/                    # Project data
        │   └── <project-id>/            # One project (directory name is the full prefixed ID)
        │       ├── project.json         # Project metadata (ID, name, paths, etc.)
        │       └── spec/                # Project-level specs (this project only)
        ├── tasks/                       # Task data
        │   └── <task-id>/               # One task
        │       ├── task.json            # Task metadata (status, associated projects, etc.)
        │       ├── prd.md               # PRD (goals, plan, file index)
        │       ├── progress.yaml        # Progress log (checkpoints)
        │       └── design.md            # Design discussion archive (optional)
        └── relations.json               # Project relation records
```

### Directory reference

| Directory/file | Purpose | Tracked by git |
|---|---|---|
| `config/config.json` | Global config (RAG model, template repositories, etc.) | Yes |
| `config/config-local.json` | Machine-local config (username, scan directories, etc.) | No (gitignored) |
| `spec/` | Global specs, shared by all users and projects | Yes |
| `templates/spec/` | Spec templates used by `ltc spec template apply`; built-in templates follow the `ltc init --lang` selection | Yes |
| `templates/registries/` | Remote repositories pulled by `ltc spec template pull` | Yes |
| `models/` | RAG embedding model files | No (large) |
| `.cache/` | SQLite database, model cache, runtime state, sensitive cache | No (gitignored) |
| `.trash/` | Soft-delete recycle bin | No |
| `.sync-domains/` | Domain sync mirrors (read-only local copies of experience packs, cloned per machine) | No (gitignored) |
| `.cache/sync-baseline/` | Domain sync baseline fingerprints (paths contributed by this machine at the last push) | No (under `.cache`) |
| `users/<user>/spec/` | User-level specs, reused across projects | Yes |
| `users/<user>/projects/` | Project registration data | Yes |
| `users/<user>/tasks/` | Task data | Yes |
| `users/<user>/relations.json` | Project relations (fork / dependency / shared component, etc.) | Yes |

### Hierarchy

Lattice organizes data into the following levels:

- **Root level**: config, global specs, templates, models, cache — shared infrastructure for all users
- **User level** (`users/<username>/`): isolated by username; contains that user's specs, projects, tasks and relations
- **Project level** (`projects/<project-id>/`): metadata and project-level specs for one project
- **Task level** (`tasks/<task-id>/`): metadata, PRD, progress log and design notes for one task

### Domain sync (dual-track model)

Lattice has two long-lived sync tracks with orthogonal use cases:

| | origin single repo (`ltc sync`) | Domains (experience packs, `ltc sync domain join`) |
|---|---|---|
| Use case | **One user, multiple machines**, full sync | **Multi-user collaboration**, selectively sharing experience |
| Scope | The entire `~/.lattice` primary data | `routes` allowlist (projects / tasks / specs) |
| Visibility | Your machines only | Visible to others |
| Data landing | Pull writes back to the primary directory | **Pull stops at the mirror** (`~/.lattice/.sync-domains/<hash>/`); reads merge through the unified data-source Provider and never write to primary data |

Key semantics:

- **Domain identity** = first 16 chars of `sha256(remote#branch)`; all identity calculations use the hash, labels are local notes only.
- **Consumption policy** (`use` in domain config, default `trusted`): `trusted` reads and applies constraints; `reference` reads without injecting constraints; `off` syncs the mirror without reading it.
- **Push policy** (`routes` in domain config): `"*"` for everything; `project:<glob>` / `user-spec:<glob>` / `global-spec:<glob>` for selective pushes; the default is read-only consumption (the safe default when joining an unfamiliar domain). Pushes are allowlisted and incremental: only your own contribution set is overwritten, and a baseline fingerprint stops propagation, so nobody else's content is deleted because of your push.
- **Shadowing rules** (read-time merge): local primary data > domains (domains ordered by the config array); shadowing keys are spec = relative path in the same namespace, task = task id, project = contract ID; domain data is always read-only.
- **Conflict resolution** (also applies to AI workflows): the spec priority order is unchanged (project > user > global). Within the same level and path, local data and the current user win. A shadowed domain version can be read directly with `ltc spec show <name> --source <hash8>`.
- Config location: `sync.domains` in `config-local.json` (array order is the shadowing priority).

> **Sensitive information convention**: do not record tokens, cookies, keys or other secrets in specs, PRDs, checkpoints or other documents. When sensitive information must be captured, write it to a separate txt/md file under `~/.lattice/.cache/sensitive/` (name the file after the source task or spec) and reference only the file path from the document.

### `lattice.json` in the project root

For every registered project, Lattice creates a `lattice.json` file in the project root:

```json
{
  "id": "f92c45e0d902f03b"
}
```

This `id` is the project's `legacy:` ID (the highest-priority identity). Lattice uses it together with git fingerprints (first commit SHA, git remotes) to identify the project.

> `ltc link` creates this file; Git projects registered by `ltc scan` do not get one (they are identified by git fingerprints).

## Configuration

Lattice has two configuration files under `~/.lattice/config/`:

| File | Purpose | Tracked by git |
|---|---|---|
| `config.json` | Global config, shareable across machines | Yes |
| `config-local.json` | Machine-local config, including username and machine-specific data | No (gitignored) |

The two files are merged into the effective config: `config.json` provides global defaults, and `config-local.json` overrides machine-specific values.

### Global config (`config.json`)

```json
{
  "version": "0.1.0",
  "rag": {
    "embedding": {
      "modelId": "Xenova/bge-small-zh-v1.5",
      "dimension": 512,
      "dtype": "q8",
      "pooling": "mean",
      "queryPrefix": "为这个句子生成表示以用于检索相关文章：",
      "remoteHost": "https://huggingface.co/",
      "remotePathTemplate": "{model}/resolve/{revision}/",
      "localModelPath": "~/.lattice/models",
      "cacheDir": "~/.lattice/.cache/huggingface",
      "allowRemoteModels": true,
      "allowLocalModels": true,
      "proxy": ""
    }
  }
}
```

Configuration reference:

| Option | Default | Description |
|---|---|---|
| `version` | `"0.1.0"` | Config file version |
| `registryTemplates` | — | List of remote template repository URLs |
| `rag.embedding.modelId` | `Xenova/bge-small-zh-v1.5` | Embedding model used by RAG search |
| `rag.embedding.dimension` | `512` | Vector dimension; inferred automatically for known models |
| `rag.embedding.dtype` | `q8` | Model precision (`fp32` / `fp16` / `q8` / `int8`) |
| `rag.embedding.pooling` | `mean` | Pooling strategy (`mean` / `cls`) |
| `rag.embedding.queryPrefix` | Chinese BGE query prefix | Query-side prefix; depends on the selected model |
| `rag.embedding.documentPrefix` | `""` | Document-side prefix; E5 models use `passage: ` |
| `rag.embedding.remoteHost` | `https://huggingface.co/` | Model download host (can be overridden with `HF_ENDPOINT`) |
| `rag.embedding.remotePathTemplate` | `{model}/resolve/{revision}/` | Remote model path template |
| `rag.embedding.localModelPath` | `~/.lattice/models` | Local model storage path |
| `rag.embedding.cacheDir` | `~/.lattice/.cache/huggingface` | Model download cache directory |
| `rag.embedding.allowRemoteModels` | `true` | Allow downloading models remotely |
| `rag.embedding.allowLocalModels` | `true` | Allow using local models |
| `rag.embedding.proxy` | `""` | Proxy used when downloading models |

`ltc init` offers the built-in embedding presets in interactive terminals; use `ltc init --model <id>` for non-interactive setup. The preset also sets `dimension`, `dtype`, `pooling` and the query/document prefixes. For custom models, switching models requires `--dimension`; `--query-prefix` / `--document-prefix` default to empty so old model prefixes are not reused. The same applies to `ltc config set` when the model ID is not a built-in preset; set `rag.embedding.dimension` explicitly before rebuilding. `ltc config set rag.embedding.modelId` applies the same preset fields automatically; `ltc config unset rag.embedding.modelId` clears them and falls back to the default model. After switching models, run `ltc rag rebuild` to rebuild the index. The Web configuration panel shows the effective embedding defaults and applies the same presets when you switch models. For custom models, it prompts for the vector dimension and query/document prefixes. After a model switch it shows whether the model is installed and reminds you to run `ltc rag rebuild`; the RAG admin tab also flags when the configured model differs from the indexed model. `ltc config set` reports the same install status after saving.

> If model downloads fail in mainland China, set `rag.embedding.proxy` or switch the mirror through the `HF_ENDPOINT` environment variable.

### Machine-local config (`config-local.json`)

```json
{
  "username": "myname",
  "gitEnabled": true,
  "scanDirs": [
    "~/projects",
    "~/work"
  ]
}
```

Configuration reference:

| Option | Default | Description |
|---|---|---|
| `username` | — | Current username (set by `ltc init`, required) |
| `scanDirs` | — | Default directories scanned by `ltc scan` |
| `gitEnabled` | `true` | Whether to enable git management for `~/.lattice/` |
| `gitRemote` | — | Remote URL of the `~/.lattice/` git repository |
| `language` | `auto` | Document language injected into AI clients: `auto` (system locale) / `zh` / `en`; re-run `ltc init` after changing it |
| `registryTemplates` | — | Machine-level remote template repository URLs (override global) |

> `config-local.json` is ignored by `.gitignore` and is not committed. Re-run `ltc init` when switching machines.

### `LATTICE_HOME` environment variable

By default, Lattice uses `~/.lattice/` as its root. Set the `LATTICE_HOME` environment variable to override it:

```bash
# Use a custom directory
export LATTICE_HOME=/data/my-lattice

# Typical uses: tests / CI / multiple isolated instances
LATTICE_HOME=/tmp/test-lattice ltc init
```

> When `LATTICE_HOME` is set, every path (config / spec / users / cache, etc.) is based on that directory.

### Using the `ltc config` command

```bash
# Show the full config (global scope by default)
ltc config show

# Show machine-local config
ltc config show --scope local

# Show only values that differ from defaults
ltc config show --diff-defaults

# Read a single value (dot path)
ltc config get rag.embedding.modelId

# Set a single value
ltc config set rag.embedding.proxy "http://127.0.0.1:7890"

# Set a machine-local value
ltc config set scanDirs '["~/projects","~/work"]' --scope local

# Remove a single value
ltc config unset rag.embedding.proxy
```

`ltc config show` includes resolved embedding defaults; `--diff-defaults` still shows only explicitly configured differences.

`--scope` values:

- `global` (default): operate on `config.json`
- `local`: operate on `config-local.json`
