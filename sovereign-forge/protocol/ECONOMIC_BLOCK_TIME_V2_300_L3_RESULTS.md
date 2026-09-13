# FAE Economic + Block-Time v2 — 300s L3 Results

Status: **profile-bound L3 software closure / NOT active consensus**  
Candidate branch: `economic-block-time-v2-300-l3`  
Public v4 consensus: **unchanged**  
Activation authority: **FALSE**

## Executive disposition

The 300-second candidate has now closed the remaining profile-to-core software gap. The validated candidate core derives its consensus identity from the selected profile rather than treating the activation profile as side metadata.

Current candidate package remains:

- target block interval: **300 seconds**;
- initial subsidy: **14 FAE**;
- halving interval: **430,000 blocks**;
- theoretical geometric cap: **12,040,000 FAE**;
- integer-atom terminal issuance: **12,039,999.9484 FAE**;
- coinbase maturity: **200 blocks**;
- reference capacity: **20 tx/block**;
- DAA family: anchored ASERT-style full target, 6h half-life;
- MTP window: 11 blocks;
- future drift: 90 seconds.

The candidate remains non-activating. Nothing in this file authorizes migration of the public testnet.

## Gate 1 — profile-bound candidate core

**PASS.**

`fae-v5-300-core.mjs` now consumes a validated profile/consensus binding directly. State creation records the profile id, profile-derived genesis commitment, profile-derived initial target and transaction-domain commitment. The first DAA target is read from that binding rather than from a hard-coded launch target. Block templates commit the profile id and profile-derived genesis. Block validation rejects a mismatched profile or genesis. Replay and reorganization reconstruct state under the same binding.

Transaction verification is also bound to the profile-derived signing domain. A dedicated non-test activation-profile test demonstrates that a transaction signed for the correct profile verifies, while the same transaction signed for the old unbound candidate domain is rejected. This prevents two launch profiles with different genesis/target commitments from silently sharing a transaction-signing domain.

The resulting boundary is:

`activation profile -> runtime binding -> genesis identity + first DAA target + transaction domain -> block/tx validation -> replay/reorg`

while still returning `activationAuthorized=false` and `publicConsensusChanged=false`.

## Gate 2 — one-process integrated semantics

**PASS.**

The integrated candidate state machine exercises economics, signed transactions, fees, UTXOs, the exact 200-block coinbase maturity boundary, full-target DAA/timestamps, deterministic replay, chainwork reorganization, detached-transaction resurrection and v4/v5 isolation under the profile-bound core.

A coinbase created at height `H` remains first spendable by a block at height `H + 200`.

## Gate 3 — three-process profile-bound network

**PASS at internal single-host scope.**

A dedicated three-process harness starts three separate candidate-node processes and verifies the profile-derived identity on every process, the profile-derived first target, rejection of a foreign profile, equal-work local-tip preservation and deterministic convergence after one branch acquires greater work.

This is process isolation and consensus-boundary evidence. It is not geographic WAN or independent-operator evidence.

### Legacy harness note

The older full three-node L3 controller was written before profile-bound signatures became mandatory and signs its maturity transaction with the obsolete unbound candidate domain. Once the core became strict, that old controller correctly began returning `invalid_signature`. It is no longer authoritative for the new signing boundary and was removed from the dedicated profile-bound CI path rather than weakening the new verifier for backward compatibility.

The maturity/reorg semantics themselves remain covered by the integrated profile-bound core test and by the earlier distributed runs. Migrating that legacy controller is optional test-harness cleanup, not a consensus blocker.

## Gate 4 — strict future activation-profile path

**PASS for mechanism; real calibration evidence remains pending.**

A structurally valid future public-testnet profile is converted into a consensus binding whose:

- genesis commitment equals the profile activation-genesis commitment;
- first DAA target equals the profile initial target;
- transaction domain commits to the profile id and genesis;
- state is marked `activationProfileReady=true` but still `activationAuthorized=false`.

Changing the launch target or the calibration-evidence digest changes the activation-genesis commitment. The easy CI profile cannot be mistaken for a launch profile.

## Gate 5 — substantially larger one-machine network

**PASS at N2 scale-semantics scope.**

The 16-process harness remains GREEN. It exercises sparse topology, an 8/8 equal-work partition, deterministic higher-work reconciliation, four simultaneous partitions, process termination, clean restart and catch-up. This proves materially larger process/topology scale on one host without mislabeling it as independent infrastructure.

## Dedicated CI closure

Dedicated run **34732985377** completed successfully with all gates GREEN:

1. syntax and economic invariants;
2. 200-block maturity invariants;
3. fresh-genesis/network boundary;
4. fail-closed activation profile;
5. strict non-test launch-profile binding;
6. DAA/timestamp vectors in Node and independent Python reproduction;
7. integrated one-process profile-bound core;
8. local three-process profile-bound core;
9. 16-process one-machine profile-bound scale path;
10. fail-closed activation boundary and explicit guard that live v4 consensus has not imported candidate code.

## Network evidence ladder

| Level | Evidence | State |
|---|---|---|
| N0 | Deterministic profile-bound state machine | **GREEN** |
| N1 | Multiple independent processes on one host | **GREEN** |
| N2 | 16-process sparse topology / partitions / restart | **GREEN** |
| N3 | Geographic WAN propagation under one operator | **GREEN from Block-Time v2 WAN evidence** |
| N4 | Multiple infrastructure providers under one operator | **YELLOW — next external empirical gate** |
| N5 | Genuinely independent node operators | **UNAVAILABLE / external ceiling** |

A larger node count is therefore no longer the principal unknown. The remaining network uncertainty is failure-domain and operator independence.

## Current disposition

| Area | State |
|---|---|
| 300s economics / issuance | **GREEN** |
| 200-block maturity semantics | **GREEN** |
| 300s DAA/timestamp vectors | **GREEN** |
| Cross-runtime DAA reproduction | **GREEN** |
| Activation-profile mechanism | **GREEN** |
| Profile -> genesis commitment | **GREEN end-to-end** |
| Profile -> initial DAA target | **GREEN end-to-end** |
| Profile -> transaction-signing domain | **GREEN end-to-end** |
| Profile-bound block validation/replay/reorg | **GREEN** |
| One-process integrated core | **GREEN** |
| Three-process profile-bound core | **GREEN** |
| 16-process one-machine scale semantics | **GREEN** |
| Geographic WAN propagation evidence | **GREEN** |
| Real launch initial-target calibration/freeze | **YELLOW — real hashrate evidence required** |
| N4 multi-provider validation | **YELLOW — external execution required** |
| N5 independent-operator validation | **UNAVAILABLE / external ceiling** |
| Public activation authorization | **FALSE** |

## Remaining high-value sequence

The local software block has reached its practical pre-external ceiling. The next sequence is deliberately narrow:

1. collect representative real hashrate evidence and derive/freeze the launch initial target through the activation-profile mechanism;
2. execute the prepared N4 multi-provider candidate validation when a second provider can actually run the candidate node;
3. rerun the complete L3 suite against the frozen real launch profile;
4. obtain N5 independent-operator validation if and when a genuinely separate operator exists;
5. only then make an explicit public-testnet activation decision.

Until then, `activationAuthorized` remains **false** and public v4 consensus remains unchanged.
