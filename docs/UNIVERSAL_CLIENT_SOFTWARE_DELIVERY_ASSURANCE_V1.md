# Triumph Sovereign — Universal Client Software Delivery Assurance V1
**Public-safe engineering guideline / documentation-only candidate**
**Date:** 2026-11-13
**Applies to:** Windows (NSIS), Linux x64/AppImage (including handheld Linux), macOS (DMG), Electron UI, wallet, optional independent node, miner, explorer.

## Purpose and release boundary
Dedicated software is a core step in the Triumph Sovereign product journey. This document standardizes how a native desktop client is built, verified, packaged, installed, recovered and assessed, based on delivery lessons from prior native software projects and the Universal Client candidate. It is a **review candidate**; it does not modify consensus, economics, protected Wallet/Node/Miner owners, deployment, signing, schedulers or mainnet authority.

The goal is to prevent:
- announcing a desktop client solely because unit tests pass;
- forcing the operator to rebuild from terminal/source when a user-facing installer is the deliverable;
- accepting Linux CI as proof that Windows and macOS packages work;
- delivering a package with missing hashes, unclear source provenance or untested cold-start/upgrade;
- making unverified wallet/signing features appear enabled in an otherwise usable watch-only release;
- rebuilding or duplicating existing native node, miner, wallet and IPC implementations;
- treating delivery of a candidate artifact as approval for public release.

## 1. Product architecture contract: freeze this before packaging
The intended Universal Client consists of:
1. Wallet — creation, backup, recovery, watch-only, balance, transaction status and **eventual** authenticated signing/submit flow after security admission.
2. Miner — standalone operation using the original authorized node/protocol, with headless operation supported.
3. Run a Node — **optional**, with explicit enable/disable, ownership, restart and local storage semantics.
4. Explorer — a read-only view sourced from a verified original node or properly admitted gateway.

These are separate capabilities. An optional node must never silently become mandatory for wallet viewing. Do not duplicate original owner logic in an Electron renderer, replace it with simulated chain data, or make local IPC a substitute for ownership authorization.

**Target wallet flow, not a claim of current readiness:**
`CREATE → BACKUP → RECOVER → UNLOCK → REVIEW → AUTHORIZE → SIGN → SUBMIT → PENDING → CONFIRM → RESTART → RESTORE`

**Critical early-design inputs:** protocol version, network/genesis, chain history, fees and priority/fee-market semantics, UTXO/spend rules, signing ownership, wallet recovery model, transaction outbox, expected confirmations, display units, explorer sources and miner output. Unresolved economic or consensus decisions are product design gates; do not silently fill the gap with a guessed fee algorithm in the GUI.

### Feature-level truth table
| Feature | Candidate may show | Must not claim without proof |
|---|---|---|
| Watch-only | addresses, observed balances, original-source node status | signing rights or guaranteed spendability |
| Wallet backup/recovery | tested backup/recovery UI and local state | private-key custody security without source/OS review |
| Local node | observed start/stop and health for owned process | arbitrary local endpoint is trusted/owned |
| Miner | original mining runtime test on actual target | mainnet eligibility or universal performance |
| Signing/submission | only when signer, authorization and mutation gates pass | safe send flow from mock or read-only plan |
| Explorer | verified read-only data, or explicitly labeled PREBIND | live public chain data without authenticated backend |

## 2. Lessons translated into mandatory delivery gates

### UC-D0 — Exact original source and admission
- [ ] Freeze repository URL, branch, full 40-character HEAD, tree identity, relevant original component owners and target commit.
- [ ] Verify canonical sources, manifests, lockfiles and native dependencies; do not switch versions or imported Wallet/Node/Mining source silently.
- [ ] Preserve the scope of draft PRs; a successful test on a candidate PR is not an authorized merge or release.
- [ ] Classify all security-sensitive gaps as blocked: no `submit-tx`, secrets or irreversible mutation through an unadmitted path.

### UC-D1 — Contract-first integration / no retrabalho
- [ ] Define feature matrix per release (e.g. T0 = watch-only; later signer-capable releases require additional gates).
- [ ] Freeze API/IPC schema: process identity, auth, resource limits, errors, transport permissions, timeouts and versioning.
- [ ] Confirm decision about chain fees, auction/priority market, consensus and network upgrades with source-owning protocol gates **before** finalizing UX/state model. Candidate client design must not silently modify chain rules.
- [ ] Cover node ownership and session stability: revalidate original node child identity and original height/hash after asynchronous wallet planning; if state changed, revoke the plan and expose no stale inputs/outputs. Never treat a local HTTP fallback as authenticated native ownership.
- [ ] Preserve signer isolation from renderer/Explorer and avoid auto-resubmit after crash.

### UC-D2 — Tests in the actual execution environment
- [ ] Run unit/integration/security regressions on the precise source HEAD.
- [ ] Run native Electron process + IPC with the actual component source, not UI mocks alone.
- [ ] Exercise node and miner with original source, process ownership, reconnection, restart, recovery and falsification of tampered inputs.
- [ ] Test CREATE/BACKUP/RECOVER and all release-admitted actions with exact expected state, including rejected unsafe states.
- [ ] Collect distinct evidence for Linux, Windows and macOS. Passing Linux does not verify a Windows/macOS installer.
- [ ] Record failures and skips explicitly; a skipped signer test does not imply the signer works.

### UC-D3 — Native packaging, distribution and update
- [ ] Linux: AppImage x64 genuinely built and launched in Linux; where targeted, validate on the handheld Linux hardware and account for distribution-specific constraints.
- [ ] Windows: NSIS installer genuinely built and installed/uninstalled on a native Windows environment; test fresh install and upgrade.
- [ ] macOS: arm64/x64 targets declared; DMG/application launch, permissions, signing and notarization checked on a real supported macOS host when required.
- [ ] Distribute manifest with original HEAD, version, architecture, toolchain, artifacts, byte length and SHA-256; verify after retrieval.
- [ ] Release instructions must cover download, start, updates, data location, backup/recovery, uninstall and troubleshooting for a non-developer.
- [ ] Never suggest disabling OS security globally to bypass an installer problem. If signing credentials/notarization are unavailable, state the distribution limitation plainly.
- [ ] Test transaction-safe updates and rollbacks; prevent a failing upgrade from destroying existing wallet state, labels or pending-transaction recovery evidence.
- [ ] A file existing in a private artifact store is not proof that a public installer is released or retrievable.

### UC-D4 — Safety, identity and persistence
- [ ] Confirm UI renderer has no direct private-key access unless protected custody model explicitly permits it.
- [ ] Authenticate local IPC, node child identity, wallet planner source and any mutation capability.
- [ ] Protect seed/passphrase, credentials, filesystem permissions, backup files and logs; never include secrets in CI artifacts or crash reports.
- [ ] Persist transaction intent and resulting IDs atomically; preserve restart/reconciliation without automatic retransmission or double spend.
- [ ] Verify a forcibly interrupted app process, reboot, app upgrade and recovery on the same OS.
- [ ] Maintain safe states for stale tip, no peers, node replacement, bad signature, insufficient funds, outbox conflict, unavailable backend and source mismatch.
- [ ] A signed/notarized installer is authenticity evidence, not a substitute for wallet security audit.

### UC-D5 — Human target-device acceptance and closure
- [ ] On the actual device: install the produced native package, launch GUI, verify correct version/architecture, start/read original node, use watch-only and recovery, test miner and restart.
- [ ] Confirm feature labels and dangerous controls are truthful: no send/sign option represented as ready when gates remain open.
- [ ] Supply actual install/upgrade receipts, tampering tests, runtime logs, SHA outputs and clear operator instructions.
- [ ] Record separate outcomes: `SOURCE_VERIFIED`, `NATIVE_BUILT`, `PACKAGE_TESTED`, `PHYSICAL_ACCEPTED`, `SECURITY_ADMITTED`, `RELEASE_AUTHORIZED`.
- [ ] Do not infer one outcome from another. Issue reproducible blockers instead of repeated "run until green" prompts.

## 3. Native platform acceptance matrix
| Check | Linux x64 / handheld | Windows NSIS | macOS DMG |
|---|---|---|---|
| Exact source/dependencies | Required | Required | Required |
| Native build artifact, SHA-256, size | Required | Required | Required |
| Real installed GUI/Electron/IPC | Required | Required | Required |
| Original node read-only + watch-only | Required | Required | Required |
| Original miner test | Required | Required | Required |
| Restart/recovery + tampered-input rejection | Required | Required | Required |
| Install/upgrade/uninstall/rollback | Required | Required | Required |
| Platform signing/notarization | Declare actual status | Declare actual status | Declare actual status |
| Physical target-device run | Required for user acceptance | Required for user acceptance | Required for user acceptance |

If one platform is unavailable, mark `NOT_TESTED` rather than extrapolate from another. Platform-specific failures are isolated gates and should not fabricate a global PASS.

## 4. Evidence bundle template
```json
{
  "project": "Triumph Sovereign Universal Client",
  "release_channel": "private-candidate",
  "feature_profile": "watch-only",
  "source_commit_sha": "<40-hex>",
  "artifact_platform": "linux-x64 | windows-x64 | macos-arm64",
  "artifact_sha256": "<64-hex>",
  "artifact_bytes": null,
  "native_build": "UNVERIFIED",
  "actual_install_and_gui": "UNVERIFIED",
  "owner_node_and_miner": "UNVERIFIED",
  "wallet_signer_and_send": "NOT_ADMITTED",
  "restart_restore": "UNVERIFIED",
  "physical_target_acceptance": "UNVERIFIED",
  "consensus_economics_changes": "NONE",
  "release_authorization": "NONE",
  "evidence_links": [],
  "verdict": "CANDIDATE_ONLY"
}
```

This is a *schema example*, not an attestation of a current package.

## 5. Specific learning from T0 and integration work
The Linux-first strategy and source-bound tests are a valid development path: first deliver a privately verifiable Linux/AppImage candidate, then validate actual use and derive native Windows/macOS packages without rewriting Wallet/Node/Miner implementations. However:
- a Linux artifact delivered to a user is still awaiting *physical* acceptance unless installation and the user flows are confirmed on target hardware;
- client integration may pass read-only planning while signer and submit gates remain open;
- visual polishing must not mask lifecycle/security gaps or cause a duplicate implementation;
- release and economic-policy design should be reconciled before scaling the same interface to three OSes;
- failure of a native package is diagnosed at the actual OS/installer boundary, not "fixed" by repeating unit suites from another platform.

The [source-bound Universal Client draft](https://github.com/Waterfound/FAE-testnet/pull/365) is a **candidate**, not a release or security admission. Reconcile its latest status and current main before referencing a build; no PR state or historical checkpoint is frozen by this document.

## 6. Continuous integration and compute discipline
- Keep required source/security tests on PR/main; eliminate redundant triggers where structurally safe.
- Prefer reproducible public-source tests on authorized public runners. Never publish operator-private credentials or files for speed/cost savings.
- Isolate build, smoke, packaging and target-device tests; a fast unit test is useful but insufficient for deployment confidence.
- Store immutable logs/manifests/results, with failure and skipped steps counted; measure real compute consumption rather than promising savings from untested routing.
- Do not activate production nodes, mainnet rules or paid capacity merely to create an "end-to-end green" screenshot.

## 7. Reuse and change control
Before any new native software initiative, answer: why do we need another dedicated executable rather than an existing client component? Identify the exact original component owner, intended OS targets, user acceptance criteria and independent evidence path. Track corrections as the smallest tested delta. A documentation change cannot waive product or consensus gates.

**Primary user-facing sequence remains:** finish the dedicated Systems/Build Colony execution infrastructure; then resume actual Triumph Universal Client development. This guide records the product-delivery discipline for that future execution, not an authorization to initiate it now.

**Non-goals:** private infrastructure details, personal workstation configuration, secrets, wallet seeds, signing credentials, private test outputs or provider topology. These belong in their respective authorized private records, never in this public repository.
