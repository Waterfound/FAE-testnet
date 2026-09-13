# FAE v5 300s — L3 Network Independence Ladder

Status: **candidate validation framework / NOT active consensus**

This document separates network **scale** from network **independence** so that a large one-machine test is useful without being mislabeled as independent-operator evidence.

| Level | Evidence class | What it proves | Current state |
|---|---|---|---|
| N0 | Single state-machine process | Core deterministic semantics | GREEN |
| N1 | Multiple independent processes on one host | Process isolation, HTTP boundaries, reorg/mempool consistency | GREEN at 3 nodes |
| N2 | Substantially larger multi-process network on one host | Peer-topology scale, partitions, equal-work policy, convergence, restart/catch-up under resource contention | ACTIVE GATE: 16-process harness |
| N3 | Multiple geographic hosts under one operator | Real WAN propagation and geographic latency | GREEN for earlier Block-Time v2 propagation evidence |
| N4 | Multiple infrastructure providers under one operator | Provider/failure-domain diversity | NOT YET PROVEN |
| N5 | Independently operated nodes | Operator independence, deployment variance, independent configuration/maintenance | EXTERNAL CEILING |

## Why one machine is still valuable

A single physical host can run many isolated node processes. That does **not** create independent operators or real WAN paths, but it can close a large part of the previously broad “larger network” uncertainty:

- dozens of independent process states;
- sparse peer graphs instead of a three-node full mesh;
- equal-work competing branches;
- higher-work convergence;
- multi-partition reconciliation;
- process termination and fresh restart;
- catch-up from a clean node;
- contention for CPU, memory, sockets and scheduler time;
- deterministic preservation of the non-activation boundary.

The one-machine scale gate therefore upgrades **node-count/process/topology evidence**, not geographic or operator independence.

## Current 16-process gate

`candidate-net-lab/run-one-machine-scale-l3.mjs` launches 16 separate Node processes on one CI host and exercises:

1. sparse peer topology and common-chain convergence;
2. an 8/8 partition that produces two equal-work tips;
3. reconnection while equal work is preserved locally rather than replaced arbitrarily;
4. extension of one branch and deterministic higher-work convergence;
5. four simultaneous partitions with different branch lengths;
6. reconciliation to the highest-work branch;
7. termination of one process;
8. restart from clean state and catch-up from peers;
9. final convergence with `activationAuthorized=false` and `publicConsensusChanged=false`.

A PASS here is evidence for **N2**, not N4/N5.

## Path beyond one machine

The next meaningful external step is not merely “more nodes.” It is diversity of failure domains. The preferred progression is:

**N2 one-machine scale → N3 geographic hosts → N4 multi-provider → N5 independent operators.**

The existing Render WAN work already supplies N3 evidence for propagation. A future N4 experiment can use the same candidate protocol across at least two infrastructure providers while preserving one operator. N5 cannot be honestly manufactured by spawning more processes ourselves; it requires at least one genuinely separate operator to deploy and maintain a node independently.

Until those external gates exist, the project should report them as unavailable evidence rather than as software defects or activation blockers that can be solved by relabeling a local harness.
