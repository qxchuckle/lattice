# CLI parameters: sync and multi-user

`ltc sync` / `ltc user` parameters. General conventions (`--force`/`--json`) in [command-reference.md#general-conventions].

## `ltc sync`

Sync data (origin single-repo multi-machine sync + domain experience-package collaboration). `--pull` / `--push` (origin single-repo only) / `--only <origin|domains>` (run only one track). This command **has its own action and subcommands**, so it does not accept `--json` (reports unknown option to stderr, exit code 1); the machine-readable exit for the domain list is `ltc sync domain list --json`.

By default origin runs first (if git is enabled), then each domain: pull all domains (even use=off keeps the mirror fresh) + push domains that have routes/fingerprints.

### `ltc sync domain` (domain = experience package: multi-user collaboration)

Domain (experience package) management.

- `join <remote> [--branch <name>] [--label <note>] [--route <rule>]... [--use trusted|reference|off] [--peek]`: associate a domain (experience package repo); default use=trusted, no routes = read-only consumption; --peek previews content without joining. join outputs a content summary (N users · M projects · K specs + global spec titles) and security warnings (same-name user data / global specs will take effect)
- `unlink <hash>`: remove the association (clears config + mirror + fingerprint; primary data untouched)
- `list [--json]`: domain list (array order = read-time shadowing priority; pushState derived state: read-only consumption / full push / selective push N entries)
- `route add <hash> <rule>` / `route remove <hash> <rule>`: add/remove push whitelist rules

**routes syntax** (configured independently per domain and per user; stored in config-local.json's `sync.domains`):

- `"*"`: full push (limited to four whitelisted content categories: `users/<me>/{projects,tasks,spec}` + global `spec/`; config/.cache/.trash etc. never enter a domain)
- `project:<glob>`: project match (all project ids + name, minimatch; on hit → project directory + associated tasks + project specs travel along)
- `user-spec:<glob>` / `global-spec:<glob>`: user-level/global spec relative path match

**Domain identity** = first 16 chars of `sha256(remote#branch)`; all identity operations always use the hash, label is a local note only. The mirror lives in `~/.lattice/.sync-domains/<hash>/` (an independent git repo; each machine clones independently and it is not synced through this repo).

**Core semantics (v3 read-time merge)**:

- pull stops at the mirror and **never lands in the main directory**; reads are merged through the unified data-source Provider (spec list/show, search, rag, context)
- Shadowing: local primary data > domains (domains ordered by the config array order); key = spec relative path in the same namespace / task id / project contract ID; domain data is always read-only (write operations hitting a domain object report "domain is read-only")
- `use` has three consumption tiers: `trusted` = read + constraints apply (default); `reference` = read-only, no constraint injection; `off` = sync the mirror only, never read
- push is whitelist-incremental: covers only one's own contribution set + baseline fingerprint propagation on exit (`~/.lattice/.cache/sync-baseline/<hash>.json`; if missing, conservatively delete nothing); **others' content is never deleted because of my push**
- Conflict (the mirror has unpushed commits and the remote has diverged): on `pull --rebase` failure, auto-abort escape + conflict list; zero contamination of primary data
- `ltc spec show <name> --source <hash8>`: read a shadowed domain version directly

## `ltc user`

Manage Lattice users: `list [--json] [--json-full] [--page-size <n>]` lists all users (`--json` is a columnar table with columns `name`/`current`) / `current [--json]` shows the current username (human output is a bare value for shell capture; `--json` outputs a JSON string) / `switch <name>` switches the current user / `create <name>` creates a user / `rename <old> <new>` renames (including database and filesystem) / `remove <name> [--force]` deletes a user.
