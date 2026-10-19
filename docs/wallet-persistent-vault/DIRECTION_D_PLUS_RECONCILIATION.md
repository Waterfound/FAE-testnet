# Direction D+ reconciliation for Wallet Persistent Vault

Status: **WV-16R / BOUNDED RECONCILIATION**

This record exists to reconcile the technically closed Wallet Onboarding & Persistent Vault candidate with the newer Direction D+ visual authority without reopening either workstream beyond its authority.

## Evidence reconstructed

- canonical `main`: `b00bbebca81a8f1085f7e61beddca862d8b5dfaa`;
- Wallet candidate before reconciliation: `424b667df2ca6c85efdcca355b597744bf754760`;
- Direction D+ authority source: `design/fae-direction-d-plus-approval@6719a825b6e12a38824af3edfd03851b5d62eb1c`;
- D+ diverges from the Wallet candidate only in visual authority/design documentation relative to their common Direction D ancestor;
- the D+ branch does **not** contain a newer product `index.html`, `wallet.js`, `wallet-vault.js`, mining runtime, wallet cryptography, transaction implementation, or protocol source.

## Bounded reconciliation performed

The Wallet candidate now carries the exact D+ authority artifacts from the D+ branch:

- `design/README.md`;
- `design/direction-d-visual-grammar.md`;
- `design/direction-d-plus-approval-candidate.json`.

No Wallet product source, vault source, mining runtime, transaction semantics, address/derivation rules, consensus or economics were changed by this reconciliation.

## Scope decision

The D+ refinements that remain absent from product source are visual-shell work owned by the Visual Language workstream, including the product-first removal of the current hero, Block Height ticker label, compact upper-right Wallet/Mining controls, Mining Overview, Devices telemetry presentation, Mobile Preview and footer entry points.

Implementing those surfaces inside the Wallet workstream would violate **Close before expand** and would reopen Visual Language without source/evidence ownership. Therefore this Wallet reconciliation fails closed at the workstream boundary: Wallet semantics are preserved and D+ authority is carried forward, but this workstream does not manufacture a D+ product implementation.

## Preserved Wallet invariants

- non-custody;
- seed/private keys never sent to backend;
- no plaintext passphrase persistence;
- no private JWK persistence in localStorage for the new vault;
- multi-wallet Add/Switch/Remove semantics;
- active Wallet and active derived-address persistence;
- Wallet identity remains separate from derived addresses;
- seed is not required again for normal use;
- Wallet Transaction UX/TXID/history remains unchanged;
- mining reward-address switching remains blocked while mining.

## Terminal interpretation

`FAE_WALLET_PERSISTENT_VAULT_READY` remains the correct Wallet technical terminal state.

The next cross-workstream gate is not additional Wallet implementation. It is the serialized Visual Language / authority step that provides or admits the D+ product implementation, after which the Wallet regression bank must be rerun on the exact combined candidate before any public merge or deployment.
