# Representative Device Physical Autopilot

This layer operationalizes the already-frozen `FAE-RDE-ACCEPTANCE-V1-20260928` contract. It does not replace or weaken that contract.

## Two execution paths

### A. Local machine controller — preferred for Mac / Windows RTX / Steam Deck

Requires Node.js 22+.

```bash
node lab/representative-device-physical-autopilot/desktop-agent.mjs
```

For a one-command unattended physical campaign, provide only the public reward address:

```bash
node lab/representative-device-physical-autopilot/desktop-agent.mjs --reward-address faet1... --autostart-physical
```

The controller fails closed if `--autostart-physical` is used without a syntactically valid public FAE address. No private key is accepted or required.

The agent:

1. detects the local OS, CPU and commercial machine identity where the OS exposes it;
2. detects NVIDIA GPU identity/temperature/power through `nvidia-smi` when available;
3. serves the frozen browser harness on `http://127.0.0.1:43113/`;
4. opens the browser automatically;
5. receives each completed capture;
6. calls the canonical RDE `prepare-staging` → `collect-evidence` → independent verifier pipeline;
7. writes per-run bundles and `verification.json` under `.rde-physical-evidence/`.

If automatic classification is wrong or intentionally ambiguous, predeclare the class before measurement:

```bash
node lab/representative-device-physical-autopilot/desktop-agent.mjs --device-class consumer_discrete_gpu
```

The class cannot be changed after a result is collected without starting a fresh campaign.

### B. Online browser harness — preferred for iPad Safari / no-install devices

Use the public no-login harness:

`https://fae-rde-physical-autopilot-1lztsf.v2.appdeploy.ai/`

The page keeps all mining computation on the physical device. No wallet private key is required; provide only a public FAE reward address.

Identity, class, public reward address and execution mode can be prefilled in the URL. `autostart=1` performs pre-result lock and starts automatically only when the required inputs are valid. Example shape:

`?deviceClass=mobile_tablet_arm&manufacturer=...&model=...&address=faet1...&mode=PHYSICAL_EVIDENCE&autostart=1`

The Vercel branch preview remains useful for development, but the public harness above is the operational browser-only path and does not require Vercel authentication.

For browser-only execution, use **Export captures** after the campaign. Move the JSON file to any machine with Node.js 22+ and package it with:

```bash
node lab/representative-device-physical-autopilot/import-browser-portfolio.mjs --file ./fae-rde-physical-captures.json --out ./.rde-imported
```

## Physical campaign

`PHYSICAL_EVIDENCE` mode cannot scale durations:

- sustained mining: 10 min warm-up + 20 min measured × 3;
- normal-use coexistence: 60 s no-mining baseline + 5 min warm-up + 15 min measured × 3;
- mobile/tablet ARM and compact handheld: five real hidden → visible lifecycle cycles.

The harness replaces stale work against the live v4 tip and preserves raw event logs. It derives work rate from attempt counters rather than trusting the displayed rate.

The fixed timed portion is approximately **2 h 33 min per device** before any required lifecycle step. Multiple physical devices may run independently in parallel.

## Rehearsal

`REHEARSAL_ONLY` uses short durations only to verify software and deployment behavior. A rehearsal capture is marked synthetic and receives zero physical-evidence authority.

## Energy and thermals

The default energy source is `UNAVAILABLE`, which is explicitly permitted by the parent contract and blocks only efficiency claims. The system never invents power numbers.

The local agent adds thermal telemetry when a trustworthy OS tool is available. NVIDIA devices use `nvidia-smi`; Linux `lm-sensors` is used opportunistically. Missing thermal telemetry is explicit.

A non-digital wall wattmeter remains an irreducible human observation unless a machine-readable meter is attached. Such data is not required to establish the technical participation portion of RDE.

## iPad minimum human touch

The online harness can autonomously lock and run mining/coexistence workloads from a single preconfigured link. iPadOS/Safari does not expose a reliable page API that can create genuine app background/foreground events. Therefore the five lifecycle cycles must be physically caused: background Safari and return five times while the lifecycle stage is active. The harness records the real events and refuses to synthesize them.

## Selection integrity

Selection is frozen before the first measurement and bound to a live `fairyelf-public-testnet-v4` height/tip. Device fields are disabled after lock. The local agent chooses from machine discovery; the browser-only path requires the operator to declare the exact commercial model before starting.

## Authority boundary

This package may produce **candidate physical evidence** only when it actually runs on a real physical device in `PHYSICAL_EVIDENCE` mode. Final portfolio admission remains RDE-X3 and is not automatic merely because a local verifier returns PASS.

No consensus, economics, activation, mainnet readiness, mainnet authorization or new spending authority is created.
