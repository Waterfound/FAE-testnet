# Triumph Sovereign Universal Client — evidence-first baseline (2026-10-27)

**Status:** isolated engineering candidate / NO deployment / NO consensus or economics change. Source of truth: FAE `main` commit `ede1205c27c1e39d4c67a9746142a6716a38520c`. This record does not freeze future UI or authorize a merge.

## Existing implementations: reuse, never duplicate

- Browser wallet: `wallet.js`, `wallet-crypto.js`, `wallet-transactions.js`. **Do not** reuse browser localStorage JWK persistence as a desktop encrypted vault. Native encrypted Wallet/CLI is still candidate PR #342, not in main.
- Miner: `standalone/fae-miner.mjs` + `mining-core.mjs` with `--node`, `--address`, `--json`; reward **public** address only; accepted/rejected events already exist.
- Node: `sovereign-forge/node/fae-node.mjs` (Node >=22, existing GET /status, /balance, read-only /explorer/*, POST /submit-tx and /submit-block); default binds **0.0.0.0**, so a desktop wrapper MUST explicitly bind 127.0.0.1 and provide private persistent data path. Atomic durable recovery candidate remains unmerged PR #345; do not label always-on node safe before admission.
- Explorer: `explorer/api-client.mjs` + `app.mjs`; GET-only read API, mandatory FAE v4 network/tip binding. Product read-boundary consolidator PR #349 is unmerged.
- Authored Shell/Wallet product owner PR #272; do not modify owner candidate without reconciliation.

## Architecture decision — Electron 45 candidate vs Tauri 2 challenger

Existing Node miner + independent node strongly favor an Electron main-process integration without introducing a second consensus engine, while a sandboxed/context-isolated renderer consumes a narrow allow-listed IPC facade. Electron costs more RAM than Tauri. Tauri 2 potentially saves memory but requires Rust IPC/sidecar packaging and an OS-architecture-specific executable matrix for Node.js-based FAE components, multiplying the key/process-security surfaces before they are frozen. Electron 45.0.0 is the stable Oct-2026 baseline; **native runtime and OS signing tests have not occurred**. Final selection is subject to real RAM/CPU/security and package evidence.

Layering: renderer (unprivileged) -> explicit IPC -> main process read API / start-stop controller -> existing separate node + miner. Wallet-signing services must remain a separate authenticated key-management domain; NEVER give node/miner any seed, private key or vault credential.

## Visual source files — verified user inputs, not included in public PR

- **Balance** source `TRIUMPH_V7_Preview.gif`: GIF, 720x720, 125 frames, 5.21s, infinite loop metadata, SHA-256 `a69bd760ff5c787f0e4dd18d55cb444cb4ad59f49b8e0538a84d20b35209a662`.
- **Hero** source `TS_V4_Animated_HQ_1440(3).webp`: animated WebP, 1440x480, 150 frames, approximately 4.95s, one-shot loop metadata, SHA-256 `2ee4395d1769a295f8dbd56c0bc2f74604d4cb363b626d8781e168bab2e6286e`.
- The Hero last original frame yields a technical reduced-motion still (separate derivative). Neither original is regenerated, and no user binary is published by this PR.

Orange = header/identity; white/off-white = workspace; blue = actions, active process states, decisions/synchronization. Jewel and gold remain in official artwork. Hero starts on page entry, settles once and stays static; Balance loops **only** on Wallet and unmounts when hidden. No simultaneous unnecessary autoplay.

## In-session engineering artifact (local candidate, not yet merged)

A local Electron/UI source evaluation bundle was assembled for the owner with actual code for shell/IPC, loopback-only node and miner launcher, tip-bound GET Explorer queries, public-address balance lookup, Hero/Balance wiring and visual assets. Four **local unit checks** and syntax checks passed. These checks do **not** demonstrate a real Electron runtime, cross-platform installer, complete native wallet, crash-resistant node, live mining or signed release. Until the source is reviewed and moved into the canonical repository, this GitHub record is **baseline only**, not the code artifact.

## Engineering frontiers (strictly candidate/admissible)

1. Source-admit the new desktop shell in `universal-client/`, with exact version pin, no production deployment, no paid new infrastructure or overwrite of existing Wallet/Shell owners.
2. Wire genuine `/status`, `/balance`, `/explorer/*` node assertions and prove local process startup/restart with real canonical source and valid public address.
3. Integrate actual miner `--json` performance and work acceptance via a schema-validated isolated IPC transport; no fabricated metrics.
4. Reconcile wallet #342 and node atomicity #345 exact latest heads and full CI. Do not ship encrypted wallet or persistent node until admission and security tests.
5. Verify actual Hero media playback lifecycle, rest-frame geometry, reduced motion and CPU/GPU use; do not treat file metadata as rendered-runtime evidence.
6. Prepare Windows/macOS/Linux package candidates, fuses/code-signing/updater design and real OS install/uninstall tests. Signed release remains a distinct authority gate.

**Prohibited**: main merge, consensus/tokenomics modification, credential/provider changes, production deployment or release, mainnet, unauthorized cost, new unattended scheduler. Existing private Systems/General Execution gates and global Steward slots remain authoritative; this public record contains no private operational state.