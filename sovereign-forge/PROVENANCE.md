# Provenance snapshot — 2026-09-03

The source in this package was reconstructed from the actual services running the FAE public testnet on 2026-09-03.

## Live browser deployment

Vercel project: `fairyelf-fae-testnet`

Production alias: `https://fairyelf-fae-testnet.vercel.app`

The live HTML loads `bip39-en.js`, `core.js`, `wallet-crypto.js`, `wallet.js`, and `mining.js`.

## Live public node

Supabase project ref: `wfwwotuhectwknvbvgif`

Edge Function: `fae-public-testnet-v4`

Observed deployed function version: 5

Observed source SHA-256 (Supabase bundle metadata): `7ddfd6ce914609ed0b96028c5a8668c70a039d5cfd6537f1201f88b970356933`

## Chain export

Edge Function: `fae-chain-feed-v1`

Observed version: 1

Observed source SHA-256: `a0d39dde163681ddc5fd81f28bf2cbf1b40aae06bb5280ff17fa633be68377c0`

## Consensus auditor

Edge Function: `fae-consensus-audit-v1`

Observed version: 1

Observed source SHA-256: `d7633e711dde8af0e4a9aac97454ca44398959a1c9a872cd9733db4e44ad9557`

## GitHub migration status

At the time this canonical package was prepared, `Waterfound/FAE-testnet` contained only `README.md`. The connected GitHub integration could read the repository but GitHub rejected both branch creation and Contents API writes with HTTP 403 `Resource not accessible by integration`. Therefore this package must be committed once the GitHub App/connector receives repository **Contents: Read and write** permission.
