# Fairyelf (FAE) — canonical public testnet source

This repository is intended to be the canonical, auditable source for Fairyelf (FAE) public testnet v4.

## Canonical flow

```text
GitHub source
   ├── protocol rules
   ├── browser miner / wallet
   ├── reference node
   ├── Supabase deployment implementation
   └── database migration
        ↓
reproducible deployment
        ↓
Vercel browser testnet + independently operated nodes
```

A deployment is not canonical merely because it is live. The protocol and source in version control are canonical; Vercel and Supabase are replaceable infrastructure.

## Repository layout

- `protocol/CONSENSUS.md` — current v4 consensus specification
- `node/` — standalone Node.js 22 reference node
- `tests/smoke-independent-node.mjs` — isolated PoW/state-transition smoke test
- `.github/workflows/verify.yml` — reproducible CI gate for the reference node
- `supabase/functions/fae-public-testnet-v4/` — source of the current public API/node implementation
- `supabase/functions/fae-chain-feed-v1/` — trust-minimized chain export used by independent verifiers/nodes
- `supabase/functions/fae-consensus-audit-v1/` — independent reconstruction/audit function
- `supabase/migrations/` — reproducible Postgres state-transition schema
- `PROVENANCE.md` — relationship to the live deployment

## Run an independent node

```bash
cd node
npm ci
npm start
```

The reference node validates the chain itself and exposes the same core mining/wallet API. Operators can connect several nodes with `FAE_PEERS`. Each process stores and validates its own chain/UTXO state; feeds and peers supply candidate data rather than authoritative state.

## Current testnet constants

- 12,000,000 FAE maximum supply
- 10 FAE initial block reward
- 180 second target block interval
- difficulty starts at 18 bits
- retarget every 20 blocks
- current v4 halving era: **600,000 blocks**

See `protocol/CONSENSUS.md` for the authoritative detail.

## Security / sovereignty rule

Private keys remain on the user's device. Proof of Work remains on the mining device. A server validates and propagates signed transactions and valid PoW; it must not custody user keys or manufacture user signatures.

## Mainnet readiness

This repository structure removes a dangerous source-of-truth dependency, but it does **not** by itself certify mainnet security. Before fair launch the node/P2P layer still needs adversarial testing, long-running multi-node fork/reorg tests, eclipse/Sybil resistance work, release signing/reproducible-build checks and preferably independent review.
