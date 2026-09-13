# FAE Economic + Block-Time v2 — 300s L3 Results

Status: **L3 candidate validation / NOT active consensus**  
Candidate branch: `economic-block-time-v2-300-l3`  
Public v4 consensus: **unchanged**  
Activation authority: **FALSE**

## Executive disposition

The 300-second candidate has advanced through the integrated-core, three-node semantic integration and a substantially larger 16-process one-machine scale gate without changing the public v4 chain.

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

The run covers clean candidate genesis, invalid consensus-field rejection, equal-work tie behavior, higher-work convergence, exact coinbase maturity, reorg/resurrection/reconfirmation, and v4/v5 isolation. It closes the internal multi-node semantic integration gate.

## Gate 3 — fail-closed initial-target / activation-profile boundary

**PASS for mechanism; real calibration remains pending.**

`activation-profile-v2-300.mjs` prevents the CI pow-limit from becoming launch consensus implicitly.

A public-testnet activation profile must explicitly provide a non-test profile id, a valid full 256-bit initial target, a non-placeholder digest for launch-hashrate calibration evidence, an evidence label, the frozen 300-second DAA/anchor policy and the candidate fresh-genesis lineage.

The initial target and calibration-evidence digest are committed into a derived activation-genesis descriptor. Changing either changes the activation-genesis commitment. Even a structurally valid future public profile still returns `activationAuthorized=false`: profile construction is not activation authority.

### Profile-to-consensus structural binding

Additional L3 modules now make the activation profile consumable as consensus identity rather than merely metadata:

- `profile-runtime-v2-300.mjs` resolves either the explicit L3 test profile or a future validated activation profile into a runtime identity;
- the resolved runtime contains the profile id, profile-derived genesis commitment, explicit initial target, DAA parameters and calibration-evidence binding;
- `profile-consensus-binding-v2-300.mjs` binds the profile-derived genesis, initial DAA target and transaction-domain descriptor together;
- `network-boundary-v2-300.mjs` can enforce profile-aware peer compatibility and produce a profile-bound transaction-domain descriptor.

This materially closes the architecture gap between profile construction and consensus identity. The remaining integration work is narrower but still real: the existing candidate core must consume this binding directly in its state creation, first-target selection and signature-verification path. Until that wiring is complete, profile binding is **structural GREEN / core-consumption YELLOW**, not a completed activation path.

## Gate 4 — substantially larger one-machine network

**PASS at N2 scale-semantics scope.**

Dedicated candidate CI run `34732010708` launched **16 separate node processes** on one host and returned:

`PASS_ONE_MACHINE_SCALE_16_PROCESS`

The gate used a sparse peer graph rather than a full mesh and exercised an 8/8 equal-work partition, higher-work reconciliation, four simultaneous partitions, process termination, clean restart and peer catch-up. The final network converged across all 16 processes; **13 nodes recorded at least one reorganization** during the exercise.

The result is deliberately classified as:

- `processIsolation=true`;
- `singleHost=true`;
- `scaleSemanticsEvidence=true`;
- `independentOperatorEvidence=false`;
- `geographicWanEvidence=false`;
- `activationAuthorized=false`;
- `publicConsensusChanged=false`.

This means the earlier broad concern “materially larger network unavailable” has been split correctly: **larger node/process/topology scale is now GREEN**, while provider diversity and genuinely independent operators remain separate evidence classes.

## Focused L3 robustness findings

| Probe | Result | Disposition |
|---|---|---|
| Invalid target/subsidy envelope | Rejected before state mutation | GREEN |
| Equal-work competing tips | Local tip retained; no arbitrary replacement | GREEN |
| Higher-work competing branch | Deterministic convergence | GREEN |
| Coinbase spend one block early | Rejected | GREEN |
| Exact H+200 maturity boundary | Accepted/confirmed | GREEN |
| Detached transaction after reorg | Resurrected deterministically | GREEN |
| Reconfirmation on winning branch | Confirmed | GREEN |
| v4 envelope into v5 candidate | Rejected | GREEN |
| Test pow-limit promoted as activation profile | Rejected | GREEN |
| Missing/placeholder calibration evidence | Rejected | GREEN |
| 16-process sparse topology | Converged | GREEN |
| 8/8 equal-work partition | Preserved equal-work local tips | GREEN |
| Four-way partition | Reconciled to highest work | GREEN |
| Process crash + clean restart | Caught up from peers | GREEN |
| Candidate activation authority | Remains false | GREEN / fail-closed |

## Evidence boundary

The current network evidence must remain separated by what it actually proves:

- **N1:** three independent processes on one host — integrated semantic correctness;
- **N2:** 16 independent processes on one host — materially larger topology/partition/restart scale semantics;
- **N3:** earlier Block-Time v2 real WAN measurements — geographic propagation evidence under one operator;
- **N4:** multi-provider candidate network — not yet proven;
- **N5:** genuinely independent operators — external evidence ceiling.

A one-machine network can prove much more than a three-node toy topology, but it cannot honestly manufacture independent operators or independent failure domains.

## Current L3 disposition

| Area | State |
|---|---|
| 300s economics / issuance | **GREEN** |
| 200-block maturity semantics | **GREEN** |
| 300s DAA/timestamp vectors | **GREEN** |
| Node + independent Python DAA reproduction | **GREEN** |
| Integrated candidate state machine | **GREEN at L3 test profile** |
| Internal three-node HTTP integration | **GREEN** |
| 16-process one-machine scale semantics | **GREEN** |
| Equal-work / higher-work branch behavior | **GREEN** |
| Reorg + detached-tx resurrection | **GREEN** |
| v4/v5 candidate isolation | **GREEN** |
| Explicit activation-profile mechanism | **GREEN** |
| Profile-derived runtime/consensus identity | **GREEN structurally** |
| Existing core consumes profile identity end-to-end | **YELLOW — remaining software target** |
| Launch initial target calibration/freeze | **YELLOW — real evidence required** |
| Geographic WAN propagation evidence | **GREEN for Block-Time v2 comparison** |
| Multi-provider candidate validation | **YELLOW — feasible next external gate** |
| Independent-operator validation | **UNAVAILABLE / external ceiling** |
| Public activation authorization | **FALSE** |

## Remaining high-value work

The remaining sequence is now narrower:

1. wire the validated runtime/profile binding directly into the existing candidate core's genesis identity, initial-target selection and transaction-signature domain;
2. rerun integrated core, three-node and 16-process gates using that profile-bound core;
3. investigate an N4 multi-provider candidate run using separate infrastructure failure domains, without relabeling it as independent-operator evidence;
4. when launch-hashrate evidence exists, derive and freeze the real initial target/anchor through the activation-profile mechanism;
5. rerun the complete L3 suite against that frozen profile;
6. obtain genuine independent-operator validation if and when an independent operator is available;
7. only then make an explicit public-testnet activation decision.

Until those gates close, `activationAuthorized` remains **false** and the current public v4 consensus remains unchanged.
