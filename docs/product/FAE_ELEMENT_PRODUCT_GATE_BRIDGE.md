# FAE — Elements & Tasks → Authored Product Gate Bridge

**Execution Protocol, bounded real-run candidate — 10 October 2026.** This document is a *non-activating bridge*, not a new Element, mainnet readiness proof, artistic reinterpretation or replacement for the existing Element registry. It is linked to [real-product source-of-truth issue #295](https://github.com/Waterfound/FAE-testnet/issues/295), [Wallet VR-09 #290](https://github.com/Waterfound/FAE-testnet/issues/290), [Explorer BE-08 #293](https://github.com/Waterfound/FAE-testnet/issues/293), and [PR #294](https://github.com/Waterfound/FAE-testnet/pull/294).

## Purpose

Every technical gate must say **which authored product surface it protects, what verifiable data powers the visual, how stale/error conditions appear, and what independent evidence closes the gate**. Technical completion cannot be inferred from a beautiful preview. Conversely, a technical PASS does not authorize visual redesign, production deployment, canonical merge, consensus policy or mainnet.

## Frozen authorial boundaries

- **Mining**: [PR #268](https://github.com/Waterfound/FAE-testnet/pull/268) / PASS 3 FINISH is the sole artistic reference. Quiet space and flowing blue express *observed activity*, never invented block-mining progress.
- **Wallet**: user-approved authored Studio direction remains the art reference, while [PR #266](https://github.com/Waterfound/FAE-testnet/pull/266) (persistent encrypted vault) and [PR #272](https://github.com/Waterfound/FAE-testnet/pull/272) (Product + Wallet) are separate **draft code candidates**. VR-09 W01–W29 must be reconciled before real integration, particularly atomic three-wallet switching, persistence, locked versus empty, and the optional cryptographic PIN.
- **Explorer**: user-approved authored Studio direction: search-led composition, dense secondary records and event-driven blue/green state. Studio ledger records are explicitly demonstrative, never chain facts. [Issue #293](https://github.com/Waterfound/FAE-testnet/issues/293) is the depth/behavior contract.
- **Operations/readiness**: an intentionally *separate*, low-noise future surface for reproducible releases, real network condition, launch gates and incidents; do not add generic cards to Mining/Wallet/Explorer.

## Element-to-product execution map

| Elements | Product destination | Can be prepared independently | Final gate |
|---|---|---|---|
| 2 / 3 / 4 / 10 | Mining validated tip; Explorer accepted chain and genesis | deterministic vectors, identity contract, anti-spoof replay | final freeze, real verifier, topology and production genesis |
| 5 / 9 | Mining measured local work and device coexistence | measured-local telemetry contract, pretests | physical representative-device evidence |
| 5 / 10 | Wallet user identities, persistence, lock/PIN | adversarial atomic switching, no-secret adapter and vault tests | final security checks + exact integrated source |
| 5 / 8 / 10 | Wallet balances/history and Explorer mempool | tip coherence, resource-bound tests, reorg model | real node + real-data UI E2E + fee policy |
| 6 / 7 / 12 / 13 / 14 | Operations/readiness, provenance and documentation | reproducibility/rehearsal, recovery and usability runbooks | clean room, external prerequisites, explicit release authority |

## Rules that apply before any product integration

1. Connected mode has **no mock fallback**; isolated Studio samples cannot leak into network-facing UI.
2. Wallet has distinct `no_wallet`, `zero_balance`, `locked`, `corrupt`, `offline` and `unknown_balance` states. Missing/stale money data never becomes zero.
3. Explorer `height+1` is an **unconfirmed candidate**, not a progress counter. A status transition to confirmed requires an actually verified accepted block.
4. Pending transactions are **node-local observed**. No global census, eventual confirmation, mempool reinsertion after reorg or transaction finality is invented.
5. Public-node reading cannot access mnemonic, private key, optional passphrase, wrapping key, local PIN or signing capability. UI Wallet-context switches must invalidate old requests.
6. Missing/reorganized blocks, stale timestamps, conflicting tips, wrong network, rejected records and availability errors require explicit, calm failure states.
7. Visual continuity is checked against separately approved Studios. No art approval is automatically transferred to a GitHub code SHA.
8. Each completed candidate gate records **exact SHA, evidence commands/results, upstream Elements, residual failure modes and honest closure class**; production/mainnet gates remain held until separately authorized.

## Machine-readable candidate acceptance

- Contract: `docs/product/FAE_ELEMENT_PRODUCT_GATE_BRIDGE.json` — **14 named gates** across Mining (3), Wallet (3), Explorer (4), Operations (4).
- Verifier: `product-data/verify-element-product-bridge.mjs`. Negative mutations must reject false promotion, dropped guard invariants, lost provenance, orphaned Element references or missing product coverage.
- Repeatable test: `node --test tests/element-product-gates.test.mjs` (Node 22+). Source-only checks. No claim of live-node/UI/physical regression from this test.
- Parallelism: historical PoW [PR #296](https://github.com/Waterfound/FAE-testnet/pull/296) / [PR #297](https://github.com/Waterfound/FAE-testnet/pull/297) own Element 2/10 technical work; [PR #294](https://github.com/Waterfound/FAE-testnet/pull/294) owns read-only node adapter; this bridge does not modify those branches or shared runtime code.

## Closure discipline

**This bounded bridge itself** may be declared `DONE_TECHNICAL_CANDIDATE` after exact-source test evidence, while **none of the 14 underlying product/production gates** become `DONE_CANONICAL` by that fact. Each gate stays `CANDIDATE_EVIDENCE`, `CONDITION_WAIT`, or `HUMAN_GATE`. No automatic merger, persistent-runtime repin, scheduler, paid provider, keys, release, live consensus/economics or mainnet.
