# FAE v5 300s — L3 Network Independence Ladder

Status: **candidate validation framework / NOT active consensus**

This document separates network **scale** from network **independence** so that a large one-machine test is useful without being mislabeled as independent-operator evidence.

| Level | Evidence class | What it proves | Current state |
|---|---|---|---|
| N0 | Single state-machine process | Core deterministic semantics | GREEN |
| N1 | Multiple independent processes on one host | Process isolation, HTTP boundaries, reorg/mempool consistency | GREEN at 3 nodes |
| N2 | Substantially larger multi-process network on one host | Peer-topology scale, partitions, equal-work policy, convergence, restart/catch-up under resource contention | **GREEN — 16-process gate passed** |
| N3 | Multiple geographic hosts under one operator | Real WAN propagation and geographic latency | GREEN for earlier Block-Time v2 propagation evidence |
| N4 | Multiple infrastructure providers under one operator | Provider/failure-domain diversity | NOT YET PROVEN |
| N5 | Independently operated nodes | Operator independence, deployment variance, independent configuration/maintenance | EXTERNAL CEILING |

## Why one machine is still valuable

A single physical host can run many isolated node processes. That does **not** create independent operators or real WAN paths, but it closes a large part of the previously broad “larger network” uncertainty:

- 16 independent process states in the current gate;
- sparse peer graphs instead of a three-node full mesh;
- equal-work competing branches;
- higher-work convergence;
- four-way partition reconciliation;
- process termination and fresh restart;
- catch-up from a clean node;
- contention for CPU, memory, sockets and scheduler time;
- deterministic preservation of the non-activation boundary.

The one-machine scale gate upgrades **node-count/process/topology evidence**, not geographic or operator independence.

## 16-process gate result

`candidate-net-lab/run-one-machine-scale-l3.mjs` launches 16 separate Node processes on one CI host. Dedicated candidate CI run `34732010708` completed successfully with verdict:

`PASS_ONE_MACHINE_SCALE_16_PROCESS`

The passing run established:

1. sparse peer topology and common-chain convergence;
2. an 8/8 partition producing two distinct equal-work tips;
3. reconnection while equal-work nodes retained their local tips rather than replacing them arbitrarily;
4. extension of one branch and deterministic convergence to the higher-work chain;
5. four simultaneous partitions with distinct branch lengths;
6. reconciliation to the highest-work branch;
7. termination of one node process;
8. restart from clean state and catch-up from peers;
9. final convergence across all 16 processes;
10. 13 nodes recorded at least one reorganization during the exercise;
11. `activationAuthorized=false` and `publicConsensusChanged=false` throughout the final state.

This is now **GREEN N2 evidence**. It is deliberately recorded as `singleHost=true`, `independentOperatorEvidence=false`, and `geographicWanEvidence=false`.

## Path beyond one machine

The next meaningful external step is not merely “more nodes.” It is diversity of failure domains. The preferred progression is:

**N2 one-machine scale → N3 geographic hosts → N4 multi-provider → N5 independent operators.**

The existing Render WAN work already supplies N3 evidence for propagation. The next technically achievable extension is **N4**: run the candidate protocol across at least two infrastructure providers while preserving one operator. This would test provider-level failure-domain diversity and materially narrow the remaining external uncertainty.

N5 cannot be honestly manufactured by spawning more processes ourselves. It requires at least one genuinely separate operator to deploy, configure and maintain a node independently. Until such an operator exists, N5 remains an external evidence ceiling rather than a software defect.
