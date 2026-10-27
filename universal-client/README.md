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

## Native process design revision — 2026-10-27

Electron 45 was verified as an official stable release (20 October 2026). The desktop main now uses `utilityProcess.fork` with an injected ChildProcess-shaped controller adapter rather than `ELECTRON_RUN_AS_NODE`. The candidate test harness separately exercises utility process state projection, shutdown and failure without a running Electron binary. This is a source-level architectural improvement, NOT a macOS/Windows/Linux execution claim; physical utility process startup and packaging still require evidence. Signed packaging should disable the `runAsNode` fuse and migrate the local page away from `file://` to a constrained custom protocol before release.

The Hero and Balance lifecycle tests operate against a simulated DOM and do not prove video decoding, frame-for-frame final composition or CPU/GPU consumption. Public GitHub source intentionally has no user-owned media binaries. Native browser runtime remained blocked by the local test environment administrator policy; preserve this as a scoped environment gate rather than bypassing it.

## Packaged candidate with exact FAE source (not a public release)

`npm run package:dir` uses pinned electron-builder 26.18.0 to create an **unsigned, unpacked candidate** on the current host OS; it does not publish, notarize, enable updates or create an installer.

In a full FAE checkout, the build embeds the unmodified canonical source bytes for the four existing Node/miner modules as isolated Electron `extraResources`, not a new consensus implementation. Packaged Electron `main.cjs` resolves its run-time FAE root from `process.resourcesPath/fae-runtime` while development mode continues to use the original repository root.

The scoped Linux packaging CI checks the copied bytes against the exact checkout and attempts genuine packaged GUI+Node smoke on disposable Xvfb without graphical sandbox. This is **candidate-only evidence**; `--no-sandbox` must not ship as a production default. Windows/macOS installer execution and code-signing/notarization remain distinct gates. No wallet secrets or the user's private coin/animation master assets are bundled in this public source candidate.

## Unsigned installer candidates — packaging evidence only

This isolated draft also supports `npm run package:installer:candidate`, using electron-builder to attempt NSIS (Windows), DMG (macOS), and AppImage (Linux) on ephemeral, already-authorized CI hosts. Output stays exclusively on the disposable runner: **no release or public artifact upload**.

The source-bound inspection `node scripts/verify-installer.cjs` validates one nonempty file of the appropriate target type and prints its hash and length. Linux verifies extracted AppImage resources; macOS invokes native `hdiutil imageinfo`. A successful candidate artifact build is not installation acceptance, valid code signature, sandbox/hardened-runtime certification, approved mainnet distribution, or proof that an end user can open an unsigned package without OS warnings.

Before any actual distribution, separately verify real interactive installation, userData state durability, uninstall/relaunch, update/rollback, packaged media and wallet security across all target hosts.

## Private canonical media — local opt-in packaging only

The public GitHub checkout and CI packages intentionally contain no private original artwork. The renderer's `../assets/...` image paths are therefore unavailable in those packages; they show static unavailable fallbacks rather than substituting an invented logo.

For an explicitly local Waterfound evaluation candidate only, place the exact approved files `hero.webp`, `hero-rest.png`, `balance.gif`, `balance-rest.png` in a dedicated private directory outside the public repository, set `TS_PRIVATE_MEDIA_DIR` to that absolute directory, and run `node scripts/private-media-builder.cjs --verify-only` before `npm run package:private:dir` or `npm run package:private:candidate`. The builder refuses missing, modified, symlinked, or wrong-hash assets and refuses to run when `CI=true` or `GITHUB_ACTIONS=true`. It packages privately supplied files into the app's expected `assets/` location without adding them to Git or GitHub Actions artifacts.

The resulting local binary includes the private originals and must remain under Waterfound control; **do not publish or distribute** without separate authorization. This opt-in route is a build capability, not evidence of an executed private cross-platform GUI acceptance test, signed installer, secure native Wallet, or production readiness.
