# Agent Build Colony — Worker D: Network Composition

Status: **candidate-only / not active consensus**

Base commit: `e3e66f2ca43a4ff071a538cbeae6b9ddc68dc510`

Worker D composes already-tested activation/reorg, headers-first sync and eclipse-readiness mechanisms. It does not create a new fork-choice rule or a new peer-discovery authority.

## Composition invariant

A candidate branch having more cumulative work is necessary but not sufficient for adoption while the local peer view is degraded.

The ordering is:

`peer-view authority -> activation-policy identity -> headers -> bodies -> cumulative-work comparison -> candidate adoption`

If peer diversity / eclipse readiness is not `READY`, remote branch access is denied before header/body fetch and the local tip is retained. This is a healthy fail-closed `NO_CHANGE`, not a consensus choice in favor of the local branch.

Once readiness returns to `READY`, the existing headers-first sync gate validates the signed activation policy, claimed tip/work, headers and bodies, then existing cumulative-work fork choice decides whether the remote branch is preferred.

## Rehearsal topology

The compact deterministic rehearsal uses the real H1-H11 legacy checkpoint prefix and a candidate-only H12 activation boundary. Both partitioned branches cross H12 independently. One branch receives an intentionally longer activation delay and therefore lower cumulative work; the other is stronger. H12 is a test boundary only, not a proposed live activation height.

## Gates

Worker D is GREEN only if:

1. both partitioned branches independently cross the candidate activation boundary;
2. `HOLD` prevents all remote header/body access and retains the current tip;
3. `READY` permits headers-first validation but does not itself force adoption;
4. cumulative work selects the stronger validated branch after reconnect;
5. the reorg common ancestor is below activation while both resulting tips are post-activation;
6. returning to `HOLD` after recovery preserves the already selected tip and performs no remote access;
7. activation-policy mismatch fails before remote fetch;
8. the existing real three-node partition/reorg/mempool recovery test remains green;
9. the existing authoritative eclipse candidate remains green for `HOLD -> READY -> HOLD`;
10. the existing deep activation-reorg gate remains green;
11. the composition module remains explicitly `candidate-not-active-consensus`.

## Authority boundary

Worker D may add composition policy, tests, evidence and CI only. It may not:

- modify the canonical fork-choice function;
- relax peer-diversity/eclipse gates;
- promote an activation policy;
- select live economic parameters or activation height;
- touch the 96-hour evidence environment;
- merge itself without independent verification and serialized integration.

The colony rule remains:

> **parallelize independent ceilings, serialize shared authority**
