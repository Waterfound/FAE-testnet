# FAE PSR-17 — Full Security Baseline Replay

Status: candidate pending dedicated replay + canonical + cross-Lab + CodeQL + exact-source integration  
Bound source: `6c0e6f84105d0670b6e41c866e58029ff2580cfa`

## Purpose

PSR-17 is the final replay gate before the public-code security verdict.

It does **not** add another security mechanism. It asks whether the entire security baseline still reproduces GREEN on one exact candidate without selective retry.

## Replay model

The dedicated PSR-17 runner performs, once each:

1. the complete PSR-15 17-case white-box campaign;
2. PSR-16 zero-finding closure against the fresh PSR-15 report;
3. the independent G2 Git-oracle verifier;
4. two detached clean-room source-release builds and byte comparison;
5. an exact digest pull for the locked container base plus one build of every protected Dockerfile derivative.

The workflow sets `cancel-in-progress: false`, contains no `continue-on-error` and has no retry mechanism.

A failed attack or replay cannot be erased by re-running only the failed case. A later full candidate run may supersede an earlier candidate only when the source binding itself changes and the stale history remains recorded.

## External checks on the same SHA

PSR-17 also requires the ordinary repository checks:

- `verify-canonical-source`;
- `cross-lab-integration-gate`;
- `codeql-security`.

CodeQL remains a signal only and cannot waive a campaign finding.

## Verdict boundary

PSR-17 GREEN does not itself declare the security baseline ready and grants no mainnet authority.

It only unlocks PSR-18, where the evidence must resolve to exactly one verdict:

- `BASELINE_READY_FOR_RECURRING_ASSURANCE`;
- `BLOCKED_BY_SECURITY_FINDINGS`;
- `BLOCKED_BY_MISSING_EVIDENCE`.

## Exit

PSR-17 becomes GREEN only if the dedicated full replay, canonical verification, cross-Lab gate and CodeQL all finish SUCCESS on the same exact candidate and the candidate integrates without stale binding.
