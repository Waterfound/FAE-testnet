# Canonicalization status — 2026-09-03

## Completed in this change set

- Captured the live public-testnet consensus/API Edge Function source.
- Captured the chain-feed and consensus-audit Edge Function source.
- Reconstructed the current Postgres schema, constraints, indexes, RLS posture and state-transition RPCs into a versioned migration.
- Wrote `protocol/CONSENSUS.md` from the live implementation.
- Implemented a standalone Node.js 22 validating node with no third-party runtime dependencies.
- Added local persistence, UTXO/mempool validation, Ed25519 transaction verification, PoW validation, chain feed, peer relay and verified chain synchronization.
- Added deterministic cumulative-work fork selection for the independent-node network layer.
- Added GitHub Actions verification and an isolated mining/state-transition smoke test.
- Smoke test passes: fresh node mines/accepts a real 18-bit block and credits the 10 FAE reward.

## Blocked by GitHub integration scope

The connected GitHub integration can read `Waterfound/FAE-testnet`, but GitHub returned HTTP 403 `Resource not accessible by integration` for both branch creation and file creation. Therefore this change set has **not** been committed to the repository yet.

Required GitHub App/connector repository scope: at minimum **Contents: Read and write**. For the intended branch + PR workflow, also grant **Pull requests: Read and write**.

## Still required before the public browser is fully decentralized

- Move the remaining live browser files (`index.html`, `core.js`, `wallet-crypto.js`, `wallet.js`, `bip39-en.js`) into Git history.
- Replace the hard-coded browser API origin with node selection/failover.
- Make Vercel production deploy only from the canonical Git commit/build.
- Run at least 3 independently hosted public nodes and test propagation, forks/reorgs, partitions and recovery.
- Harden peer discovery against eclipse/Sybil attacks before mainnet.


## Canonical 9 continuation checkpoint — 2026-09-03

- Confirmed the canonical Vercel project is `fairyelf-fae-testnet` and is linked to `Waterfound/FAE-testnet`.
- Confirmed the two public Vercel domains are currently pinned to different frontend deployments: `fairyelf-fae-testnet.vercel.app` serves the older artifact, while `fairyelf-fae-testnet-waterfound.vercel.app` serves the newer dual legacy/FAE-RW1 frontend artifact.
- Confirmed the live `fae-public-testnet-v4` backend remains legacy PoW consensus. FAE-RW1 has **not** silently replaced consensus.
- Added `protocol/FAE-RW1_ACTIVATION.md` to make the experimental/activation boundary explicit.
- Added `browser/network-status.js` with the canonical dynamic labels: `Connecting…`, `Network online`, `Network offline`.
- GitHub repository metadata reports push permission, but branch creation still returns HTTP 403 `Resource not accessible by integration`; therefore canonical Forge history remains the safe source-of-truth until repository write scope is actually usable.
- Production alias promotion remains pending because the available Vercel connector can inspect/deploy projects but does not expose an alias reassignment operation. Do not overwrite the canonical domain with a regressed frontend merely to remove the alias divergence.
