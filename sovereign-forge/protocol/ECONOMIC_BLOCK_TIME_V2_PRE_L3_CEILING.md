# FAE Economic + Block-Time v2 — Pre-L3 Empirical Ceiling

Status: **research freeze / no consensus activation**  
Scope: **300s vs 600s after 900s elimination**  
WAN evidence harness: `1bdb6bdc6604ef8125ca8addf390ffff94cbad71`  
Environment: `render-oregon-frankfurt-singapore-v3`  
Authority: **research-only / no consensus authority**

## Decision boundary

This document freezes the Economic + Block-Time v2 L2 work at the highest evidence level that is economically meaningful with the present three-region public-cloud lab.

It does **not** activate a block target and does **not** alter public-testnet consensus.

## Real-WAN V3 evidence

The V3 harness removed background snapshot contamination and measured the three candidates with the same nominal throughput policy over Oregon, Frankfurt and Singapore.

| Target | Throughput | Samples | P50 | Mean | P95 | Steady stale | Stress stale |
|---:|---:|---:|---:|---:|---:|---:|---:|
| **300s** | 0.06667 tx/s | 500 | 100 ms | 111.458 ms | **116 ms** | 0 / 250 | 0 / 100 |
| **600s** | 0.06667 tx/s | 500 | 111 ms | 121.640 ms | **138.05 ms** | 0 / 250 | 0 / 100 |
| **900s** | 0.06667 tx/s | 500 | 122 ms | 151.374 ms | **298.40 ms** | 0 / 250 | 0 / 100 |

Payloads scaled with target so nominal transaction throughput remained equal: 20 / 40 / 60 synthetic 512-byte transactions per block for 300 / 600 / 900 seconds.

All three regional nodes converged with zero reorgs in the controlled serialized sample.

## Propagation gate

Using the predefined first-order race proxy `1 - exp(-delay / target)` at measured P95 propagation:

| Candidate | P95 race proxy | Ratio vs 300s | >=25% lower gate |
|---:|---:|---:|---:|
| **300s** | 0.000386592 | 1.0000x | baseline |
| **600s** | 0.000230057 | **0.5951x** | **PASS** |
| **900s** | 0.000331501 | 0.8575x | **FAIL** |

Therefore 900s is closed for this branch. It does not earn enough propagation benefit to compensate for its previously measured DAA-density, payout-variance, maturity-quantization and monetary-complexity costs.

600s remains the only technically credible longer-target challenger.

## Why another short natural-stale soak is not decision-useful

The controlled V3 stale counts are not natural competing-block stale-rate evidence, so they cannot be promoted into an observed natural stale rate.

However, the measured WAN latency also shows why a short natural-stale experiment cannot discriminate 300s from 600s with useful statistical power.

Using the measured P95 race proxies only as a planning approximation:

- 300s implies roughly one race opportunity per **2,587 blocks**, or about **9.0 days** of expected block time per event.
- 600s implies roughly one race opportunity per **4,347 blocks**, or about **30.2 days** of expected block time per event.
- A 96-hour run would contain only about **1,152 blocks at 300s** and **576 blocks at 600s**. Under the P95 planning proxies, the expected race-event counts are only about **0.45** and **0.13** respectively.
- The approximate probability of observing **zero** race events over those 96-hour windows is therefore about **64% for 300s** and **88% for 600s**.

Thus a four-day zero-stale result would be the most likely outcome and would not distinguish the candidates.

A conventional two-proportion planning calculation using the measured P95 proxy rates gives an order of magnitude near **197,000 blocks per arm** for ~80% power at a two-sided 5% significance level. At native cadence that is roughly **685 days for 300s** and **1,370 days for 600s**. This is a planning calculation, not a claim that the proxy equals the true stale probability; its purpose is to show the rare-event scale.

Accordingly, restarting another 96-hour three-node soak solely to choose 300s vs 600s would consume time while having very low probability of changing the decision.

## Pre-L3 disposition

### 300s — GREEN research incumbent

Retains the strongest aggregate L2 profile:

- lowest DAA target-noise proxy;
- highest observation density under the same wall-clock DAA half-life;
- fastest shock response in the seeded DAA evidence;
- exact 14 FAE / 430,000 block / 12.04m monetary package;
- exact 200-block = 16h40m maturity;
- lowest payout-event variance;
- excellent measured real-WAN propagation.

### 600s — YELLOW challenger, not selected

600s demonstrated a real propagation advantage in normalized race pressure and therefore remains a legitimate challenger. But the absolute race pressure is already very small at 300s under the measured three-region WAN path, while 600s pays known costs in DAA observation density and payout-event variance.

The present lab cannot obtain a statistically discriminating natural-stale comparison at native cadence without a much longer or materially larger independent network.

### 900s — CLOSED for current branch

900s failed the predefined >=25% propagation-improvement gate and retains the largest non-network costs. No additional 900s work is justified absent materially new evidence.

## Ceiling declaration

**Economic + Block-Time v2 L2 is at the practical pre-L3 empirical ceiling for the present three-region lab.**

No additional simulation, short soak, or synthetic parameter sweep is authorized merely to manufacture more evidence.

The only evidence class likely to change this boundary is genuinely larger/longer independent-network operation that produces enough natural competing blocks to estimate rare stale/reorg behavior with useful precision.

Until such evidence exists, the conservative state is:

- `researchBaseline = 300s`
- `longerChallenger = 600s`
- `900s = closed`
- `selectionAuthorized = false`
- `activationAuthorized = false`
- `publicConsensusChanged = false`
- `L3RequiredBeforeActivation = true`

If an explicit activation candidate is later selected, Focused Red Team L3 is the next gate before any public-testnet activation.
