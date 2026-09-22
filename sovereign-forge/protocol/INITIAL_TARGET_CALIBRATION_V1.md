# FAE v5 300s — Initial Target Calibration V1

Status: **frozen evidence protocol / NOT active consensus**

## Purpose

The remaining local consensus parameter that must not be guessed is the launch initial PoW target. The profile-bound core can now consume a frozen target correctly; this protocol defines what evidence is required before that target may be frozen into a public-testnet activation profile.

This protocol does **not** authorize activation and does not change public v4 consensus.

## Principle

The initial target should make the expected first-block interval approximately 300 seconds for a defensible estimate of aggregate launch hashrate.

For a full 256-bit target `T` and aggregate hashrate `H`, the planning relation is:

`expected hashes ≈ 2^256 / (T + 1)`

and therefore:

`T ≈ floor(2^256 / (H * 300)) - 1`

The derived target is capped by the candidate PoW limit. The ASERT-style DAA then adapts after launch; calibration exists to avoid deliberately starting orders of magnitude too easy or too hard.

## Evidence packet

A calibration packet must contain two logically separate evidence classes.

### A. Sustained device measurements

Each physical-device trial should record:

- device class and hardware description;
- mining/runtime build or commit;
- execution environment (browser/native/WASM as applicable);
- trial duration;
- total hashes or independently derived sustained hashes/second;
- whether the trial reached a sustained thermal state;
- timestamp and operator note.

Short burst benchmarks are not launch calibration evidence. The preferred minimum is **20 minutes sustained per trial**, with repeated trials where practical.

For the public-testnet launch, the minimum useful packet is **two distinct physical device classes** with repeated sustained measurements. More hardware diversity improves the envelope but is not required merely to avoid a guessed target.

### B. Launch population model

Device hashrate is not aggregate network hashrate. The packet must explicitly state how the measured devices are converted into a launch-network estimate.

The model must freeze three aggregate values:

- `launchHashrateLowHps`;
- `launchHashrateCenterHps`;
- `launchHashrateHighHps`.

The values must satisfy `low <= center <= high` and must be justified in prose. The **center** value derives the proposed initial target. Low and high are retained to show the expected first-block-time envelope if launch participation differs from the center estimate.

No hidden multiplier or undocumented expected-miner count is permitted.

## Deterministic derivation

`initial-target-calibration-v1.mjs` consumes the frozen aggregate low/center/high hashrate envelope and produces:

- the exact 64-hex initial target;
- expected block time at low, center and high aggregate hashrate;
- a deterministic SHA-256 commitment to the calibration packet;
- `activationAuthorized=false` and `publicConsensusChanged=false`.

That digest and target are the values passed into `createActivationProfile(...)`. Because the activation profile commits both into the activation-genesis descriptor, changing the target or evidence packet changes the launch genesis commitment.

## Admission rules

A packet is **admissible for target freeze** only when all of the following are true:

1. measurements are from the actual FAE mining implementation or a byte-equivalent PoW loop;
2. evidence contains sustained physical-device measurements rather than CI-only throughput;
3. the launch population model is explicit and reviewable;
4. low/center/high aggregate hashrate is frozen before looking at resulting launch behavior;
5. the deterministic derivation reproduces exactly from the retained packet;
6. the resulting target is at or below the candidate PoW limit;
7. the complete profile-bound L3 suite passes with the frozen target;
8. activation remains separately authorized — target calibration alone cannot activate consensus.

## Evidence that is insufficient by itself

The following may be useful diagnostics but cannot independently freeze the launch target:

- GitHub Actions or other CI-runner hashrate;
- a single short browser benchmark;
- theoretical device specifications;
- nominal CPU/GPU benchmark databases;
- the easy L3 CI target;
- a target chosen merely because it produces convenient test results.

## Current state

The derivation mechanism is implemented and deterministic tests use synthetic fixture values only. Those fixtures are **not launch evidence**.

The blocker has therefore narrowed to real measurement collection. Once sustained FAE hashrate measurements and an explicit launch population envelope exist, the target can be derived and frozen without additional consensus design work.
