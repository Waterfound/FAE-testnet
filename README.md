# Fairyelf (FAE) public testnet

This repository is the canonical, versioned source for the Fairyelf public testnet. A live deployment is an output of this repository; Vercel, Supabase, ChatGPT and any single operator are replaceable infrastructure rather than protocol authorities.

## Source layout

- `/index.html` and the root JavaScript files are the static public-testnet client deployed by Vercel.
- `/tests` verifies wallet derivation, recovery, signing, watch-only mining and the browser network-status state machine.
- `/supabase` contains the source exported from every active FAE Edge Function, plus the consolidated v4 database migration.
- `/sovereign-forge` is the byte-for-byte export of FAE Sovereign Forge `main` commit `c82dc04a2a38e6200f2b31c321960a86140313ad969f73d102177483d5cf4e52`.
- `/sovereign-forge/node` is the independent Node.js reference node.
- `/sovereign-forge/protocol` contains the current consensus specification and the non-consensus FAE-RW1 activation policy.
- `/sovereign-forge/supabase` preserves the corresponding source as it existed in the pinned Forge commit.
- `/FAE_FORGE_MAIN.sha256` pins every exported Forge blob to its original content hash.

The Forge export was imported without merging the open `readiness/legacy-bootstrap-sync` change request. Only its merged `main` state is represented here.

## Reproducible verification

Node.js 22 or newer is required.

```sh
sha256sum -c FAE_FORGE_MAIN.sha256
(cd supabase && sha256sum -c SOURCE_MANIFEST.sha256)
node --check core.js
node --check wallet-crypto.js
node --check wallet.js
node --check mining.js
node --check network-status.js
node tests/crypto-compat.mjs
node tests/client-smoke.mjs
npm ci --prefix sovereign-forge/node
npm run --prefix sovereign-forge/node check
node sovereign-forge/tests/smoke-independent-node.mjs
```

GitHub Actions runs these checks on every push and pull request.

## Deployment flow

```text
GitHub main -> Vercel Git integration -> public browser testnet
```

A push to `main` can therefore produce the browser deployment without an active ChatGPT Work session. The direct ChatGPT-to-Vercel route remains optional, not authoritative.

Consensus/backend releases are deliberately stricter: the versioned Supabase code is present in this repository, but it must not deploy automatically from an ordinary frontend push. Consensus changes require explicit review, test vectors and a separately authorized deployment.

## Current public-testnet constants

- Maximum supply: 12,000,000 FAE
- Initial block reward: 10 FAE
- Target block interval: 180 seconds
- Current v4 halving era: 600,000 blocks
- Premine, treasury and administrative mint: none

Testnet FAE has no monetary value and creates no claim on future mainnet FAE.

## Security boundary

Private keys and signing remain on the user's device. Browser Proof of Work remains on the mining device, and rewards are paid directly to the selected FAE address.

FAE-RW1 is documented as an experimental ASIC-resistance candidate only. The live v4 network continues to validate its existing double-SHA-256 Proof of Work until explicit activation gates are satisfied.

This source publication improves sovereignty and reproducibility; it does not make the prototype mainnet-ready or replace independent security review.
