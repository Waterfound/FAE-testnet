# Element 5 — persistent vault public identity → genuine chain reading

**Engineering candidate, 2026-10-11.** Derived from [Element 5 integrated read candidate #303](https://github.com/Waterfound/FAE-testnet/pull/303), which composes #299/#302; consumed source contract is [FAEWalletVault API in #266](https://github.com/Waterfound/FAE-testnet/blob/8708b03866f42cf84ba2d01908caec4238928e70/wallet-vault.js).

## Why the boundary matters

The first cross-surface test used three independently generated public identities. The actual encrypted persistent vault exposes `listWallets()` (public identity metadata) and `readState()` (active wallet id) without decryption, and privately retains the material needed for spending. Bridging this public metadata to tip-bound Explorer read API should not require private material to leave the vault, nor force signing/unlocking merely to read a confirmed balance.

### Implemented without altering the original vault

`createVaultBoundPublicObserver({vault, adapter})` consumes exactly `readState()` and `listWallets()`. It verifies that:
- persisted active wallet id resolves to exactly one public record with a valid `wallet-[SHA256]` identity;
- network matches the public-testnet v4 expected identity, selected index is in range and public address is well-formed;
- the public observer receives strictly `{walletId,address}`, never the full vault record or its crypto metadata;
- if another browser tab changes the persistent active identity/address before/during network read, the returned balance is **discarded**, the observer is cleared and `VAULT_CHANGED` is exposed, not stale funds;
- damaged/unavailable storage and nonempty vault without active selection result in `vault_unavailable` (never known zero or no-wallet);
- an empty vault has `no_wallet`, distinct from observed balance `0`.

The bridge **does not** call `loadActive`, `loadAccount`, `admitAccount`, `setActiveWallet`, `setActiveAddress`, `removeWallet`, crypto PIN APIs or transaction signing. The real Wallet UI maintains the mining stop/switch rule and trusted vault authority; this module follows the **already committed** public identity. It has no privilege to switch Wallets while mining or unlock a locked vault.

### Tests and evidence ceiling

- Node unit tests exercise three source-shaped wallet records; known-zero/unknown; external tab switch and address-index switch during an asynchronous node request; invalid, missing, duplicate, wrong-network or corrupt metadata; inaccessible IndexedDB; concurrent response reorder; public-only access (private port methods throw if touched).
- The existing mined-chain E2E is augmented to query actual locally mined v4 blocks and an accepted locally signed transfer via a mocked **public-metadata-only vault port** with the exact `readState/listWallets` interface. Amounts are verified against a real isolated node, not fabricated response fixtures.
- GitHub CI `node --test product-data/*.test.mjs` plus cross-lab/source/security checks are the admissible initial runtime evidence.

**Important evidence limit:** the vault port is *API-shaped test double*, not a real IndexedDB encrypted three-seed demonstration. The exact PR #266 full browser vault must later undergo its own isolated browser integration, migration/lock and three mnemonic/passphrase wallet workflows with private-material safety. A separate cryptographic PIN that gates key use remains VR-09 W28; the positive-balance PIN affordance W29 needs an *actually confirmed, non-stale observed balance*. The approved Mining/Wallet/Explorer Studios were **not** altered.

## Next serial integration gate

1. Verify this exact head's test outcomes.
2. Admit #266 (or #272's current reconciled vault code) under **its** existing signing/mining/selection browser security suite; do not copy a stale vault into product-data merely to make unit tests look integrated.
3. Bind `createVaultBoundPublicObserver({vault:globalThis.FAEWalletVault, adapter})` only in a source-reviewed browser composition, and call `invalidate()` on actual vault lock, mining switch, address selection, network change and sign/review.
4. Re-run the actual browser with separate passphrase identities and multi-tab races, verifying no signing occurs under a stale active wallet.
5. Map states onto **the approved quiet, authored visual grammar**, with no connected-mode dummy records, and request a separate canonical merge/public release authority.

This is source-level advancement to the I/O boundary, not production-connected UI, physical Safari, ASIC validation or mainnet readiness closure. Build Colony decomposition is recorded in #303; no independent provider-backed General Execution Durable Session is asserted here.
