# Triumph Sovereign Universal Client — isolated desktop candidate

Source in this folder is candidate-only and targets Windows, macOS and Linux.

## Current exact technical scope

- Electron 45 sandboxed desktop shell with isolated renderer, context bridge, IPC sender checks and no web navigation or remote code.
- Authored orange header, off-white workspace and semantic blue actions.
- Optional loopback-only FAE v4 validating node backed by the existing sovereign-forge Node.js implementation.
- Existing standalone miner subprocess requiring only a public FAE reward address, typed events and start/stop.
- Read-only network status, confirmed balance observation and Explorer, verified against the existing FAE node.
- Two separate user-supplied media modes: Wallet Balance loop; Home Hero one-shot/rest, reduced-motion still and offscreen cleanup.
- No new cryptography, wallet protocol, blockchain protocol, miner algorithm or consensus implementation.

## Test

From the FAE repository root:

    cd universal-client
    npm run check
    npm test

Node.js 22+ required. The integration test starts and stops a real existing FAE testnet node with private temporary disk state, external sync disabled and loopback binding. This does NOT make the client mainnet-ready.

To run the UI manually from a fully checked-out FAE repository, install the pinned Electron dependency using normal authorized development resources, then run:

    cd universal-client
    npm install
    npm start

Electron binaries, signing, OS installers, desktop runtime, native wallet, global OS startup and 24/7 node reliability are not yet certified.

## Canonical art custody (not published)

The user's immutable originals are kept outside this public repository:
- Balance: TRIUMPH_V7_Preview.gif, SHA-256 a69bd760ff5c787f0e4dd18d55cb444cb4ad59f49b8e0538a84d20b35209a662.
- Hero: TS_V4_Animated_HQ_1440(3).webp, SHA-256 2ee4395d1769a295f8dbd56c0bc2f74604d4cb363b626d8781e168bab2e6286e.

Place authorized byte-exact originals at assets/balance.gif and assets/hero.webp, and verified still derivatives at assets/balance-rest.png and assets/hero-rest.png, only in an authorized private local evaluation. If missing, explicit placeholders render rather than substitute fictional sovereign images.

## Security and authority gates

- This candidate does NOT create or recover encrypted wallets, sign transactions, store private keys or supply a PIN. Native encrypted wallet PR #342 is unmerged and must be admitted after independent review; existing browser localStorage/JWK is not a substitute desktop vault.
- Independent-node atomic recovery PR #345 is unmerged. This GUI uses an offline-first validating node only and cannot claim always-on operation.
- Current node port 8787 is reserved by a best-effort availability check before launch. This cannot fully prevent a local process-race/spoofing event; the exact source requires additional transport/process authentication before security-sensitive desktop release.
- Source assumes the FAE repository layout around universal-client/. Packaged ASAR paths, child runtime placement, Windows service lifecycle, macOS notarization and signed releases are not yet validated.
- The renderer does not have generic filesystem or shell access, but native Electron runtime review is still required.
- No main merge, production deployment, credentials/providers change, economics, consensus activation, new paid spend or mainnet.
