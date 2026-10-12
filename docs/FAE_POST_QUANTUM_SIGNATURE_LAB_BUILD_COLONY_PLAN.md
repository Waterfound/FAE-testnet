# FAE Post-Quantum Signature Lab — Build Colony Execution Plan

Status: PLANNED / SHADOW ONLY  
Run date: 2026-09-18  
FAE source revision: `e4b5cb6fc0a3a374d40d2d11e38585abb974a3a7`  
Build Colony revision: `17979869a85c9f5adf2cef2ceb589a07fcef6239`  
Active gate class: `CAPABILITY_GAP`  
Authority ceiling: `RESEARCH_SHADOW_CANDIDATE_WRITE`

## 1. Purpose

Develop and evaluate a post-quantum signature migration path for FAE without changing the active FAE protocol.

The active implementation remains authoritative:

- wallet derivation and signing: Ed25519;
- transaction format: Transaction v2;
- address derivation: current `faet` scheme;
- public testnet consensus: unchanged;
- mainnet candidate authority: unchanged.

The Lab is research-only. It may generate code, tests, evidence, benchmarks and migration candidates, but it cannot activate a new signature rule or modify the active wallet/address/transaction formats.

## 2. Capability-gap evidence

At the pinned FAE source revision:

- `wallet-crypto.js` explicitly derives Ed25519 keys, uses the `FAIRYELF_ED25519_ADDRESS_V1` derivation domain and imports Ed25519 through WebCrypto.
- `sovereign-forge/node/authoritative/fae-v4-core.mjs` normalizes Transaction v2, uses the `FAIRYELF_TX_V2` signing domain, carries a single `public_key_spki` + `signature`, and verifies that signature through the current Ed25519-compatible Node crypto path.
- `tests/crypto-compat.mjs` protects deterministic Ed25519 recovery/compatibility.

Therefore the current system has a demonstrated migration capability gap: there is no validated post-quantum or hybrid signature path. The gap does not imply a defect in the active implementation.

## 3. Non-negotiable invariants

1. Ed25519 stays authoritative in active FAE until a separate explicit activation process exists.
2. Transaction v2 is not modified by this Lab.
3. Current wallet/address/public-testnet/consensus/mainnet-candidate state is not modified by Lab work.
4. Seed phrases and private keys never enter Build Colony evidence.
5. Independent-human-operator evidence is N/A by design for this Lab.
6. Independence is provided by method: separate implementation paths, separate verifier paths, pinned official vectors/corpora, deterministic reproduction and cross-implementation comparison.
7. Required runs are all-runs-must-pass. Failed runs remain evidence; selective retry cannot erase them.
8. No worker may self-promote a result to protocol authority.
9. No benchmark or correctness result is itself an activation decision.
10. Research may advance; activation may not.

## 4. Standards baseline

The standards package must pin, checksum and record the exact material used.

Primary standards:

- NIST FIPS 204 — ML-DSA.
- NIST FIPS 205 — SLH-DSA.

Because FIPS 204 currently carries an official planning note pointing to minor errata/potential future corrections, every Lab run must record the exact FIPS/errata state used. NIST ACVP material is also versioned and evolving, so vector/corpus revisions must be immutable inputs, not floating URLs.

Official vectors are necessary but not treated as exhaustive. The Lab must add independent malformed-input and mutation cases and use at least one independent verification path.

## 5. Colony work graph

### PQ-00 — Boundary freeze
Goal: make accidental activation structurally impossible.

Outputs:
- Lab authority manifest;
- forbidden-path list;
- active-code import/write guard;
- provenance binding to FAE source revision;
- explicit `activation_authorized=false`.

Gate:
- Lab can be deleted without changing the active network.

### PQ-01 — Standards and evidence pinning
Depends on: PQ-00.

Outputs:
- exact FIPS 204/FIPS 205 references;
- current errata state;
- exact ACVP/vector corpus revisions and hashes;
- parameter-set inventory;
- reproducible evidence manifest.

Gate:
- identical bytes can be reacquired/replayed from the manifest.

### PQ-02 — Implementation-independence selection
Depends on: PQ-00, PQ-01.

Goal: select at least two meaningfully independent implementation/verifier paths when feasible.

Evaluate:
- browser/WASM suitability;
- Node/native suitability;
- provenance and maintenance;
- standards conformance;
- deterministic testability;
- implementation diversity rather than two wrappers over the same core.

Gate:
- independence rationale recorded before differential claims are admitted.

### PQ-03 — ML-DSA primitive correctness
Depends on: PQ-01, PQ-02.

Matrix:
- ML-DSA-44;
- ML-DSA-65;
- ML-DSA-87.

Tests:
- key generation;
- deterministic/reproducible test modes where supported;
- sign/verify;
- tamper rejection;
- wrong-key rejection;
- malformed signatures;
- truncated/extended signatures;
- malformed public/private encodings;
- context/domain separation behavior;
- official vectors;
- differential implementation agreement.

Gate:
- all mandatory vectors/tests pass across the required implementation paths.

### PQ-04 — SLH-DSA diversity study
Depends on: PQ-01, PQ-02.

Goal: preserve cryptographic diversity without assuming operational suitability.

Tests:
- representative FIPS 205 parameter sets selected by a frozen rationale;
- sign/verify and negative tests;
- implementation agreement;
- signature/public-key/private-key size;
- latency and memory baseline.

Gate:
- enough evidence exists to compare SLH-DSA as a diversity option against ML-DSA without promoting it.

### PQ-05 — FAE hybrid transaction shadow
Depends on: PQ-03.

Initial candidate:
- Ed25519 + ML-DSA;
- both signatures required in the experimental hybrid verifier.

Research tasks:
- define a shadow transaction version/type distinct from active Transaction v2;
- canonical serialization;
- signature-domain separation;
- dual public-key representation;
- txid consequences;
- malformed hybrid envelopes;
- signature stripping resistance;
- downgrade resistance;
- explicit old/new version boundaries.

Gate:
- no shadow transaction can be accepted by active Transaction v2 parsing or vice versa by ambiguity.

### PQ-06 — Wallet derivation, recovery and migration shadow
Depends on: PQ-03.

Tasks:
- preserve the existing Ed25519 derivation exactly;
- derive PQ material through a new domain-separated path;
- test 24-word mnemonic + optional passphrase recovery;
- deterministic re-derivation;
- old-wallet import into a shadow hybrid representation;
- restart/persistence;
- corrupted backup/recovery rejection;
- no private material in evidence.

Gate:
- legacy wallet recovery remains byte/identity-compatible while PQ derivation is deterministic and domain-separated.

### PQ-07 — Adversarial downgrade/replay/stripping
Depends on: PQ-05, PQ-06.

Cases:
- remove Ed25519 component;
- remove PQ component;
- swap keys;
- swap signatures;
- replay between transaction versions;
- replay across signing domains;
- malformed length/encoding;
- partial hybrid object;
- old wallet presented as upgraded;
- upgraded wallet forced through legacy path;
- parser differential cases.

Gate:
- every unauthorized downgrade/replay/stripping attempt fails deterministically.

### PQ-08 — Independent differential verification
Depends on: PQ-03, PQ-04, PQ-05, PQ-06, PQ-07.

Goal: replace “second human” with independent method.

Requirements:
- separate verifier code path;
- cross-implementation comparison;
- official-vector replay;
- independently generated negative cases;
- no shared verdict cache;
- all-runs-must-pass;
- no selective retry.

Gate:
- no unexplained verifier disagreement remains.

### PQ-09 — Resource economics
Depends on: PQ-03, PQ-04, PQ-05, PQ-06.

Measure:
- key sizes;
- signature sizes;
- transaction-byte growth;
- block payload implications;
- mempool/storage implications;
- network transfer implications;
- keygen/sign/verify latency;
- CPU;
- RAM;
- initialization/WASM cost;
- browser/runtime compatibility.

Compare at minimum:
- Ed25519 baseline;
- hybrid Ed25519 + ML-DSA-44/65/87 candidates;
- selected SLH-DSA diversity candidates.

Gate:
- exact measured cost matrix exists; no candidate wins by theory-only argument.

### PQ-10 — End-to-end shadow lifecycle
Depends on: PQ-08, PQ-09.

Exercise:
- create/recover wallet;
- derive keys;
- build hybrid shadow transaction;
- sign;
- serialize;
- submit to isolated shadow mempool;
- restart;
- reload;
- verify;
- reject mutations;
- replay corpus;
- compatibility across supported Node/browser runtimes.

Gate:
- deterministic lifecycle replay with frozen artifacts and zero active-network authority.

### PQ-11 — Software-only ceiling verdict
Depends on: PQ-10.

Produce:
- evidence ledger;
- unresolved-boundary list;
- candidate comparison;
- migration risks;
- exact reasons for any blocked item;
- frozen software-only verdict.

Allowed terminal verdicts:
- `MIGRATION_PATH_TECHNICALLY_VIABLE_IN_SHADOW`;
- `INSUFFICIENT_JUSTIFICATION_FOR_ACTIVATION`;
- `BLOCKED_BY_UNRESOLVED_EVIDENCE`.

Important: the first verdict still does not authorize activation.

### PQ-12 — Physical-device evidence
Depends on: PQ-11.

Optional evidence upgrade, not a software-development blocker.

Potential devices:
- iPhone;
- iPad.

Measure:
- keygen;
- sign;
- verify;
- memory pressure where measurable;
- thermal/latency behavior;
- browser runtime behavior.

This package requires user/device participation only when the software ceiling has already made the measurements valuable.

## 6. Parallelization strategy

Build Colony should parallelize only independent work.

Wave A:
- PQ-00.

Wave B:
- PQ-01.

Wave C:
- PQ-02.

Wave D, parallel:
- PQ-03;
- PQ-04.

Wave E, parallel after PQ-03:
- PQ-05;
- PQ-06.

Wave F:
- PQ-07.

Wave G, parallel:
- PQ-08;
- PQ-09.

Wave H:
- PQ-10.

Wave I:
- PQ-11.

Wave J, optional external evidence:
- PQ-12.

Shared-state integration remains serialized.

## 7. Execution discipline for every package

Each package must carry:

- immutable FAE source revision;
- immutable standards/vector inputs;
- objective;
- dependencies;
- write scope;
- forbidden actions;
- evidence gates;
- builder result digest;
- verifier decision bound to that exact result;
- integrator action bound to the verified revision;
- unresolved failures preserved in the ledger.

Builder != Verifier != Integrator as logical roles, even when one physical machine performs all roles sequentially.

## 8. Re-run and escalation policy

After each wave:

1. recompute the active boundary;
2. run Build Colony work selection again;
3. stop saturated routes after two distinct same-boundary zero-delta attempts;
4. use DI only when the boundary is unclassified or independent workers repeat an unexplained boundary;
5. use CII only when a generalizable system improvement is actually supported by evidence;
6. do not invent more Lab work merely to keep engineering moving.

## 9. What does not wait for the user

PQ-00 through PQ-11 are designed to advance without human participation, subject only to normal tool/runtime availability.

The user is not required for:
- primitive implementation;
- vector testing;
- negative/adversarial testing;
- differential verification;
- wallet/transaction shadow design;
- migration/recovery logic;
- resource benchmarks on available software runtimes;
- evidence freezing;
- software-ceiling verdict.

Human/device participation is reserved for PQ-12 if physical-device evidence becomes decision-relevant.

## 10. Activation boundary

This Lab has no activation package.

A future activation discussion would require a new explicit gate outside this plan, with a new authority decision and a separate evaluation of consensus/address/wallet migration. Build Colony may prepare evidence for such a decision but cannot make it.

## 11. Next executable action

Begin PQ-00 and PQ-01 only:

1. create the isolated Lab skeleton and authority manifest;
2. pin the standards/errata/vector corpus;
3. add guards proving active FAE files are untouched;
4. verify those artifacts independently;
5. only then dispatch implementation selection and primitive work.

No cryptographic replacement or active-protocol edit should precede those two gates.
