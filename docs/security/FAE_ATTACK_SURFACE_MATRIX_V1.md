# FAE Attack-Surface Matrix & Invariant Registry v1

Status: PSR-03 candidate for integration  
Source revision: `83a6adff3a6232026e78321062fe58e68174d9cd`  
Build Colony revision: `17979869a85c9f5adf2cef2ceb589a07fcef6239`

Machine-readable registry: `docs/security/FAE_ATTACK_SURFACE_MATRIX_V1.json`

## Purpose

PSR-03 converts the PSR-01 white-box threat model and PSR-02 evidence inventory into an operational routing contract:

```text
attack surface
  -> mandatory invariants
  -> existing evidence
  -> known gaps
  -> owning downstream gate
```

A surface is not "covered" merely because tests exist. Missing evidence remains fail-closed.

## Invariant families

| Invariant | Requirement |
|---|---|
| I-CONS-01 | Invalid block/transaction never becomes canonical |
| I-MONEY-01 | Active maximum supply is never exceeded |
| I-MONEY-02 | Invalid reward/coinbase is never accepted |
| I-MONEY-03 | Spending cannot create value or reuse spent/reserved inputs contrary to active rules |
| I-AUTH-01 | Invalid signatures/bindings/authenticated authority are rejected |
| I-FORK-01 | Lower-work chain cannot replace a valid higher-work chain |
| I-MATURITY-01 | Active coinbase maturity cannot be bypassed; currently not an active-v4 rule |
| I-STATE-01 | Malformed external input cannot corrupt canonical durable state |
| I-RECOVERY-01 | Crash/restart/recovery cannot create/destroy value |
| I-MINING-01 | Stale or abandoned work cannot mutate consensus |
| I-DIFF-01 | Independent conforming implementations agree |
| I-KEY-01 | Seeds/private keys never enter CI/logs/fixtures/evidence/backend persistence |
| I-P2P-01 | Replay/tamper/unauthenticated peer traffic cannot gain authenticated authority |
| I-AVAIL-01 | Untrusted input cannot create avoidable unbounded resource amplification |
| I-SUPPLYCHAIN-01 | Release claims bind to exact reviewed source/provenance |
| I-AUTHORITY-01 | Candidate/shadow/lab code cannot silently become authoritative |

## Operational surface map

| Surface | Core invariants | Existing strongest evidence | Downstream owner |
|---|---|---|---|
| Consensus/state transition | CONS, MONEY, FORK, STATE, DIFF, AUTHORITY | authoritative-v4-core; partition recovery; canonical verify | PSR-05 |
| Wallet/keys/signatures | AUTH, KEY, DIFF | crypto-compat; client smoke | PSR-06 |
| Transaction/mempool | CONS, MONEY, AUTH, STATE, DIFF | authoritative core/state-transition evidence | PSR-05 + PSR-06 |
| Mining/templates/coordinator | MINING, AUTH, AUTHORITY, AVAIL | coordinator smoke; signed receipts; Mining Tip Sync Lab | PSR-09 |
| P2P/discovery/eclipse | P2P, AVAIL, CONS, AUTHORITY | P2P security; peer diversity; protocol-6 integration | PSR-07 |
| Fork choice/reorg/recovery | FORK, RECOVERY, STATE, MONEY, DIFF | 3-node recovery; differential reorg fuzz; hard-crash recovery | PSR-08 |
| Browser/frontend | KEY, MINING, AUTHORITY, AVAIL | client/crypto/coordinator smoke | PSR-09 |
| API/backend/coordinator | AUTH, STATE, AVAIL, AUTHORITY | coordinator runtime/signer; canonical verify | PSR-09 |
| Build/dependencies/supply chain | SUPPLYCHAIN, KEY, AUTHORITY | source hashes; canonical verify; reproducible release | PSR-12 + PSR-13 |
| Candidate/lab/activation boundary | AUTHORITY, CONS, SUPPLYCHAIN | shadow exclusion; v4 activation boundary | PSR-05 + PSR-12/13 |
| Disclosure/findings/regression | AUTHORITY, KEY | PSR-04 baseline | PSR-04 + PSR-15/16 |

## Routing rules

1. Every security finding must identify at least one attack-surface ID and one invariant ID.
2. Any plausible invariant violation is baseline-blocking until fixed or carried explicitly as a blocker.
3. A feasible vulnerability fix must leave an executable regression test.
4. Missing evidence never upgrades a surface to covered.
5. Lab/candidate evidence cannot silently satisfy active consensus or release authority.
6. Cross-surface findings may have multiple owners; one owner cannot waive another gate.
7. Static analysis and dependency scanners are inputs to the evidence set, not substitutes for hostile testing.

## Downstream frontier

Once PSR-03 is integrated, the following become independently dispatchable:

```text
PSR-05 Consensus/Economic
   ||
PSR-06 Wallet/Keys/Signatures
   ||
PSR-07 P2P/Eclipse
   ||
PSR-08 Persistence/Reorg/Recovery
   ||
PSR-09 Browser/API/Backend
```

PSR-10 then serializes the shared hostile-corpus/property/fuzz layer across those surfaces.

## Exit test

PSR-03 becomes GREEN only after this registry and its machine-readable counterpart pass repository validation and integrate on the bound source line. No security-readiness or mainnet claim follows from PSR-03 alone.
