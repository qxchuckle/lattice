# Troubleshooting

**Must delegate to the `lattice-health` subagent (fall back to serial execution when unsupported). Diagnose only, do not fix.**

## Quick diagnosis

```bash
ltc doctor              # full check (read-only)
ltc doctor --fix        # check + auto-fix safe items
ltc doctor --migrate    # legacy field migration + DB backfill
```

## doctor check quick reference

| Check | Fix |
|---|---|
| Disk/database consistency | `doctor --fix` |
| Duplicate project detection | `project remove <extraID> -f` |
| lattice.json reference consistency | Confirm which ID to keep, then fix |
| Database field sync | `doctor --fix` |
| Git ignore config (.gitignore missing section) | `doctor --fix` auto-adds the section, or `ltc init` |
| Git-tracked files (files that should be ignored but are committed, e.g. .trash) | `git -C ~/.lattice rm -r --cached <dir>` then commit; fully clearing history requires filter-repo |
| Domain sync health (missing mirror / leftover rebase) | `ltc sync` pull to rebuild; for stubborn cases `sync domain unlink` then re-join |
| Orphan domain mirrors (directory exists but absent from config) | After confirming it is abandoned, `rm -rf ~/.lattice/.sync-domains/<hash>` (the mirror is regenerable) |
| Task-associated project validity | `doctor --fix` or `task update` |
| Task parent/child chain validity | `doctor --fix` |
| Project relation validity | `doctor --fix` |
| Project index (invalid paths) | `ltc scan` or cleanup |
| RAG/FTS index | `ltc rag rebuild` |

## Typical scenarios

| Scenario | Diagnosis | Fix |
|---|---|---|
| Missing projects (after DB rebuild) | `ltc doctor` to check disk/DB consistency | `doctor --fix` / `--migrate` |
| Multiple records for the same project | `ltc doctor` to check duplicate detection | Confirm the ID to keep → `project remove <extra> -f` |
| lattice.json does not match the registered ID | `cat lattice.json` + `project list --json` | Edit lattice.json or `unlink -f && link` |
| No/incomplete search results | `ltc rag status` + `ltc doctor` | `ltc rag rebuild` |
| Database corruption | Any command reports a SQLite error | Delete `~/.lattice/.cache/lattice.db*` → `doctor --fix` → `rag rebuild` |
| Domain pull conflict | `ltc sync` output includes pull-conflict + conflict list (auto-aborted to preserve the mirror's current state) | Manually resolve the conflict in `~/.lattice/.sync-domains/<hash>` then sync again; or unlink and re-join |
| Domain content not taking effect / invisible | `sync domain list` to check the use tier and mirror status | Change the tier when use=off; re-sync when the mirror is missing; retrieval takes effect only after `rag update` |
| Content accidentally pushed into a domain | Check the domain routes match scope | Narrow with `route remove` + delete locally + `ltc sync` (exit propagation automatically retracts my contributions) |

## AI troubleshooting decision tree

1. `ltc doctor` (full output)
2. Inspect stale/error items: disk/DB → `--fix` · duplicates/references → report to the user · RAG/FTS → `rag rebuild` · project index → ask the user
3. After fixing, run `ltc doctor` again to verify all green
4. If doctor itself errors → follow the database corruption flow
