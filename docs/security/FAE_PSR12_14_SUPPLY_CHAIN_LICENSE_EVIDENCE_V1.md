# FAE PSR-12 / PSR-14 — Supply-Chain Hygiene and License

Status: candidate complete pending canonical verification, CodeQL verification and integration  
Source revision: `b4925310c8241f9f15d07f00225c44c9df17c05b`

## PSR-12 — Supply-chain and public-repo hygiene

The baseline now has four complementary controls:

- **Dependabot** — weekly GitHub Actions, npm and Docker update discovery;
- **CodeQL** — JavaScript/TypeScript static-analysis signal;
- **public-repo hygiene guard** — executable least-privilege/workflow/secret-pattern policy;
- **existing hostile/fuzz/differential gates** — remain authoritative for adversarial evidence.

Scanners do not replace hostile testing.

### Dependency inventory

- `/sovereign-forge/node`: no external npm dependencies.
- `/lab/post-quantum-signatures`: exact direct versions `@noble/post-quantum@0.7.1` and `@noble/hashes@2.4.0`; shadow-only.
- GitHub Actions: 44 baseline workflows reviewed before adding CodeQL.
- Container base: `node:22-bookworm-slim`.

### Least privilege

All baseline workflows reviewed declare explicit permissions.

The default expectation is `contents: read`. Exactly three WAN workflows are allowed `issues: write` for ephemeral test coordination/markers. CodeQL alone is allowed `security-events: write`. The executable guard fails on any unreviewed write permission, `write-all`, `pull_request_target`, or direct `secrets.*` reference.

### Secret prevention

Canonical CI scans repository text for high-signal classes including PEM private keys, GitHub tokens, AWS access keys, Stripe live secrets and Slack tokens. This is deliberately described as defense-in-depth; passing it is not proof that no secret exists.

### Explicit residuals

- GitHub Actions generally use major-version refs rather than immutable commit SHAs. Floating `main`/`master`/`latest` refs are forbidden and Dependabot monitors the ecosystem.
- Docker base image digest pinning is routed to PSR-13 reproducible provenance.
- The PQ lab has exact direct npm versions but no committed lockfile; it is shadow-only and receives no active authority.

## PSR-14 — Explicit open-source license

FAE is licensed under **Apache License 2.0** through the repository-root `LICENSE`.

The choice is separate from security engineering. It provides a permissive open-source baseline with an explicit patent-license grant. No `NOTICE` file was invented, and the protected Sovereign Forge snapshot was left byte-identical.

## Exit condition

PSR-12 and PSR-14 become GREEN only after:

1. canonical verification executes the hygiene guard successfully;
2. the CodeQL workflow is accepted and completes successfully on the candidate;
3. the exact candidate integrates without stale binding.

On success, PSR-13 becomes READY.
