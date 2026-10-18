# FAE Node for Mac M1 — candidate installer (testnet only)

## Intended operator experience

One application, not a terminal-based deployment:

1. Download the verified `FAE-Node-macOS-Apple-Silicon-candidate.zip` artifact from the FAE public workflow.
2. Open `FAE Node.app` once. It copies itself into `~/Applications`, installs a user-owned LaunchAgent, and starts the local service. **No Homebrew, Node installation, Oracle VM, sudo, private keys, external credentials, or router setup.**
3. Keep the Mac on AC power, logged in and lid open. Its display may sleep. After login/reboot the service starts automatically; a closed lid or logged-out session is not kept running by this user agent.

**Code-signing boundary:** The candidate is signed ad hoc to verify bundle integrity, not Apple Developer ID notarized. macOS Gatekeeper may require a one-time explicit user approval to open an unnotarized application. Never remove quarantine or disable macOS security. Seamless one-click distribution requires an approved Developer ID signing/notarization flow; not available under current authority.

## Verifiable code and privileges

- Node source pinned to exact, native-7/7-green **candidate** PR #345 `f0c1ae0e5b1a421c9362c5a35fe0b6ca4cc8a282`, not merged, not final production.
- Node runtime Node.js `v22.16.0`, macOS `arm64`, downloaded and SHA256-checked **during trusted macOS CI build**. It is bundled, so **the operator does not need Node.js**.
- No GUI wallet, no mining, no local private key access or public write API.
- Runtime listens **only** on `127.0.0.1:8787`; all node/explorer endpoints, including write endpoints, remain local.
- Persistent chain snapshot, identity and peer-trust files: `~/Library/Application Support/FAE Node`, private directory mode 0700; built-in recovery via source candidate.
- Logs: `~/Library/Logs/FAE Node`; user LaunchAgent: `~/Library/LaunchAgents/org.waterfound.fae-node.plist`.
- `launchd` `KeepAlive` for crash restart and `RunAtLoad` for login start; `caffeinate -s` prevents *idle system sleep while on AC power*, **not lid-close sleep**. Recovery after sudden AC power loss is software-verified only; real power-loss resilience needs device evidence.

## IMPORTANT: bootstrap and independence

**The current software is a safely packaged, loopback-only node, not yet a synchronized WAN peer or Explorer LIVE.** V6 requires independently verified, protocol-compatible P2P bootstrap peers. This package deliberately leaves `FAE_PEERS` empty rather than silently trusting an unverified public endpoint. If started without peers it exposes a local node process that may remain at genesis/height zero; the installer MUST NOT say it is synchronized. A future software-only, evidence-bound peer bootstrap registry could eliminate operator peer configuration after valid endpoints exist; no credential or WAN interface is auto-exposed.

Our own always-on Mac node can feed an Explorer read-only HTTPS gateway later, but it **cannot** satisfy the frozen external independent-operator proof (requires a third party operating their own node).

## Security and operational boundaries

- User-mode installation requires an active graphical login; no privileged boot daemon, firewall mutation, IP forwarding, port mapping, DNS, certificate requests, cloud mutation, mining or public node network publication.
- The app does not auto-update or execute network-fetched scripts. The immutable pinned source and Node runtime are built into the artifact by CI. Updating requires a new independently verified package.
- If FAE core, peer or identity semantics change, the existing archived candidate is NOT implicitly promoted.
- Local status: `~/Applications/FAE Node.app/Contents/MacOS/FAE-Node --status`; uninstall LaunchAgent only: `--uninstall`, **preserves node data**.
- Apple Silicon M1 only; Intel and Linux are not supported by this package.
- Build: `bash packaging/macos/build-app.sh` on trusted macOS CI. Candidate artifact is not a release or a mainnet node.

## Acceptance before describing this as one-click operational

CI must show actual macOS arm64 binary provenance and SHA256, app bundle structure, shell syntax, plist validity, code-sign verification, artifact checksum and immutable PR345 source pin. A physical Mac M1 launch must then independently show: Gatekeeper user path, login auto-start, localhost binding, no admin prompts, durable identity across reboot/crash, no secret export, correct tip once real peers exist, and safe recovery. Until then: `INSTALLER_CANDIDATE`, not `FAE_INDEPENDENT_PERSISTENT_NODE_24_7_OPERATIONAL`.
