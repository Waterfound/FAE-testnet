# Representative Device Evidence Readiness

This package prepares, verifies and documents a future physical representative-device campaign. It does **not** create physical evidence.

## Frozen contract

Contract: `FAE-RDE-ACCEPTANCE-V1-20260928`.

The initial portfolio requires four structurally different classes: mobile/tablet ARM, thin-and-light integrated, consumer discrete GPU, and compact/handheld consumer hardware. At least two ISA families and three form factors must be represented. General-purpose CPU is an expansion class, not a substitute for a required class.

Actual device models must be locked in `selection-lock.json` before measurements. Selection after seeing FAE results is invalid.

## Physical protocol

For each selected device, run the required workloads under the frozen environment declaration:

- pure mining: 10 min warm-up + 20 min measured, 3 valid repetitions;
- normal-use coexistence: 5 min warm-up + 15 min measured, 3 valid repetitions, against a no-mining interaction baseline;
- lifecycle recovery: at least 5 transitions for mobile/tablet and compact-handheld classes;
- useful-work or temporary-node coexistence only when the tested candidate currently makes that exact claim and its revision is frozen.

A single favorable burst is never enough. The core sustained-retention threshold is 70%. Normal-use p95 interaction latency must remain at or below 2.0× the no-mining baseline, with zero failed scripted interactions and recovery within 120 s. Critical thermal events or shutdowns are material risks.

## Energy evidence

Energy source is always explicit: `WALL_POWER`, `BATTERY_DELTA`, `COMPONENT_TELEMETRY`, or `UNAVAILABLE`. Different source classes are not mixed for efficiency comparisons. Missing energy can leave technical participation evidence admissible but blocks an efficiency claim; Physical HFB Economics remains a separate gate.

## Collection

Platform-specific tooling produces raw observations. The universal collector packages those observations, derives integrity metadata and emits a checksummed bundle. This separation is deliberate: a Node process cannot directly read an iPad wall meter or all OS thermal sensors. Operators should never hand-edit final bundle JSON when the collector can derive it.

Future physical procedure:

1. choose an eligible model and freeze the selection lock before any FAE result;
2. prepare the device exactly as declared;
3. connect a wall meter when required/available;
4. run the platform-specific workload/harness;
5. export raw observations and miner log;
6. run `collect-evidence.mjs` to create the immutable bundle;
7. run `verify-evidence.mjs` independently;
8. after all required repetitions/classes exist, run `verify-portfolio.mjs`.

## Rehearsal

`run-rehearsal.mjs` creates synthetic, short-duration fixtures only. Every rehearsal bundle is permanently labeled `REHEARSAL_ONLY`; it can test software and false-PASS resistance but can never satisfy RDE-X1/X3.

## Historical evidence

Pre-contract measurements remain historical/reference unless independently admitted without rewriting their provenance. MTS-12 physical iPad evidence and ASIC/F2 evidence are semantically separate gates.

## Authority boundary

No consensus, economics, activation, release, mainnet readiness, mainnet authorization or new spending authority is created here.
