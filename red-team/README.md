# FAE Red Team Learning System v0.0.1

Status: research-only, non-authoritative.

This package turns one-off adversarial exercises into a reproducible learning loop without letting previous findings contaminate active blind evaluations. It does not activate consensus, submit blocks, handle wallet keys, or certify mainnet readiness.

## Frozen contract

1. An exercise is declared as a campaign plus a versioned attack library.
2. Freeze resolves every attack, target commit, taxonomy version, engine version, seed and execution limit into one canonical lock.
3. The lock is content-addressed with SHA-256 and cannot be edited without invalidating its digest.
4. Run executes only the resolved lock. It does not consult a mutable attack catalog.
5. Learn emits review proposals. It never silently rewrites the regression corpus or the score.

## Learning layers

- Attack library: versioned, immutable attack definitions.
- Failure taxonomy: stable failure classes separated from individual tests.
- Regression corpus: only explicitly approved and reproducible discoveries.
- Deterministic mutation: seeded child cases with a verifiable parent lineage.
- Blind holdout: private cases remain outside Git; only commitments may be public.
- Cross-domain transfer: reusable attack primitives map across consensus, P2P, DAA/timestamps, persistence, coordinator, wallet/client, and release integrity.
- Fixed score calibration: severity weights and gates are frozen before execution.
- Attack genealogy: every mutation and promotion preserves origin and ancestry.
- Meta-red-team: the process attacks its own freeze, evidence, isolation, determinism, leakage and score monotonicity.

## Quick verification

From this directory:

    npm run verify

From a clean checkout of the FAE repository:

    npm run campaign:smoke

The smoke campaign binds itself to the exact target commit. A successful command is evidence that the encoded defensive regression resisted its attack. A green run remains HOLD for research; it is never automatic permission to activate consensus or launch mainnet.

## Blind-set boundary

The directory holdout/private is ignored. Private case contents, expected answers, reveal material and keys must never be committed. The public engine accepts commitments and produces blind submissions; scoring occurs only after a separate reveal verifies the commitment.

## Exit meanings

- 0: requested operation completed and its contract is valid.
- 1: a tested defense collapsed or a CLI operation failed.
- 2: evidence is incomplete, invalid, or inconclusive.

See DESIGN.md, THREAT_MODEL.md, and SECURITY.md before adding adapters or campaigns.
