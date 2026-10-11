# FAE Wallet — public-ledger observation guard (candidate)

**10 October/11 October 2026** · Element 5 · subordinate to [PR #294](https://github.com/Waterfound/FAE-testnet/pull/294) read-only adapter and [PR #266](https://github.com/Waterfound/FAE-testnet/pull/266) cryptographic-vault authority.

## Why this code exists

A Wallet can display the wrong address/balance if another Wallet is selected while a previous asynchronous node request is still pending. The most dangerous visual failure is showing a stale value that *belongs to another selected identity* as though it were current. A locked Wallet, zero-balance Wallet, never-created Wallet and offline/unknown-balance Wallet are distinct states.

`wallet-public-ledger-observer.mjs` accepts only an opaque public `walletId` plus `faet1` address. It reads via the existing validated public Explorer adapter, binding address response to the same observed `network + height + hash` as the status. It increments its request epoch on select, clear, external lock-state change and every refresh, rejecting late/out-of-order responses before they can contaminate the current Wallet.

## Admissible UI behavior

- `no_wallet`: no installed selected Wallet; do not fabricate a zero balance.
- `unknown`: public identity selected or externally unlocked; **balance unknown** until verified read.
- `loading`: do not imply confirmed funds or fresh chain data.
- `observed`: atom-exact **string** balance associated with one Wallet address and selected tip. Zero is a valid observed balance only here.
- `unavailable`: network errors, wrong network, tip drift or schema defects; show uncertainty, not `0`.
- `locked`: external cryptographic vault indicates locked; hide address and amount, suppress reads and public Wallet context switching.
- `stale_discarded`: internal result for superseded asynchronous request; never publish it as a new Wallet balance.

The approved FAE Wallet visual direction should express those states with authored negative space and restrained evidence-aware signals; there is no need for generic dashboard cards or filler text.

## Security and ownership boundaries

- **Not** a replacement for PR #266's encrypted vault, passphrase derivation, optional PIN wrapping or mining-switch guard.
- `setVaultLocked(false)` only reflects a trusted decision of the actual cryptographic-vault caller; it does **not** authenticate or unlock any secrets.
- Accepts **only** `walletId` and public `address` for selection; reject mnemonic, passphrase, private key or arbitrary vault object fields.
- Never persists, generates, transmits, derives or signs keys.
- This is a pure candidate and does not wire the real authored Wallet, change production site, create an account, broadcast a transaction or accept value from illustrative Studio data.
- The existing PR #294 adapter still owns HTTPS origins, no credentials, GET-only transport, schema verification, address/real-network validation and tip handling.

## Evidence

Run `node --test product-data/wallet-public-ledger-observer.test.mjs` (Node 22+) or the owning candidate's `node --test product-data/*.test.mjs` CI workflow. Mocked tests cover three independently selected public Wallet contexts, identity/balance coherence, overlap/out-of-order responses, lock interruption, wrong network, tip drift, offline, malformed atom-string and forbidden secret fields.

**Still OPEN:** proof against actual PR #266 vault with distinct mnemonic/passphrase derivations, multi-tab transactional selection and signing revalidation, encrypted PIN design, actual read adapter + isolated node integration, iPad Safari engine/physical evidence, product visual parity, canonical merge and live deployment. A unit PASS does **not** close VR-09 or authorise release.
