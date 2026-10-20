# Spec Workflows

spec concept/levels/full-text reading/capture/writing. Other documents reference this one without repeating it.

## Spec Definition

Records reusable information that helps understand the project and complete tasks. Core test: **will it still be needed the next time you enter this project?**

Content: behavioral constraints · project knowledge (architecture/modules/domain) · process patterns · experience details · trial-and-error accumulation

Specs are not always right — cross-verify against code when they conflict, and ask the user if necessary.

**Before concluding "the spec is stale / does not match the code", you must first verify that the working tree can represent that content**: `git branch --show-current` + `git status --short` + whether the content comes from an unmerged branch, uncommitted changes or a parallel task. Absent from the working tree ≠ the spec is wrong — when multiple tasks share one repo, the spec often describes an implementation landing on another branch; changing the spec based on that = deleting a convention someone else is writing. Violation check: concluding "the spec is stale" without a branch / merge-status verification record this round → the conclusion is invalid; verify first or ask the user.

## Levels

`project-level > [parent project > ancestors >] user-level > global-level`

| Level | Path | Applies to |
|---|---|---|
| project-level | `~/.lattice/users/<u>/projects/<id>/spec/` | current project |
| user-level | `~/.lattice/users/<u>/spec/` | cross-project |
| global-level | `~/.lattice/spec/` | multi-user multi-project |

Conflicts: nearer overrides farther; same-name conflicts notify the user. When sync domains are associated: for same-level same-path conflicts, the local data source and current user win (local > domain; across domains, by `sync.domains` array order); domain specs are read-only, and `spec show <name> --source <hash8>` can directly read a shadowed domain version. user/global must include `## Scope`.

## Read Related Specs in Full by Task Topic

**Must delegate to the `lattice-spec-digest` subagent (fall back to serial when unsupported).**

**Dynamic and continuous, not one-off**. Read a batch at kickoff, and read more when new modules/concepts appear during implementation. Err on the side of reading more.

**Select**: select from `ltc context` headings + descriptions + paths (unsure → read) + `ltc search "<keywords>" --json` for semantic gap-filling (results include paths)

**Read**: `read_file` the full text at the selected spec path (context / search output already includes paths; partial reads forbidden) → verify freshness → extract constraints

**Link**: `ltc task ref-spec <task-id> <spec-id>`

## Capture Criteria

| Tier | Condition |
|---|---|
| **Must write** | user explicitly states a behavioral rule / user proactively provides project knowledge |
| **Recommended** | core test passes (still needed next time) |
| **Don't write** | one-off requirement / unverified guess / purely task-level detail |

### Based on Checkpoint Type

| Type | Condition | Level |
|---|---|---|
| `correction` | long-term behavioral norm (including trial and error) → mandatory | project/user-level |
| `constraint` | reproduced in ≥2 tasks → mandatory; first occurrence per recommendation | project → promote to user on reproduction |
| `context` | business/architecture background → knowledge type | project-level |
| `assumption` | confirmed and general → elevate to a rule | depends on content |

`issue` + solution = trial-and-error spec. If it fits → proactively ask the user.

## Write Flow

1. Preparation: `ltc context` + `ltc spec list --scope <level>` + review the conversation
2. Check existing: `ltc spec show <related>`, prefer supplementing over duplicate creation
3. Conflict detection: contradictions at the same level and adjacent levels → notify the user
4. Write: one topic per file · specific and actionable · user/global must include `## Scope` · **sensitive information → `~/.lattice/.cache/sensitive/`**
5. Metadata: after editing the body run `ltc spec migrate`; if only frontmatter changed use `ltc spec set`
6. Second review + `ltc rag update`

## Template Commands

```bash
ltc spec template list / apply <name> / pull <repo> / sync / registry list
```
