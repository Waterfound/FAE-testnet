# FAE Wallet — authoritative Studio-first integration (ACTIVE candidate)

Date: 2026-10-16. Owner: existing FAE Product Shell + Wallet PR #272; no new front or deployment.

## Source authority

- FAE visual identity: Mining Authored Reference PR #268, head `a949e913990e13a0b907891a729b5c7b2086547b`. No propagation to other feature families.
- Function-specific authored Wallet: **fae-wallet-authored-revision-vr-08-5xu6gd**, applied version **1791582226769**, APPROVED_IN_CONVERSATION.
- Eight unmodified source files from exactly that approved version are snapshotted under `design/approved-wallet-vr08-studio/`. Their Git blob hashes are pinned in `tests/approved-wallet-studio-fidelity.mjs`.
- The Studio retains its original, synthetic demo code for source provenance **only**. Its sample balance, fake transactions and example wallets must never silently enter product code.

## Binding rule — the canvas is immutable

The Studio's **actual HTML/CSS scene tree** is the acceptance contract. Work *in* its composition, not around it. Do not replace this with visually approximate CSS overrides of the previous product markup.

1. Branch/work against the existing #272 draft only. Keep the original Studio and the source-frozen mirror untouched.
2. Candidate implementation must reuse the **same authored DOM structure, classes, proportions, negative space, hierarchy, typographic placement, wallet rail, interaction states, motion rules and mobile layout**. If a new function does not fit, attach a contextual disclosure/action detail within an existing component; no ambient dashboard cards or extra hero copy.
3. Add bindings progressively: first the visible **Empty Wallet** with zero implicit wallet creation; then **New Wallet** and **Recovery** with real 24-word local confirmation and same existing protected vault; then **Active** with public address, balance and real transfers; then multi-wallet selection and guarded send. Never simulate live data as fact.
4. Treat `wallet.js`, `wallet-vault.js`, `wallet-crypto.js`, signing intent, transaction contracts, `mining.js` and `core.js` as separate protected functional owners. Adapter code must preserve address derivation, signatures, anti-leak/privacy and mining invariants byte-for-byte.
5. Native-browser proof at 1440×900, 834×1194, 390×844 must compare reference and candidate **per visual state** and verify key regions, layout geometry, dynamic labels, mobile order, reduced motion, visible recovery, no overflow or screenshot of words. A structural selector check or 7/7 functional CI **alone is never** a visual match.
6. After **every** function insertion, prove **zero unintended visual change** in the reference composition, with snapshots/overlay or geometry + human review for artistic decisions. Reject/revert the slice if composition degrades.
7. Exact bounded authority: candidate engineering/testing, no main merge, public production, Studio modification, feature-family propagation, economics, consensus, cryptographic mutations, cost or credentials. Waterfound's visual approval is an exclusive gate.

## Status and next executable step

- APPROVED_STUDIO_SOURCE_FROZEN (this source-preservation checkpoint).
- FULL_STUDIO_TO_REAL_WALLET_BINDING **NOT STARTED / NOT VERIFIED** — previous DFR-01 is a separate historical CSS+HTML approximation. Do not claim the Studio has become functional.
- Next step: produce an isolated, exact-markup *implementation copy* of the Studio on this same PR, keep its eight frozen files byte-identical, and migrate one real Wallet view at a time behind a testable adapter. Prove rendered pixel/geometry fidelity to the approved Studio **before** considering PR #272 visually ready.
- Durable class: existing FAE Visual Continuation recurring owner + PR checkpoint, not a newly created native Durable runtime event or scheduler.
