# FAE Elements & Tasks — Strategic Execution Selection and Feedback Discipline

**Decision:** 2026-10-13. **Scope:** cross-cutting operational selection rule for the existing **14 Mainnet-Critical Elements** (1–14) and their dependent Tasks, labs and frontier owners. **Status:** proposed documentation-only rule pending owner admission; not an additional Element, protocol change, or launch authority.

> **Maximum Machine Autonomy. Minimum Wasted Engineering. Maximum Verified Mainnet Progress.**

## Why this exists

The October 13 engineering burst produced source-confirmed security defects, narrow repairs, regression suites and candidate integration, but also duplicate test identifiers, divergent integration branches and disproportionate investment in a disabled optional PPLNS feature. Many source tests GREEN do **not** imply proportional mainnet gate closure; a reported +1 percentage point in analytic readiness is not the value or reliability of the work. Preserve the evidence and improve **selection, serialization and feedback**, not by reducing admissible machine autonomy.

## Binding selection discipline for each existing Element

Before a new independent execution wave, the owning machine should record, in the Element's existing work record or checkpoint (without creating another tracker):

1. **Current source & owner:** most recent exact source SHA, live-vs-candidate-vs-disabled reachability, existing PRs, concurrent owner, and the canonical mainnet gate it may close.
2. **Decision relevance:** what launch-critical uncertainty, reproducible high-severity defect, explicit integration prerequisite or external evidence requirement is being reduced? An optional inactive feature is deferred unless activation isolation fails or the issue can reach active consensus/security.
3. **Decisive evidence:** an explicit falsifiable negative/RED, a minimal REPAIR if proven, positive controls, exact-head GREEN and appropriate combined integration checks. Source-owner GREEN is not integrated or production GREEN.
4. **Opportunity cost:** compare expected blocker/gate closure, material severity, execution cost, evidence quality, dependencies, interference and alternatives. Prioritize *risk removed per constrained machine capacity*, not prompt/PR/test volume. Do not invent numerical probabilities or report metric inflation.
5. **Ownership and collisions:** *Parallelize independence. Serialize shared state.* One owner per integration boundary, tests and fixture identifiers globally unique, re-read moving heads, retain protected branches and separate alternatives. Do not duplicate PCC or compete with another conversation's writer.
6. **Feedback and stop predicate:** after each decisive cycle, classify **CONTINUE / INTEGRATE / REDIRECT / CONDITION_WAIT / EXTERNAL_EVIDENCE / HUMAN_GATE / CLOSE**. State what specifically changed in mainnet blockers and why another experiment would have higher value. Stop exploratory expansion when marginal information gain is immaterial.


## Sovereign client interoperability — requirements of existing Elements

**Waterfound requirement / candidate admission, 2026-10-13.** Sovereignty means a usable independently operated system, not merely an accessible browser UI. **Browser ≠ Miner ≠ Wallet ≠ Node**. This section refines acceptance evidence for existing Elements; it adds **zero Elements, tracker gates, consensus rules, release permissions or workstream slots**. The ACTIVE FAE-P0 (hosted SQL atomicity) and SECONDARY PBR-001 (independent disaster recovery) retain all shared-resource priority. This document remains DRAFT until the Elements & Tasks owner admits the criteria.

### Existing Element ownership and exact acceptance boundary

| Existing Element | Required acceptance condition | Current evidence boundary |
| --- | --- | --- |
| **4 — Production Network Bootstrap** | Independently operate and sync a full validating FAE node with other peers without a mandatory FAE browser frontend, Vercel, Supabase, Waterfound, or single bootstrap operator. Peer identity, invalid feeds, restart and relay must be verified. | Node.js reference node, independently validated chain/UTXO, and configurable peer selection are source-present; production independent topology/bootstrap remains UNPROVEN. |
| **5 — Complete User Journey** | A user can **create, back up, recover, receive, independently verify spendable funds, sign, submit and follow a transaction without a browser** through a documented maintained CLI/native wallet and a *selected* FAE full node. Wallet works if the first-party frontend disappears. | Browser wallet has 24-word local derivation, Ed25519 and locally signed transfers; node provides balance/spendable/history and POST /submit-tx. Complete CLI/native wallet end-to-end is NOT yet certified. |
| **7 — Final Reproducible Release** | Independently reproducible code, installation/build, source/version hashes for non-browser wallet, miner and validating node; no provider-exclusive binary or privileged bootstrap dependency. | Release readiness is not a mainnet release or independent operator proof. |
| **11 — Open-Source, Legal & Disclosure** | Document implementable wallet/address/transaction formats, key-handling, interoperability and limitations. A 24-word mnemonic does NOT imply automatic Bitcoin/Electrum derivation compatibility. | Public protocol source exists; independent cross-client conformance remains OPEN. |
| **13 — Node & User Documentation** | Document standalone wallet creation/recovery, watch-only receive/mining address, offline signing versus online broadcast, node selection, safe seed handling, transaction errors/states and independent bootstrap. | Element 58 miner and node are documented; standalone spending wallet journey is OPEN. |
| **14 — Canonical Launch Freeze** | Require real browser-free wallet→node→network→recipient evidence, plus independent network/operators, hardware/economic decentralization evidence, before mainnet/decentralization claims. | Documentation creates NO external evidence, production status or launch authority. |

**Existing crosswalk, not another Element:** [Element 58 — Sovereign Standalone Mining](sovereign-standalone-mining/ELEMENT_58_SOVEREIGN_STANDALONE_MINING.md) is already **INTEGRATED_MAIN / TECHNICALLY VERIFIED** but NOT release/activation-authorized. The standalone miner (standalone/fae-miner.mjs) requires only a selected node URL and public FAE reward address. It does not create/unlock a spending wallet. It must not be counted as proof of an independently operable wallet. Related browser-mining, node and Wallet UX Elements (15/24/51) remain under existing owners; do not duplicate them.

### Required source-based adversarial cross-client proof — Element 5

1. **Exact key and address parity:** Using fixed disposable 24-word mnemonic vectors, and separately optional-passphrase vectors, derive the *identical* Ed25519 public keys/SPKI and FAE addresses independently in browser and non-browser wallet. Check empty-passphrase legacy address-0 mapping, subsequent indexes, wrong passphrase, corrupted mnemonic and network mismatch. Never publish real user recovery materials in tests.
2. **No browser, no custodian:** Create, restore, receive and sign with the browser disabled, no first-party website or Supabase session, no remote receipt of seed, private key, passphrase, signing authority or plaintext vault. Persist keys securely; explicitly test lock/unlock, loss and invalid recovery. A miner accepts only public addresses and cannot spend.
3. **Real FAE transaction parity:** Reproduce the canonical FAIRYELF_TX_V2 signing preimage, local Ed25519 signature and transaction ID; feed a real source transaction into an independently operated FAE node via POST /submit-tx. Verify acceptance, destination, input ownership, UTXO/value/fees and eventual block inclusion without guessing global confirmation.
4. **Fail-closed lifecycle:** Cover wrong-network, invalid signatures, malformed output, already spent input, unavailable node, stale tip, restart and reorg. Seed recovery reconstructs keys, while history must be independently queried; a seed does not contain a ledger history.
5. **Independent node witness:** At least two separately controlled operators validate/relay the same transaction and chain with source provenance under restart/partition conditions. One local simulation cannot replace real external network-diversity evidence.

**Acceptance evidence:** pinned source SHA, deterministic parity vectors, browser-free wallet process, node-native signed-transaction and recipient acceptance, negative cases, release hashes and independent operator evidence. Keep SOURCE_VERIFIED, INTEGRATED_MAIN, EXTERNAL_EVIDENCE, PRODUCTION_VERIFIED and MAINNET_AUTHORIZED separate. Passing a prose/schema validation never proves wallet software works.

**Current truthful status:** MINER_STANDALONE_INTEGRATED_MAIN_VERIFIED; INDEPENDENT_NODE_REFERENCE_AVAILABLE__PRODUCTION_TOPOLOGY_OPEN; WALLET_STANDALONE_END_TO_END_NOT_YET_VERIFIED; SOVEREIGN_CLIENT_INTEROPERABILITY_REQUIREMENT_PROPOSED. These criteria stay PASSIVE until existing Element/Wallet ownership can safely admit them without interfering with the ACTIVE or SECONDARY.


## Repeatable decision loop

**RECONCILE → RANK → SELECT → ATTACK/BUILD → RED → REPAIR → GREEN → SERIAL INTEGRATION → MAINNET-GATE FEEDBACK → CONTINUE, REDIRECT OR CLOSE.**

Reports must distinguish (a) new information, (b) defects removed in source branches, (c) exact integrated security demonstrated, (d) actual canonical/production gate closure and (e) external/human blockers. Publish honest statuses and exact evidence links; do **not** increment a mainnet readiness estimate because another suite, branch or draft PR passed.

## Coverage and authority

This selection overlay applies to all existing Mainnet-Critical Elements:

1. Public-Code Security;
2. Final Consensus & Economics Freeze;
3. Production Chain Identity / Genesis;
4. Production Network Bootstrap;
5. Complete User Journey;
6. Clean-State Mainnet Rehearsal;
7. Final Reproducible Release;
8. Operational Stability;
9. Representative Physical PoW Evidence;
10. Final White-Box Project Assurance;
11. Open-Source, Legal & Disclosure;
12. Mainnet Activation / Incident Runbook;
13. Node & User Documentation;
14. Canonical Launch Freeze.

It **does not** replace the Elements & Tasks owner records, the 24-gate mainnet readiness ledger (`docs/FAE_MAINNET_READINESS_STATE.json`), or the draft authored-product bridge (`docs/product/FAE_ELEMENT_PRODUCT_GATE_BRIDGE.md`, PR #298). It creates **zero new Elements, gates, schedules, credentials, tools, production settings, consensus decisions, fee/PPLNS activations, or spending**.

Waterfound retains final authority. Keep One Man involvement near zero until a genuine human gate; the machine should autonomously resolve admissible choices inside its existing authority. Under the most recent HPA mainnet-critical cutline in private Systems #26, optional inactive pool-feature exploration is not a substitute for active-consensus security, W2 fee/security-budget closure, release-image default-disabled proof, independent operational evidence or final explicit mainnet authorization.

**Acceptance by an Elements owner:** reference this rule in the next admissible Element/Task checkpoint and use it as a preflight/feedback filter. That adoption is **not** itself a completed security gate, a mainnet score increase or a merge authorization. This documentation-only proposal must be reconciled by the existing registry owner before canonical adoption.
