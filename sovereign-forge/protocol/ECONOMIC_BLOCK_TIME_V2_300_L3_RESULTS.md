# FAE Economic + Block-Time v2 — 300s L3 Results

Status: **L3 candidate validation / NOT active consensus**  
Candidate branch: `economic-block-time-v2-300-l3`  
Public v4 consensus: **unchanged**  
Activation authority: **FALSE**

## Executive disposition

The 300-second candidate has advanced through the integrated-core and internal multi-node gates without changing the public v4 chain.

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

The candidate remains non-activating. No result in this file authorizes a public-testnet migration.

## Gate 1 — integrated candidate core

**PASS.**

The candidate state machine exercises economics, signed transactions, fees, UTXOs, 200-block coinbase maturity, full-target DAA/timestamps, deterministic replay, chainwork reorganization, detached-transaction resurrection, and v4/v5 isolation in one path.

The maturity convention remains frozen as: a coinbase created at height `H` may first be consumed by a block at height `H + 200`.

The integrated path rejects the height-1 coinbase spend when proposed one block early, admits it at the exact boundary, confirms it, reconstructs state from the block log, changes to a higher-work alternative branch, resurrects the detached transaction, and reconfirms it on the winning branch.

## Gate 2 — isolated three-node HTTP candidate network

**PASS at internal L3 test-profile scope.**

The same candidate core was exercised through three independent Node processes communicating over HTTP. The CI execution environment is intentionally classified as:

`internal-multiprocess-single-ci-host`

It is **not** geographic WAN evidence and it is **not** independent-operator evidence. Any Oregon/Frankfurt/Singapore names used by this local harness are topology labels only. The earlier Block-Time v2 WAN run remains the real geographically distributed propagation evidence.

The run completed the following sequence:

1. three clean fresh-genesis candidate nodes established the same v5 candidate identity;
2. invalid target and invalid subsidy envelopes were rejected without mutating the receiving state;
3. two isolated nodes produced different equal-work tips at the same height;
4. synchronization preserved each local tip while work was equal — no arbitrary equal-work replacement;
5. extending one branch by one valid block made it higher-work and all nodes converged to it;
6. nodes were reset to clean candidate genesis after the preflight robustness probe;
7. the distributed chain was built through height 199;
8. every node rejected the height-1 coinbase spend one block before maturity;
9. every node admitted/confirmed the spend at the exact maturity boundary;
10. one node was isolated and built a longer alternative branch from height 150;
11. reconnection caused the higher-work branch to win;
12. the transaction detached by the reorg was resurrected into the mempool;
13. the transaction was reconfirmed on the winning branch at height 203;
14. a v4-network block envelope was rejected by the v5 candidate boundary;
15. all nodes finished with `activationAuthorized=false` and `publicConsensusChanged=false`.

This closes the **internal multi-node semantic integration gate**. It does not substitute for a materially larger independently operated network, which is currently unavailable.

## Gate 3 — fail-closed initial-target / activation-profile boundary

**PASS for mechanism; real calibration remains pending.**

`activation-profile-v2-300.mjs` prevents the CI pow-limit from becoming launch consensus implicitly.

A public-testnet activation profile must explicitly provide:

- a profile id that is not marked as CI/test/example;
- a valid full 256-bit initial target at or below the DAA pow-limit;
- a non-placeholder SHA-256 digest for the launch-hashrate calibration evidence;
- an evidence label;
- the frozen 300-second DAA/anchor policy;
- the candidate lineage and fresh-genesis monetary invariants.

The initial target and calibration-evidence digest are committed into a derived activation-genesis descriptor. Changing either changes the activation-genesis commitment.

The test-only easy pow-limit profile is explicitly tagged `testOnly=true`, `activationProfileReady=false`, `activationAuthorized=false`, and is rejected by the activation-profile readiness assertion.

Even a structurally valid future public profile still returns `activationAuthorized=false`: profile construction is not activation authority.

## Focused L3 robustness findings

| Probe | Result | Disposition |
|---|---|---|
| Invalid target envelope | Rejected before state mutation | GREEN |
| Invalid subsidy envelope | Rejected before state mutation | GREEN |
| Equal-work competing tips | Local tip retained; no arbitrary replacement | GREEN |
| Higher-work competing branch | Deterministic convergence | GREEN |
| Coinbase spend one block early | Rejected on every node | GREEN |
| Exact H+200 maturity boundary | Accepted/confirmed | GREEN |
| Detached transaction after reorg | Resurrected deterministically | GREEN |
| Reconfirmation on winning branch | Confirmed at height 203 | GREEN |
| v4 envelope into v5 candidate | Rejected | GREEN |
| Test pow-limit promoted as activation profile | Rejected | GREEN |
| Missing/placeholder calibration evidence | Rejected | GREEN |
| Candidate activation authority | Remains false | GREEN / fail-closed |

## Evidence boundary

Two different network evidence classes remain separate:

- the earlier Block-Time v2 work includes real WAN propagation measurements for the 300/600/900 comparison;
- the candidate-specific v5 L3 run above proves integrated consensus semantics across multiple HTTP processes on one CI host.

Neither class is relabeled as an independently operated production-like network.

## Current L3 disposition

| Area | State |
|---|---|
| 300s economics / issuance | **GREEN** |
| 200-block maturity semantics | **GREEN** |
| 300s DAA/timestamp vectors | **GREEN** |
| Node + independent Python DAA reproduction | **GREEN** |
| Integrated candidate state machine | **GREEN at L3 test profile** |
| Internal three-node HTTP integration | **GREEN** |
| Equal-work / higher-work branch behavior | **GREEN** |
| Reorg + detached-tx resurrection | **GREEN** |
| v4/v5 candidate isolation | **GREEN** |
| Explicit activation-profile mechanism | **GREEN** |
| Launch initial target calibration/freeze | **YELLOW — evidence required** |
| Candidate-specific geographic WAN rerun | **YELLOW / opportunistic** |
| Materially larger independent-operator network | **UNAVAILABLE / deferred ceiling** |
| Public activation authorization | **FALSE** |

## Remaining high-value work

The software work is now close to its pre-calibration ceiling. The remaining sequence is intentionally narrow:

1. finish the Focused L3 review against the integrated candidate/profile boundary;
2. preserve the current candidate test profile as non-activating;
3. when launch-hashrate evidence exists, derive and freeze the real initial target/anchor through the activation-profile mechanism;
4. rerun the integrated L3 suite against that frozen profile;
5. perform any larger independent/WAN confirmation that is actually available at that time;
6. only then make an explicit public-testnet activation decision.

Until those gates close, `activationAuthorized` remains **false** and the current public v4 consensus remains unchanged.
