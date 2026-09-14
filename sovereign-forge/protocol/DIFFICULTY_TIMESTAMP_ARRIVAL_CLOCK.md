# Difficulty + Timestamp Hardening II — arrival-clock integration

Status: **candidate/lab-only; no consensus activation**.

## Problem and scope

The shadow network already had full-target arithmetic, MTP, branch-derived
activation context, durable replay and WAN recovery evidence. Its sync plumbing
still used intrinsic validation for activated headers/bodies and an artificial
one-year-forward time for legacy validation. Those choices supported accelerated
rehearsals but did not establish receiver-clock admission.

This continuation closes that integration gap. It changes the shadow/candidate
paths only. The historical 180 s migration fixtures and their policy identity
remain frozen. The separate 300 s economic candidate, subsidy, halving interval,
maturity and mainnet activation decision are not revised by this gate.

## Semantics

| Operation | Clock behavior | Other validation |
| --- | --- | --- |
| Incoming activated headers | Receiver wall clock; existing 90 s limit | Target, MTP, parent ordering, commitments, PoW and policy |
| Incoming legacy headers | Receiver wall clock; existing legacy 120 s limit | Existing v4 header validation |
| Downloaded bodies | Clock sampled again after download | Header/body commitments and candidate validation |
| Preferred-branch adoption | Clock checked again inside the adoption lock | Current fork preference and complete storage-chain validation |
| Local Lab append | Same arrival gate | Complete block and state validation |
| Stored history, fixture initialization and status replay | Explicit intrinsic replay; independent of the current wall clock | Linkage, ordering, difficulty/target, PoW and commitments remain checked |

The legacy validator has no arrival-check switch. During **explicit intrinsic
replay only**, the wrapper supplies each stored header's own timestamp to that
validator. This removes dependence on the current clock without bypassing its
remaining checks or changing the live v4 core. The artificial one-year offset is
removed from both shadow paths.

A block that is too early for the receiver is deferred. It does not change the
live or stored tip. A later sync can accept the identical valid block once the
receiver reaches the allowed boundary; there is no permanent invalid-block cache
for this condition. A correction that moves the clock backwards after admission
does not retroactively invalidate stored history.

The production-shaped Lab entry point uses `Date.now`. A function-valued clock
can be injected directly into the local test constructor. There is no HTTP,
environment-variable or peer-supplied switch to disable arrival validation.
Session authentication clocks are unchanged. Status exposes
`timestamp_policy: arrival-wall-enforced-replay-intrinsic-v1`; this is a behavior
marker, not proof of NTP accuracy.

## Honest-clock envelope correction

For producer and receiver offsets bounded by ±30 s, their largest relative lead
is **60 s**. An upper bound of 5 s on relay delay includes zero-delay delivery, so
no part of that delay can be subtracted from a worst-case guarantee. The 90 s
wall therefore has **30 s headroom**, not 35 s.

An exact 5 s relay still gives a 55 s lead. That is a particular observation,
not the guarantee over all delays in [0, 5 s]. The helper models an honest
producer stamping its current time; a template raised by its parent/MTP floor
must still pass normal arrival validation.

## Verification

`tests/difficulty-timestamp-arrival-clock.mjs` exercises eight bounded cases:

1. Clock-envelope corners and the entire zero-to-maximum-delay interpretation.
2. Activated header/body agreement at the wall, at activation and its successor.
3. Preservation of the legacy 120 s rule in the mixed sequence.
4. Clock-independent intrinsic replay with body validation retained.
5. Header-phase deferral before body download and acceptance at the exact wall.
6. Clock sampling after each download, including a backward correction.
7. Fail-closed unavailable/invalid arrival clocks.
8. Loopback shadow-peer sync, local append, adoption-lock recheck, unchanged
   durable state on deferral, retry and restart after a backward clock correction.

These use fixed valid historical Lab fixtures and controlled receiver time.
They do not change system clocks or send test blocks to the public testnet.
The two older accelerated local peer suites now use a fixed historical start so
their generated 6 h/48 h branches remain behind actual arrival time.

The dedicated `Difficulty Timestamp Arrival Clock` workflow preserves the
original deterministic/stochastic/observer suites, independent Python vectors,
mixed-header rehearsal and full-activation rehearsal alongside this gate.

## Evidence limits and next gate

This is local integration evidence. Existing WAN/reorg results remain evidence
for their pinned commits and exercised properties; they do not retroactively
prove the new arrival behavior. The next useful empirical step is to carry this
clock-policy marker and measured clock-health evidence into a fresh multi-host
run. Absolute UTC accuracy, tolerance of clocks outside the declared envelope,
long-duration soak and 300 s/mainnet activation are not established here.
