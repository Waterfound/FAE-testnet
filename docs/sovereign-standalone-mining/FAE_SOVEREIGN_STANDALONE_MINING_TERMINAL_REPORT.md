# FAE — Sovereign Standalone Mining
## Terminal Reconciliation

Date: 2026-09-30  
Element: 58  
Executable candidate: `305e4ff670649b6c86dafc2bde7d3a74a63c0172`  
Candidate branch: `build-colony/fae-sovereign-standalone-mining-001`  
Draft PR: #270, stacked on planning PR #269  
Terminal verdict: **SOVEREIGN_STANDALONE_MINING_READY**

## Scope of the verdict

This is a technical candidate-readiness verdict inside the authority granted to Element 58. It is **not** a merge, release, deployment, activation, consensus change, DP6 decision, or mainnet authorization.

Canonical `main` remains unchanged until separately authorized integration.

## Evidence-bound result

A first-class Node.js 22+ standalone/headless miner now exists at:

```text
standalone/fae-miner.mjs
standalone/mining-core.mjs
```

The candidate can be used directly:

```sh
node standalone/fae-miner.mjs \
  --node <selected-node> \
  --address <public-faet1-address>
```

or installed locally from the repository as the `fae-miner` command through the dependency-free package in `standalone/`.

## Definition-of-Done reconciliation

1. **Real standalone/headless miner — PASS.** The CLI executes local Proof of Work outside the browser.
2. **Browser not required — PASS.** Canonical verification runs the CLI as an independent Node.js process.
3. **Wallet not required — PASS.** The miner takes a public reward address directly and imports no Wallet implementation.
4. **Private keys not required — PASS.** No signing or spending authority is accepted by the mining path.
5. **Public reward address is sufficient — PASS.** Real isolated-node evidence credits the block reward to the supplied `faet1...` address.
6. **Node is selectable — PASS.** The operator provides `--node`; loopback HTTP is supported and remote endpoints require HTTPS.
7. **Local independent node works — PASS.** Canonical verifier step 26 mined a real block through the new standalone product against `sovereign-forge/node/fae-node.mjs`.
8. **Consensus-facing parity demonstrated — PASS.** Deterministic tests compare standalone hashing with independent Node crypto and WebCrypto reference computations for canonical serialization, header+nonce hashing, leading-zero target interpretation, address binding and submission shape. The protected Forge snapshot remained byte-identical and hash-valid.
9. **Restart/reconnect/error behavior fail-safe — PASS.** Tests cover bounded 5xx reconnect, stale-template replacement, malformed-template rejection without submission, invalid reward address rejection, cooperative SIGINT/SIGTERM stop, and process restart with fresh node/template acquisition.
10. **Configuration requires no secret material — PASS.** Persisted configuration is explicit, allow-listed and contains only endpoint, public reward address and operational settings; secret-bearing field names are rejected.
11. **Independent-operator documentation exists — PASS.** `standalone/README.md` documents browser-free operation, local installation, selected-node use, secret-free configuration, states, shutdown/restart and authority boundaries.
12. **Sovereignty principles preserved — PASS.** No browser, proprietary service, hosted wallet, paid infrastructure, ChatGPT runtime, Vercel dependency or specific permanent operator is structurally required by the miner.

## Verification evidence

Executable SHA `305e4ff670649b6c86dafc2bde7d3a74a63c0172`:

- `verify-canonical-source` run **36752867795**, attempt 2: **SUCCESS**.
- Standalone package/core/operational behavior step: **SUCCESS**.
- Real independent-node standalone mining step: **SUCCESS**.
- Protected Sovereign Forge snapshot verification: **SUCCESS**.
- CodeQL run **36752868064**: **SUCCESS**.
- PSR15 project assurance run **36752867828**: **SUCCESS**.
- PSR16 finding closure run **36752867990**: **SUCCESS**.
- PSR17 full security baseline run **36752867853**: **SUCCESS**.
- PSR18 security verdict run **36752867895**: **SUCCESS**.
- Public-code recurring assurance run **36752868047**: **SUCCESS**.
- Cross-lab integration gate run **36752867694**: **SUCCESS**.

### Transient verification event

Attempt 1 of run 36752867795 failed only at the pre-existing three-node partition-recovery step with `UND_ERR_SOCKET: other side closed`, after all standalone-specific gates and the real standalone independent-node mining test had already passed.

No candidate source modified the reference-node or partition-recovery implementation. A no-code-change rerun was admitted. Attempt 2 passed the same partition-recovery step and the complete canonical verifier. The first result is therefore retained as transient verifier evidence, not erased and not treated as a demonstrated standalone regression.

## Architectural reconciliation

The preferred architecture called for a canonical mining core with browser and headless adapters where technically appropriate.

The current candidate introduces a pure executable standalone mining core and proves its consensus-facing semantics against both browser/WebCrypto-style and reference-node/Node-style computations.

The existing browser mining source is an imported, hash-pinned Sovereign Forge snapshot and canonical CI requires the deployed browser mining source to remain byte-identical to that snapshot. This run did not rewrite that protected source merely to force physical code reuse.

Therefore the property established is:

```text
same active v4 mining semantics
+ deterministic cross-implementation parity
+ protected browser snapshot unchanged
+ first-class standalone product
```

No evidence in this run requires a browser-source refactor to satisfy Element 58.

## Authority reconciliation

Consumed:
- isolated candidate branch writes;
- software-only implementation;
- deterministic tests;
- local independent-node integration in CI;
- security review;
- documentation;
- draft PR.

Not consumed:
- consensus/economic/mining-algorithm change;
- DP6 activation or DP7;
- wallet cryptography/address/transaction semantics change;
- public deployment;
- release;
- activation height;
- mainnet;
- paid infrastructure/AWS/AFI/F2;
- automatic merge.

## Terminal state

```text
SOVEREIGN_STANDALONE_MINING_READY
```

The technical workstream is closed at the candidate level. Any later merge into canonical `main`, release, deployment or activation is a separate authority decision.
