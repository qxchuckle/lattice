# Spec Template Repository Layout

> English | [简体中文](./spec-template-registry.zh-CN.md)

This document explains how Lattice pulls and imports custom spec templates from Git repositories, and how a template repository should be organized.

## Supported commands

```bash
# Pull a template repository during initialization
lattice init --registry-template <git-url>

# Pull a new template repository
lattice spec template pull <git-url>

# Sync registered template repositories
lattice spec template sync

# List registered template repositories
lattice spec template registry list

# Remove a registered template repository
lattice spec template registry remove <git-url>
```

`lattice init --registry-template <git-url>` pulls the template repository during initialization and writes its URL to the `registryTemplates` field in the global config `~/.lattice/config/config.json`.

## Built-in templates

`ltc init` installs the built-in templates in the document language selected by `--lang` / `config-local.language` (`zh` or `en`) into `~/.lattice/templates/spec/<template>/`. `ltc spec template sync-builtins` uses the same setting. Existing templates are preserved unless you choose to overwrite them; `-f` / non-interactive runs skip conflicts.

## Repository layout convention

```text
my-spec-templates/
├── README.md
├── LICENSE
└── spec/
    ├── frontend/
    │   ├── template.json
    │   ├── index.md
    │   ├── component-guidelines.md
    │   └── state-management.md
    ├── backend/
    │   ├── template.json
    │   ├── index.md
    │   ├── layering.md
    │   └── database-guidelines.md
    └── mobile/
        ├── template.json
        ├── index.md
        └── navigation.md
```

- Lattice looks for the `spec/` directory in the repository, uses it as the template root, and treats each first-level directory as a template name.

## How to write a single template directory

A template directory should look like this:

```text
frontend/
├── template.json
├── index.md
├── component-guidelines.md
├── directory-structure.md
├── hook-guidelines.md
├── quality-guidelines.md
├── state-management.md
└── type-safety.md
```

Notes:

- The outermost `frontend/` is the template name.
- Every `*.md` file under the template directory is imported recursively.
- Do not add another same-named directory inside it.

## `template.json` specification

`template.json` is optional and currently supports two fields:

```json
{
  "description": "Frontend conventions template (for React / Vue projects)",
  "defaultScope": "user"
}
```

Field reference:

- `description`
  - Template description.
  - Shown by `lattice spec template list`.
- `defaultScope`
  - Allowed values: `project`, `user`, `global`.
  - Controls the default scope the template is applied to.

If omitted:

- `description` falls back to `Custom template <template-name>`.
- `defaultScope` defaults to `project`.

## Markdown content convention

Each Markdown file should use frontmatter:

```md
---
title: Component conventions
tags: [frontend, components]
---

# Component conventions

## Component responsibilities

<!-- Write the conventions here -->
```

Recommendations:

- Use `title`.
- Use `tags`.
- Keep one topic per file.
- Do not pack unrelated rules into one Markdown file.

## Where templates land after application

### If the template defaults to `project`

It is written to:

```text
~/.lattice/users/<username>/projects/<project-id>/spec/
```

For example:

```text
~/.lattice/users/alice/projects/p123/spec/frontend/index.md
~/.lattice/users/alice/projects/p123/spec/frontend/component-guidelines.md
```

### If the template defaults to `user`

It is written to:

```text
~/.lattice/users/<username>/spec/
```

For example:

```text
~/.lattice/users/alice/spec/frontend/index.md
~/.lattice/users/alice/spec/frontend/component-guidelines.md
```

## Best practices

### 1. Use `spec/` as the repository template root

Recommended:

```text
repo/spec/<template-name>/...
```

This keeps the repository clear and leaves room for READMEs, examples and scripts later.

### 2. Keep template names stable; avoid renaming

The template name is what users type:

```bash
lattice spec template apply frontend
lattice link --template frontend,backend
```

Once published, keep the name stable.

### 3. One template, one topic domain

Recommended:

- `frontend`
- `backend`
- `mobile`
- `observability`
- `security`

Not recommended:

- `all-in-one-enterprise-template`

### 4. Prefer several small files over one huge Markdown file

Split the template into:

- `index.md`
- Topic-specific subdocuments

This works better with progressive AI reading.
