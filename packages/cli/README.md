# @qcqx/lattice-cli

> English | [简体中文](./README.zh-CN.md)

Lattice is a local-first engineering memory and workflow layer; the CLI is its entry point in the terminal and in AI agents. It wraps the domain capabilities provided by `@qcqx/lattice-core` into commands users can run directly.

## Install / update

```bash
npm install -g @qcqx/lattice-cli
```

After installation, invoke it through `lattice` or `ltc`.

## Quick start

Run `init` to initialize. Re-run `init` after updating `@qcqx/lattice-cli`.

```bash
ltc init

✔ Enter your username:
# ......
✔ Select a RAG embedding model: Xenova/bge-small-zh-v1.5
✔ Download the embedding model now? No
✓ Lattice initialization complete!
```

The embedding model can also be selected non-interactively with `ltc init --model <id>`. The default is `Xenova/bge-small-zh-v1.5` (512 dimensions); other presets include MiniLM, multilingual E5 and BGE Base. For custom models, `--dimension` is required when switching models; `--query-prefix` / `--document-prefix` default to empty.

In any agent, type `/` and search for `start`, run the command, and start a new task.

The AI then enters the Lattice workflow and manages the task, project and lifecycle:

1. Read the current project's engineering memory and context (specs, recent tasks, related memory).
2. Search whether similar tasks exist in this or other projects, and inspect their PRDs, progress, project relations and specs.
3. Decide whether a similar task is already in progress.
4. Decide whether this should be a subtask.

When the task is done, type `/` and search for `archive` to archive it. If reusable rules can be distilled, the AI will prompt you.

## Command overview

| Command | Description |
|---|---|
| `ltc init` | Initialize Lattice (includes the `init scan` scan subcommand) |
| `ltc link` | Register the current directory as a Lattice project |
| `ltc unlink` | Unregister the current project |
| `ltc scan` | Scan a directory tree for registrable projects |
| `ltc project` | Project management (list / info / where / merge / relation, etc.) |
| `ltc task` | Task management (create / start / checkpoint / complete / archive, etc.) |
| `ltc spec` | Spec management (list / show / template / conflicts, etc.) |
| `ltc context` | Aggregate and print the current project context (specs / active tasks / related memory) |
| `ltc status` | Current project status overview |
| `ltc search` | Hybrid semantic + full-text search |
| `ltc config` | Read and change configuration |
| `ltc rag` | RAG index management (status / update / rebuild) |
| `ltc sync` | Template repository sync |
| `ltc doctor` | Data health check and automatic repair |
| `ltc trash` | Recycle bin management (list / restore / purge) |
| `ltc user` | User management |
| `ltc web` | Start the web UI server |

See [`packages/core/public/templates/skills/en/command-reference.md`](https://github.com/qxchuckle/lattice/blob/master/packages/core/public/templates/skills/en/command-reference.md) for the full option reference.

## Architecture positioning

- **The CLI does not own domain logic**; it only parses arguments, handles interactive confirmation and formats output.
- All business capabilities come from `@qcqx/lattice-core`.
- Every executable command accepts `--force` by default so AI calls can skip interactive confirmation.

## Development

```bash
# Build
pnpm --filter @qcqx/lattice-cli build

# Type check
pnpm --filter @qcqx/lattice-cli check-types
```

## License

MIT
