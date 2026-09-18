# FAE Public-Code Security Readiness — Build Colony Run

**Run:** `bc-fae-pcsr-20260918-001-r2`  
**Kind:** REAL_PLANNING_RUN  
**FAE source:** `a4f093e96767d6b58e350bf41935e81aedd689af`  
**Build Colony:** `17979869a85c9f5adf2cef2ceb589a07fcef6239`  
**Branch:** `colony/fae-public-code-security-readiness-002`

## Frozen principle

> FAE must remain secure even if the attacker knows 100% of the source code.

The workstream is deliberately bounded:

```text
bounded hardening project
  -> security baseline
  -> recurring Project Assurance
```

No permanent new security system is created.

## Rebinding note

The first binding was created against `d69ebf05895692760fc5c917a394c65b9709894c`, but FAE `main` advanced during the live run. The plan was therefore re-bound to `a4f093e96767d6b58e350bf41935e81aedd689af`; all baseline absences and supporting blob identities were rechecked before this branch was created. PR #119 is superseded by this binding.

## Evidence-bound starting point

At the frozen FAE source revision, the repository already contains reproducible verification, wallet/crypto compatibility tests, the Independent Node path, canonical source hashing, and an authoritative consensus/state-transition reference.

The following baseline public-security artifacts were checked at the frozen revision and were absent at their expected canonical paths:

- `SECURITY.md`
- explicit `LICENSE` / `LICENSE.md`
- `.github/dependabot.yml|yaml`
- dedicated `.github/workflows/codeql.yml|yaml`
- formal `docs/THREAT_MODEL.md` / `docs/SECURITY_THREAT_MODEL.md`

This is treated as an evidence-bound **CAPABILITY_GAP**, not as proof that the existing FAE security architecture is weak.

## Authority boundary

Build Colony may create candidate security documentation, tests, hostile corpora, fuzz/property infrastructure, CI/security-workflow candidates, dependency/release-hygiene candidates, and non-consensus observability required for verification.

It may **not** activate consensus rules, alter monetary policy, activate a transaction/wallet/address format, change public-testnet consensus behavior, access production secrets, authorize mainnet, or promote a candidate to authoritative state without independent verification.

## Global invariants

1. Maximum supply is never exceeded.
2. Invalid block reward / coinbase is never accepted.
3. Invalid signatures are never accepted.
4. Lower-work chain replacement cannot violate authoritative fork-choice.
5. Coinbase maturity cannot be bypassed.
6. Malformed external input cannot corrupt canonical state.
7. Crash/restart/recovery cannot create or destroy value.
8. Stale or abandoned work cannot mutate consensus state.
9. Independent conforming implementations agree on consensus result for the same valid history.
10. Private keys and seed phrases never enter Build Colony, CI, logs, fixtures, or evidence.
11. A fixed vulnerability becomes an executable regression test whenever technically feasible.
12. Static/dependency scanners remain defense-in-depth signals, never substitutes for adversarial verification.
13. Missing required security evidence fails closed.

## Dependency-bound program

| Gate | Work package | Depends on |
|---|---|---|
| PSR-00 | Boundary Freeze and Execution Binding | — |
| PSR-01 | Formal Public-Code Threat Model | PSR-00 |
| PSR-02 | Existing Security Gate and Evidence Inventory | PSR-00 |
| PSR-03 | Attack-Surface Matrix and Invariant Registry | PSR-01, PSR-02 |
| PSR-04 | Responsible Disclosure Baseline | PSR-01 |
| PSR-05 | Consensus and Economic Hostile Gates | PSR-03 |
| PSR-06 | Wallet, Keys and Signature Hostile Gates | PSR-03 |
| PSR-07 | P2P, Discovery and Eclipse Hostile Gates | PSR-03 |
| PSR-08 | Persistence, Reorg and Recovery Hostile Gates | PSR-03 |
| PSR-09 | Browser, Frontend, API and Backend Boundary Gates | PSR-03 |
| PSR-10 | Hostile Corpus, Property Testing and Fuzzing | PSR-05..09 |
| PSR-11 | Differential and Alternative-Implementation Verification | PSR-10 |
| PSR-12 | Supply-Chain and Public-Repo Hygiene | PSR-00 |
| PSR-13 | Reproducible Build and Release Provenance | PSR-02, PSR-12 |
| PSR-14 | Open-Source License Decision and Explicit License | PSR-00 |
| PSR-15 | Project Assurance White-Box Attack Campaign | PSR-04..13, excluding PSR-14 |
| PSR-16 | Finding Closure and Regression Promotion | PSR-15 |
| PSR-17 | Full Security Baseline Replay | PSR-14, PSR-16 |
| PSR-18 | Public-Code Security Baseline Verdict | PSR-17 |
| PSR-19 | Bounded Project Closeout and Recurring Assurance Handoff | PSR-18 |

## Parallelization

After the shared attack-surface/invariant contract is frozen, independent surfaces may be worked in parallel:

`PSR-05 || PSR-06 || PSR-07 || PSR-08 || PSR-09 || PSR-12 || PSR-14`

Shared state and evidence admission are serialized:

`PSR-03 -> PSR-10 -> PSR-11 -> PSR-15 -> PSR-16 -> PSR-17 -> PSR-18 -> PSR-19`

This follows the Build Colony rule: **parallelize independence; serialize shared state**.

## First execution block

After PSR-00 is integrated, the first real implementation frontier is:

```text
PSR-01 Formal Public-Code Threat Model
       ||
PSR-02 Existing Gate / Evidence Inventory
       -> PSR-03 Attack-Surface Matrix + Invariant Registry

PSR-01 -> PSR-04 SECURITY.md skeleton
```

The block must leave behind:

- formal white-box threat model;
- existing-gate/evidence ledger;
- attack-surface matrix;
- security invariant registry;
- `SECURITY.md` skeleton.

## Exit and handoff

The bounded project ends only if PSR-18 yields:

`BASELINE_READY_FOR_RECURRING_ASSURANCE`

The two fail-closed alternatives are:

- `BLOCKED_BY_SECURITY_FINDINGS`
- `BLOCKED_BY_MISSING_EVIDENCE`

A GREEN security baseline still grants **no mainnet authority**. PSR-19 then closes the extraordinary workstream and leaves only ordinary recurring Project Assurance, with deeper review for consensus, crypto, economics, and critical networking changes.


## Frontier execution — PSR-01 || PSR-02

Execution date: 2026-09-18  
Bound source: `a6721bb231471873ba069ab5bd6b2c8e5c6df92a`  
Branch: `colony/fae-public-code-security-psr01-02`

This is a real execution, not methodology-only.

Produced:

- `docs/security/FAE_PUBLIC_CODE_THREAT_MODEL_V1.md` — formal full-source white-box threat model;
- `docs/security/FAE_EXISTING_SECURITY_GATE_LEDGER_V1.json` — machine-readable exact-tree inventory;
- `docs/security/FAE_EXISTING_SECURITY_GATE_LEDGER_V1.md` — human-readable evidence/gap map.

Inventory at the bound source discovered 41 repository workflows and 100 test/lab assets under the PSR-02 criteria. Existence alone receives no PASS credit; canonical PR gates, content-inspected gates, specialized noncanonical evidence and path-only discovery are separated.

PSR-01 and PSR-02 become GREEN only after successful canonical verification and integration. On that integration, PSR-03 becomes READY and PSR-04 becomes READY from the PSR-01 dependency.


## Frontier execution — PSR-03 || PSR-04

Execution date: 2026-09-18  
Bound source: `eb8409573e3ee4c37b925817a474a1c6e5dd4410`  
Branch: `colony/fae-public-code-security-psr03-04-r2`

This is a real execution, not methodology-only.

The first PSR-03/04 candidate was prepared against `83a6adff3a6232026e78321062fe58e68174d9cd`, but `main` advanced by 13 commits before PR creation. The intervening diff was reviewed and was limited to Mining Tip Sync/browser mining plus the corresponding Forge hash. The frontier was therefore rebound instead of merging stale work.

Produced:

- `docs/security/FAE_ATTACK_SURFACE_MATRIX_V1.json`;
- `docs/security/FAE_ATTACK_SURFACE_MATRIX_V1.md`;
- `SECURITY.md`;
- `tests/public-code-security-contract.mjs`;
- canonical verification integration for the structural contract guard.

The registry freezes 16 invariant definitions across 11 attack surfaces. MTS-04/06 is admitted as specialized AS-04 mining evidence, not silently promoted to universal security proof.

PSR-03 and PSR-04 become GREEN only after successful canonical verification and integration.


## Frontier execution — PSR-05 || PSR-06 || PSR-07 || PSR-08 || PSR-09

Execution date: 2026-09-18  
Bound source: `9f5ab833946aaec9569a83c6dd5af35f0c33aa92`  
Branch: `colony/fae-public-code-security-psr05-09`

This is a real hostile-testing execution, not methodology-only.

New executable evidence:

- `tests/public-code-security-hostile-frontier.mjs` — deterministic attacks across consensus/economics, wallet/signatures, P2P/eclipse, reorg/recovery and browser/API boundaries.

Existing specialized evidence promoted into the canonical verification path:

- `sovereign-forge/tests/independent-node-v11-process-recovery.mjs`;
- `lab/mining-tip-sync/tests/mts-02-03.test.mjs`;
- `lab/mining-tip-sync/tests/mts-04-06.test.mjs`.

The hostile harness uses ephemeral cryptographic material only. It does not change runtime or consensus behavior.

PSR-05 through PSR-09 become GREEN only after the full canonical workflow succeeds and this exact candidate integrates. On success, PSR-10 becomes READY.


## Frontier execution — PSR-10 (current binding)

Execution date: 2026-09-18  
Bound source: `698f305895bca6e30a7ad6ded0da0a0e7b4274d4`  
Branch: `colony/fae-public-code-security-psr10-r3`

PSR-10 is a real execution. The candidate was rebound again because `main` advanced with MTS-08 lifecycle-resume hardening before PR creation. The intervening mining/browser changes were reviewed and MTS-08 is admitted as specialized lifecycle evidence.

The candidate contains 53 named malformed corpus cases and 1,984 deterministic generated property cases under seed `0xfae51010`, plus promoted reorg differential fuzz, difficulty/timestamp red-team, MTS-07 stress and MTS-08 lifecycle tests.

PSR-10 becomes GREEN only after the exact candidate passes the complete canonical workflow and integrates.
