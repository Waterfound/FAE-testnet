# FAE — Wallet Onboarding & Persistent Vault

## Build Colony run

- Run: `BC-FAE-WV-20260928-001`
- Source repository: `Waterfound/FAE-testnet`
- Immutable planning base: `b00bbebca81a8f1085f7e61beddca862d8b5dfaa`
- Direction D reconciliation base: `2ffa8dbbd4ed9b32d5593e6462f7c3486e18603c`
- Build Colony source inspected: `Waterfound/Build-Colony@17979869a85c9f5adf2cef2ceb589a07fcef6239`
- Execution rule: **Parallelize independence. Serialize shared state.**
- Terminal technical state: `FAE_WALLET_PERSISTENT_VAULT_READY`
- Production/mainnet promotion authority: excluded.

## Reconstructed baseline (WV-00)

The current browser wallet is a single `walletAccount`. It persists `FAE_BROWSER_KEYRING_V3` records containing private JWK material directly in `localStorage`, mirrors the active private JWK into the older single-wallet key, and uses a replacement confirmation before a new seed or recovery package is admitted. New-wallet creation commits before backup proof. The mining client already blocks reward-address switching while mining and local transaction signing / Wallet Transaction UX are proven surfaces to preserve.

## Refined execution graph

| Wave | Frontiers | Shared-state rule | Exit evidence |
|---|---|---|---|
| A | WV-00 inventory; WV-01 threat model; WV-02 onboarding state machine; WV-03 vault data model; WV-04 wallet fingerprint; WV-05 storage selection | Independent analysis may run in parallel; contracts freeze before product writes | architecture + threat-model contracts |
| B | WV-05 → WV-06 migration → WV-10 persistence | Vault module is serialized | encrypted IDB vault, verified migration, active wallet/address persistence |
| C | WV-07 New Wallet; WV-08 Recovery; WV-09 add/switch/remove | `wallet.js` and wallet DOM are shared state and are serialized | staged onboarding + multi-wallet behavior |
| D | WV-11 Mining boundary; WV-12 WTX regression; WV-13 corruption/recovery | independent tests may parallelize after C | fail-closed regressions |
| E | WV-14 Chromium/WebKit compatibility; WV-15 adversarial campaign | immutable candidate | browser and adversarial evidence |
| F | WV-16 Direction D; WV-17 canonical reconciliation | `index.html` and Visual Language candidate are shared state; serialize | Direction D wallet states reconciled, Visual Language remains gated |
| G | WV-18 closure | evidence-only | technical closure or genuine authority/external gate |

## Frozen requirements

1. Empty Wallet exposes **New Wallet** first and **Recovery Wallet** second; management/send/history surfaces do not dominate the empty state.
2. New Wallet is staged in memory. Twenty-four words are generated locally and the user must re-enter the complete valid mnemonic exactly before admission. Reload/interruption before confirmation establishes nothing.
3. Recovery Wallet is the primary seed flow; optional passphrase is explicit. Legacy JSON is an advanced path.
4. Admitted Wallets persist in the same browser profile without arbitrary expiry.
5. Multiple independent Wallets coexist. Add/Switch/Remove never silently replaces another Wallet.
6. Wallet identity is distinct from derived address identity. Active Wallet and active derived address persist.
7. Seed and optional passphrase are not login credentials and plaintext passphrases are never persisted.
8. Persistent private material is not written to localStorage in the new format.
9. Legacy records migrate only after validation + verified vault commit; invalid legacy state remains untouched and fails closed.
10. Wallet switching/address switching while mining is blocked.
11. No seed/private key transmission, custody, consensus/economics/address-format/transaction-semantic change.
12. Direction D remains selected; this front only reconciles the wallet states.

## Authority ceiling

This run may create an isolated candidate branch, software-only code/tests/evidence, a draft PR, and verification artifacts. It may not merge a production-bound rebrand, deploy a public rebrand, activate mainnet, alter consensus/economics/address format, or create backend custody.
