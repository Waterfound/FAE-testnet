# Design contract — v0.0.1

## Authority boundary

The engine is an observer and test orchestrator. It has no consensus authority and must not be imported by an authoritative FAE module. Campaigns in v0.0.1 use offline regression commands only.

## State transitions

    draft campaign -> frozen lock -> run report -> learning proposals
                                      |
                                      +-> reviewed promotion -> regression corpus

Blind cases follow a separate path:

    private case -> public commitment -> blind request -> submission
                     private reveal ---------------------> score

No transition is automatic. In particular, a finding cannot become a regression merely because it appeared in one run.

## Freeze

The freeze resolves catalog references and records:

- engine, schema, taxonomy and score-policy versions;
- exact target Git commit and clean-tree state;
- full attack definitions and their digests;
- deterministic seed, order, repetitions and execution limits;
- campaign scope, exclusions, blind boundary and authority boundary.

The lock digest is computed over canonical JSON with lock_digest omitted. The runner recomputes it before executing anything.

## Execution

Commands run without a shell, from a path contained inside the frozen target root, with a minimal environment, bounded duration, and bounded output. The v0.0.1 allowlist is node, npm, npm.cmd, python3, and bash. Campaign definitions must declare offline intent; the engine does not claim to provide a kernel network sandbox.

Reports retain outcome, duration, exit metadata, raw-output hashes, a semantic result hash and evidence completeness. v0.0.1 does not copy raw process output into reports. Reports never include the full process environment.

## Learning

Learning is proposal-only. A proposal includes failure class, severity, evidence references, reproducibility count, parent attack, proposed regression ID, and a content digest. Promotion requires explicit reviewer identity, a retired/non-blind origin, and reproducibility at or above policy.

## Novelty

Active holdouts are excluded from learning and mutation. Each private case includes a secret high-entropy commitment nonce. The public side knows case IDs, domains and salted commitments only. Expected outcomes and nonces stay in the reveal. Duplicate checks use fingerprints after reveal and cannot prove secrecy against an operator who deliberately exposes private material.

## Versioning

v0.0.1 freezes the contracts, not the final intelligence of the system. Later versions may add richer adapters and mutation operators, but old locks and reports remain independently verifiable.
