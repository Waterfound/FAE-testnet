# WV-01 / WV-05 — Browser Vault Threat Model and Storage Decision

## Decision

Persistent secret material moves from private JWKs in `localStorage` to an IndexedDB vault. A browser-generated AES-256-GCM wrapping key is stored as a **non-extractable CryptoKey** in IndexedDB. Each Wallet's derived private JWK set is authenticated-encrypted with a fresh 96-bit IV and AAD bound to vault format, network and a public-information Wallet fingerprint.

The seed phrase and optional passphrase are not persisted by this architecture. The seed exists transiently during New Wallet / Recovery Wallet flows. Normal later signing restores validated derived key material from the local encrypted vault.

A browser that cannot successfully persist and reload the non-extractable wrapping key and complete an encrypt/decrypt self-test is not allowed to silently fall back to plaintext persistence.

## Wallet identity

`walletId = "wallet-" + SHA-256("FAE_WALLET_ID_V1" || network || first_address || first_public_key)`.

Only public information participates. Exact re-import of the same seed/passphrase deduplicates. A different passphrase derives a different public identity. The full digest is retained rather than a display-truncated identifier.

## What this improves

- no private JWK in ordinary localStorage for newly admitted/migrated Wallets;
- casual DevTools/localStorage inspection does not expose spend keys;
- a copied encrypted Wallet record without its wrapping-key record is not directly usable;
- authenticated encryption detects payload/AAD tampering;
- Wallet records are isolated and independently removable;
- migration can verify the new commit before deleting the legacy record.

## Security ceiling / non-claims

This is browser-local hardening, not a hardware wallet or secure enclave guarantee.

It does **not** protect an unlocked Wallet against malicious same-origin JavaScript, XSS, compromised first/third-party scripts, a fully compromised browser profile, a compromised device/OS, or an attacker who can execute with equivalent origin/profile privileges. Non-extractable means the CryptoKey cannot be exported through the WebCrypto export/wrap APIs; it does not prevent authorized script from asking the key to decrypt data.

Browser storage can be cleared by the user/browser/device. Persistent-storage APIs are best-effort and browser-policy dependent. The UI therefore promises only that a Wallet remains saved in this browser/profile until it is removed, storage is cleared/unavailable/corrupt, or a future explicit security policy changes.

Private/incognito contexts may be ephemeral or deny durable storage. Admission must surface that limitation rather than claim permanence.

## XSS boundary

Because same-origin script can call WebCrypto/IndexedDB, CSP/dependency hygiene and public-code security remain essential. This vault reduces exposure at rest; it does not convert an origin compromise into a harmless event.

## Migration boundary

`FAE_BROWSER_KEYRING_V3` and the older single-wallet record are read only for migration. Their JWK/address/public-key relationships must pass the existing cryptographic restore checks. The new vault record is encrypted, committed, decrypted, and identity-checked before legacy private-key storage is removed. On any error, legacy data is retained and the application enters a storage/recovery-required state. It never manufactures a substitute Wallet.
