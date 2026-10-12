# FAE — Sovereign Standalone Mining
## Build Colony Execution Plan

Status: **ACTIVE / EXECUTION-BOUND**
Run date: 2026-09-30
Canonical main: `3ae59d0d013af0ee518f3cfb73c5fcb08394b075`
Element 58 planning revision: `1efc495ab1c5b3c0439b519a401d89371eb188c7`
Build Colony: `17979869a85c9f5adf2cef2ceb589a07fcef6239`
General Execution: `ff510496136c0c35fa377f6962750f1fdfb84b8e`
Candidate branch: `build-colony/fae-sovereign-standalone-mining-001`

## 1. Evidence-bound problem

FAE already has browser-local Proof of Work, an independently operable Node.js reference node, a reward-address-bound template endpoint, a block-submission endpoint, and an isolated-node mining smoke test. What canonical main does not yet have is a first-class non-browser miner product.

The implementation target is therefore a product/capability gap, not a consensus-design gap.

## 2. Frozen invariants

- Browser != Miner != Wallet != Node.
- A standalone miner needs a selected node and public reward address, not spending authority.
- No seed phrase, private key, wallet passphrase, browser session, vault, or signing key is admitted.
- No implicit Wallet creation.
- Active public-testnet v4 mining semantics remain unchanged.
- Node/template/tip state remains authoritative.
- Remote plain HTTP is rejected by default; localhost HTTP remains usable for one-machine operation.
- Existing imported Forge snapshot integrity is preserved. Code-sharing aesthetics do not justify rewriting a hash-pinned source snapshot.
- Evidence decides terminal state.

## 3. Build graph

### SSM-00 — Boundary and source freeze
Freeze exact source, authority, protected snapshot constraints, selected write scopes, and forbidden actions.

### SSM-01 — Consensus-facing semantics baseline
Extract executable v4 semantics from browser miner and independent node: canonical JSON, double SHA-256, nonce binding, leading-zero target, template interpretation, reward-address binding, freshness, submission, stale rejection.

### SSM-02 — Canonical standalone mining core
Implement a small pure Node.js module for those already-active semantics. No network/product state in the pure hashing/validation layer.

### SSM-03 — CLI/headless product
Provide a Node.js 22+ executable equivalent to:
```sh
node standalone/fae-miner.mjs --node <endpoint> --address <faet1...>
```
It performs local Proof of Work and requires no Wallet.

### SSM-04 — Secret-free configuration and authored operations
Explicit opt-in persistence for node, public reward address and operational settings only. Represent CONNECTING, TEMPLATE_READY, MINING, WORK_ACCEPTED, WORK_REJECTED, NODE_UNAVAILABLE, RECONNECTING and STOPPED from real state.

### SSM-05 — Independent-node integration
Spawn the canonical independent reference node with sync disabled, mine from the standalone product, submit the real block, and verify reward balance for the supplied address.

### SSM-06 — Stale/reconnect/restart/shutdown
Test node loss and recovery, stale-template invalidation, pre-submit freshness, bounded backoff, SIGINT/SIGTERM and restart behavior. Fail closed on malformed protocol data.

### SSM-07 — Browser ↔ standalone parity vectors
Use independent WebCrypto and Node crypto reference computations to show identical canonical serialization, header+nonce digest, leading-zero interpretation and submission semantics for deterministic vectors. The browser snapshot remains unchanged unless a later semantics-preserving refactor is both necessary and admissible.

### SSM-08 — No-secret/security audit
Prove persistent config and CLI inputs contain no seed/private key/passphrase/signing authority; reject endpoint credentials and malformed reward addresses.

### SSM-09 — Canonical verification integration
Add syntax, parity, behavioral and real independent-node tests to the existing canonical verifier without weakening Forge snapshot checks.

### SSM-10 — Independent operator runbook
Document browser-free operation against local or selected admissible nodes, configuration, shutdown/restart, security model and failure states.

### SSM-11 — Terminal reconciliation
Evaluate every Definition-of-Done item against persisted evidence and emit only an evidence-supported terminal verdict.

## 4. Parallelism and serialization

Shared semantics are serialized:

```text
SSM-00 -> SSM-01 -> SSM-02 -> SSM-03
```

After the CLI exists, independent work may proceed concurrently:

```text
SSM-04 config/operations
SSM-05 local-node integration
SSM-07 parity vectors
```

Then:

```text
SSM-05 -> SSM-06
SSM-04 + SSM-07 -> SSM-08
SSM-05 + SSM-06 + SSM-07 + SSM-08 -> SSM-09
SSM-09 -> SSM-10 -> SSM-11
```

Parallelize independence. Serialize shared state.

## 5. Evidence gates

The run may not close from a script merely printing success. Required gates include:

1. deterministic core vectors;
2. independent browser/WebCrypto ↔ Node parity;
3. real CLI -> isolated independent-node mining;
4. real balance credit to the supplied reward address;
5. invalid address and malformed-template rejection;
6. stale-work replacement before submission;
7. disconnect/reconnect evidence;
8. graceful termination and restart evidence;
9. explicit secret-free configuration audit;
10. complete canonical verification on the candidate revision.

## 6. Protected-source boundary

Current canonical verification hash-pins the Sovereign Forge snapshot and also requires deployed browser `mining.js` to match the imported browser snapshot byte-for-byte. This run therefore does **not** modify that snapshot merely to force physical code reuse.

The first admissible implementation strategy is:

```text
active v4 semantics
        |
standalone mining core (pure, executable)
        |
CLI/headless adapter
        |
deterministic parity evidence against browser + node
```

If evidence later proves that browser source must import the new core to satisfy a real semantic property, that becomes a separately evidenced semantics-preserving refactor decision. It is not assumed in advance.

## 7. Authority ceiling

Authorized: software-only implementation, local/deterministic tests, source/static analysis, CLI/headless tooling, semantics-preserving mining-core work, parity evidence, isolated-node integration, documentation, security review, candidate branch and draft PR.

Not authorized: consensus/economics/mining-algorithm changes, DP6/DP7, wallet cryptography/address/transaction semantics changes, release/deployment/activation/mainnet, paid infrastructure, AWS/AFI/F2, destructive infrastructure actions, automatic merge.

## 8. Terminal rule

Only one of the following may be emitted after SSM-11:

- SOVEREIGN_STANDALONE_MINING_READY
- EXACT_TECHNICAL_GAP_IDENTIFIED
- ARCHITECTURAL_REFACTOR_REQUIRED
- EXTERNAL_EVIDENCE_GATE
- HUMAN_GATE
- INSUFFICIENT_EVIDENCE
