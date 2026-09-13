# FAE WAN Lab — Stability Soak V2

Status: **research/lab-only — no consensus authority**

## Purpose

Measure long-duration natural timing behavior across the three regional Render WAN nodes while preserving fail-closed semantics for real outages.

Current target duration: **24 hours**.

The 24-hour target is intentional. At a nominal 300-second block interval, a substantially shorter run does not provide enough observations for the configured one-sided Wilson 95% upper bound to fall below 1% even when zero stale blocks are observed. Twenty-four hours is also the preferred external soak duration used by the Network Recovery evidence plan.

## Topology

- A — Render / Oregon
- B — Render / Frankfurt
- C — Render / Singapore
- coordinator — Render / Virginia, service `fae-stability-soak-96h`

The service name is historical; the active V2 run duration is controlled by `FAE_SOAK_HOURS` and is currently 24 hours.

## V2 transport-resilience policy

A V1 run remained healthy for about four hours and then terminated because one HTTP operation hit an abort/timeout. V2 distinguishes short infrastructure transport faults from prolonged loss of service:

- request timeout: 12 seconds;
- attempts per request: 4;
- maximum continuous transient window: 180 seconds;
- transient start/recovery events are logged;
- the maximum observed transient outage duration is retained in the final report;
- an outage that exceeds the bound is a hard FAIL;
- a run that finishes while still in a transient outage is a hard FAIL.

This does not make consensus/network failures disappear. It only prevents a single short-lived HTTP timeout from discarding an otherwise valid long-duration experiment.

## Workload

The coordinator uses independent stochastic block clocks in each regional node, with a 300-second target and shadow DAA control. These are lab blocks, not production PoW blocks.

The long-form schedule supports:

1. baseline;
2. 80% hash-loss phase;
3. 80% hash-surge phase;
4. browser-like cyclic hash variation.

A 24-hour run currently exercises the baseline phase only. Longer runs remain useful for the later DAA stress phases but are not required to close the minimum external stability-soak gate.

## PASS criteria

At completion all of the following must hold:

- A/B/C converge to the same height and tip;
- propagation P95 < 5 seconds;
- observed natural stale rate < 1%;
- one-sided Wilson 95% upper bound for stale rate < 1%;
- no continuous transient outage exceeds 180 seconds;
- no unresolved transient outage exists at completion.

The final report also retains canonical-gap, reorg, propagation and reliability statistics.

## Previous V1 evidence

The previous run reached approximately 4.004 hours before an HTTP operation aborted. Its last checkpoint showed:

- height 49;
- 0 stale blocks;
- 0 reorgs on all three nodes;
- propagation P50 95 ms;
- propagation mean 100.62 ms;
- propagation P95 128 ms;
- propagation max 196 ms;
- Wilson upper 95% ≈ 5.23% (sample still too small for the <1% statistical gate).

The run was correctly recorded as FAIL/incomplete, not promoted to a soak PASS.

## Active V2 run

Controller commit: `d84399c7eaa25fea5bdad0a32146e14c8b9c7645`

Active configuration:

```text
FAE_SOAK_HOURS=24
FAE_REQUEST_ATTEMPTS=4
FAE_REQUEST_TIMEOUT_SECONDS=12
FAE_MAX_TRANSIENT_OUTAGE_SECONDS=180
FAE_LAB_TOKEN=local-test-token
```

The first V2 checkpoint after the authorization fix was emitted at `2026-09-13T11:35:41.719Z` with:

```text
phase=baseline
height=0
staleBlocks=0
reorgCounts=[0,0,0]
transientEvents=0
maxTransientOutageSec=0
```

This establishes that the 24-hour measurement loop started successfully. It is not itself a final PASS.

## Authority boundary

Nothing in this soak authorizes consensus activation, block-time selection, testnet activation or mainnet activation. The result is external empirical evidence for liveness, propagation and natural stale behavior only.
