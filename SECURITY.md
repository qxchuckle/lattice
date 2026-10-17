# Security Policy

## Supported versions

Lattice is pre-1.0 software. Security fixes are applied to the latest released version of each package (`@qcqx/lattice-core`, `@qcqx/lattice-cli`, `@qcqx/lattice-web`) and to the latest VS Code extension build.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Use GitHub's private vulnerability reporting: go to the [Security tab](https://github.com/qxchuckle/lattice/security/advisories/new) of this repository and open a draft advisory. If you cannot use that channel, contact the maintainer via the GitHub profile [@qxchuckle](https://github.com/qxchuckle).

Helpful details:

- affected package(s) and version(s) (e.g. `@qcqx/lattice-core@1.28.0`, VS Code extension `0.1.0`)
- a minimal reproduction (command / steps / sample data)
- impact assessment (what an attacker gains, what preconditions exist)

You can expect an acknowledgement within a few days. Once a fix is available, we will publish it and credit you in the advisory unless you prefer to stay anonymous.

## Scope notes

- Lattice is local-first: there is no hosted service. Data lives in `~/.lattice`.
- The web workbench (`ltc web`) binds to localhost; treat exposed ports / configured remotes as part of your own threat model.
- The VS Code extension runs the core in-process and does not make network requests; sync features only talk to Git remotes you configure.
