# FAE — Authored Product Integration & Data Contracts

**Candidate scope, 2026-10-09. Authority: Waterfound.** Mode: evidence-first advisory decomposition + bounded real-run candidate. No formal Build Colony / MI / DI / Red Team runtime execution is claimed.

## Artistic authorities, not release authorities

Waterfound approved the visual direction of **Mining**, **Wallet**, and **Block Explorer**. Art approval is **not** proof of genuine network data, security assurance, canonical merge or production deployment.

- Mining PASS 3 FINISH: [PR #268](https://github.com/Waterfound/FAE-testnet/pull/268), frozen artistic reference at `a949e913990e13a0b907891a729b5c7b2086547b`.
- Wallet: authored VR-08 revised Studio `fae-wallet-authored-revision-vr-08-5xu6gd`, user-approved direction. [PR #266](https://github.com/Waterfound/FAE-testnet/pull/266) is the **draft functional vault candidate**. [PR #272](https://github.com/Waterfound/FAE-testnet/pull/272) is the **draft Product+Wallet source candidate**. Approval of the isolated Studio does not automatically approve their exact current GitHub contents.
- Explorer: authored `fae-block-explorer-authored-studio-enul9d` with visual refinements recorded in [issue #292](https://github.com/Waterfound/FAE-testnet/issues/292). Its demonstrative heights, balances, fees and transactions are **not actual chain data**.

## Architecture and no-secret boundary

```text
Independently validated FAE node (selected chain / UTXO / mempool)
   └── /explorer/* GET-only API
         └── Read-only adapter: network, tip binding, schema, errors, freshness
                ├── Explorer public views
                └── Wallet PUBLIC balance/history views
Wallet LOCAL encrypted vault ──► wallet selector / local signing (never adapter)
Mining LOCAL worker / measured telemetry ──► Mining UI
```

This is a **target**, not a deployed end-to-end application. No mnemonic, passphrase, private key, private JWK, signing data, or authenticated browser storage is sent to an Explorer node. Wallet selection changes must cancel or reject stale reads from a previous wallet context.

## Existing code and exact evidence

- `sovereign-forge/node/fae-node.mjs` reconstructs and validates chain state locally; the explorer reader consumes a cloned already-validated snapshot.
- `sovereign-forge/node/explorer-read.mjs` implements `GET /explorer/status`, `/blocks`, `/block`, `/transaction`, `/address`, `/search`. Address cursors are bound to the observed tip hash; `503 tip_changed_retry` means discard the page and re-query. No separate Explorer database is currently required.
- `network-status.js` models connectivity-derived connecting/online/offline. `mining.js` has worker/coordinator/tip state, requiring actual measured counters for throughput rather than visual placeholders.
- Draft Wallet PR #266 has a persistent multi-wallet cryptographic vault candidate. It must retain all candidate browser/security gates when art is integrated.

## Field-to-source and display contract

| Surface | Actual source | Display | When missing/stale |
|---|---|---|---|
| Mining observed tip | node `observed_tip_height/hash` | selected chain height + candidate = height+1 | offline/last observed; no unpublished-miner claims |
| Mining rate/status | locally measured worker attempts/time and mining coordinator | local hash rate, running/stale/rejected, not global | unknown, never synthetic or fake PoW progress |
| Mining device energy | measured device/wattmeter evidence if available | show measured units and sample window | unavailable rather than inferred |
| Wallet list | **local** encrypted vault, active identity | 1–N identities with atomic switch | locked != empty; zero-balance != empty |
| Wallet public balance | node `/balance`, `/spendable`, `/explorer/address` | confirmed vs spendable distinguished | unknown if not coherently read |
| Wallet signing/recovery | **local** vault only | explicit New / Recovery; exact seed+optional passphrase identities | fail closed on missing wrapping key, tamper, migration |
| Wallet history | node `/explorer/address`, tip-bound cursor | pending, confirmed, rewards, depth | tip change invalidates pagination |
| Explorer status | node `/explorer/status` | height/hash, mempool **local observation**, issued atoms | stale/offline label |
| Explorer blocks | `/explorer/blocks` | top 3 accepted **ascending left-to-right**; detailed search may be newest first | no confirmed blocks inferred |
| Explorer block/transaction | `/explorer/block`, `/explorer/transaction` | identifiers, inputs, outputs, atoms, fees, confirmations | never substitute examples |
| Explorer addresses | `/explorer/address` | actual node balance, transfers and rewards | cursor retry on tip change |
| Explorer lookup | `/explorer/search` | typed block, txid, address match | honest 404/no results |
| Explorer candidate sheen | observed height + 1 | blue/ice **aesthetic waiting** only | no percent mining completion |
| Global transaction ledger | **no current public listing endpoint** | suppress in connected mode until designed | don't fake records |
| Public pending TX list | **no current public listing endpoint** | count only from node status | no global mempool claims |

Consensus parameters are **not** copied from Studios. Current public-testnet values and proposed mainnet economy differ. Reward, halving, maturity, difficulty, target interval and supply must come from the actual admitted chain/protocol; if absent, display unknown.

## First implementation scope

`product-data/explorer-read-adapter.mjs` is a standalone candidate **read-only adapter**, not yet wired to product UI. Explicit base URL required; no secret headers/cookies, mutations or stored credentials; six approved GET routes only, HTTPS except local loopback, no-cache, redirects disabled, timeout handling, typed errors, integer atomic amounts preserved as strings, network and tip checks, no fabricated fallback. `product-data/explorer-read-adapter.test.mjs` contains mocked provider-neutral contract tests. **A passing mock test does not prove a live node or browser integration.**

## Priority gates

1. **P0** verify adapter responses against a real **isolated** node at exact version: status, block, transaction, address, pagination and errors.
2. **P0** implement and test tip-coherent read batches and stale/late wallet-response invalidation. Preserve wallet selection + mining guard.
3. **P0** connect one approved UI family with **no** production mock fallback. Re-run art regression and security gates.
4. **P1** design read-only bounded global transaction pagination and public mempool listing only when the dense Explorer actually requires it; show provenance and rate limits.
5. **P1** verify reorg and maturity behavior against admitted consensus. Never classify an orphaned TX as currently pending without observation.
6. **P2** measure performance before adding a database/indexer; mobile Safari, keyboard, reduced motion, long TXIDs, localization.
7. Request Waterfound **separate authority** for canonical merges, production integration, paid infrastructure, provider/credential changes, consensus/economics, or mainnet.

### Admission

`AUTHORED_DATA_CONTRACT_CANDIDATE_ONLY__PROVIDER_NEUTRAL_TESTS_GREEN__CANONICAL_INTEGRATION_NOT_AUTHORIZED`

This PR/branch does not install unattended execution or claim a real autonomous Build Colony/MI/Red Team runtime. Parallelize independent analysis, serialize shared code and state. Preserve privacy and Waterfound authority.
