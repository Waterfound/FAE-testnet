# FAE Economic + Block-Time v2 — Focused Red Team L2 results

Status: **research result / no consensus activation**  
Compared targets: **300 / 600 / 900 seconds**  
Evidence: deterministic economics + first-order propagation coupling + seeded stochastic DAA proxy  
Extended run: **256 seeds × 14 days × 4 scenarios × 3 candidates**

## Executive disposition

| Candidate | L2 disposition | Reason |
|---:|---|---|
| **300s** | **HOLD as research baseline** | Lowest DAA target-noise proxy, fastest shock response, exact 14 FAE / 430k / 12.04m monetary package, exact 200-block = 16h40m maturity. |
| **600s** | **YELLOW — challenger retained, not selected** | Monetary/maturity scaling is clean, but DAA observation density halves and the apparent fixed-payload stale advantage disappears in the linear throughput-neutral propagation model. |
| **900s** | **YELLOW — do not advance under current evidence** | Lowest fixed-payload race proxy, but highest DAA noise/slower shock response, atom-level monetary scaling is less elegant, and 16h40m maturity cannot be represented exactly in whole blocks. |

**No candidate is authorized for public-testnet activation by this result.** The current live consensus remains unchanged.

The 300-second value is only the **research baseline/incumbent inside this lab**. Because the current public testnet still has a different active block target, any future proposal to activate 300s itself also requires the explicit activation package and **Focused Red Team L3 before activation**.

## Extended DAA proxy

The proxy uses the same six-hour wall-clock half-life and an anchored continuous ASERT-style research approximation. It is deliberately not consensus arithmetic and is not a substitute for multi-node network evidence.

### Stable regime

| Target | Median mean interval | Median log2 target σ | P95 log2 target σ |
|---:|---:|---:|---:|
| **300s** | 300.00s | **0.09595** | **0.11681** |
| 600s | 599.88s | 0.13676 | 0.16793 |
| 900s | 899.98s | 0.17012 | 0.20635 |

Relative to 300s, median target-noise proxy is about **+43% at 600s** and **+77% at 900s**. This is consistent with the observation-density drop from 72 → 36 → 24 blocks per six-hour half-life.

### 80% hash-rate loss

| Target | Median recovery | P95 recovery | Median target σ |
|---:|---:|---:|---:|
| **300s** | **11.99h** | **14.11h** | **0.48498** |
| 600s | 12.38h | 14.84h | 0.49839 |
| 900s | 12.71h | 16.50h | 0.51010 |

All candidates recover in every seeded run under this proxy, but the tail degrades as the target lengthens.

### +80% hash-rate gain

| Target | Median recovery | P95 recovery | Median target σ |
|---:|---:|---:|---:|
| **300s** | **0.068h** | **0.317h** | **0.20515** |
| 600s | 0.156h | 0.844h | 0.22504 |
| 900s | 0.252h | 1.305h | 0.24473 |

Again, 300s responds fastest under equal wall-clock DAA half-life.

### Browser-cycle regime

| Target | Median mean interval | Median log2 target σ | P95 log2 target σ |
|---:|---:|---:|---:|
| **300s** | 299.08s | **0.24868** | **0.26411** |
| 600s | 597.98s | 0.27005 | 0.29534 |
| 900s | 897.10s | 0.29307 | 0.32097 |

The longer targets do not reveal a compensating stability advantage in the browser-cycle proxy.

## Economics and quantization findings

The baseline 300s package remains exactly representable as **14 FAE × 430,000 blocks → 12,040,000 FAE**.

At 600s, a calendar+supply-neutral transformation is also exact and simple: **28 FAE × 215,000 blocks → 12,040,000 FAE**, while 100-block maturity preserves 16h40m exactly.

At 900s, the naive ~42.0001 FAE × 143,333 pair is not atom-exact. The nearest exact pair found by the lab is **41.9921875 FAE (4,199,218,750 atoms) × 143,360 blocks**, preserving 12,040,000 FAE exactly but shifting the ~4.09-year halving calendar by **6h40m**. Coinbase maturity also quantizes: 67 blocks = **16h45m**, five minutes above the 300s baseline.

These are not fatal defects, but they are real complexity costs that a 900s candidate must earn back with measured network benefits.

## Stale / propagation result

With a fixed five-second propagation delay, first-order block-race pressure falls from ~1.65% at 300s to ~0.83% at 600s and ~0.55% at 900s.

However, preserving the reference nominal throughput requires roughly 20 / 40 / 60 transactions per block. Under the deliberately conservative linear-delay proxy (5 / 10 / 15 seconds), `delay / target` becomes identical and the first-order race probability returns to ~**1.65% for all three**.

Therefore the lab does **not** credit 600s or 900s with a stale-rate win until real block propagation measurements show sufficiently sublinear payload scaling.

## L2 gate outcome

The L2 review closes the easy coupling failures: target-only edits are forbidden; atom-level supply exactness is enforced; maturity quantization is explicit; and throughput/stale claims must be evaluated together.

The remaining discriminating evidence is empirical: real multi-node propagation, measured stale rate under comparable throughput, independent-node WAN/partition behavior, mining participation cycles and payout/feedback UX. Until those measurements show a material advantage for a longer target, **300s remains the correct research baseline**.

L3 is intentionally **not started yet** because this L2 pass did not authorize an activation candidate. If 300s, 600s or 900s is later chosen for public-testnet activation, L3 becomes mandatory before the activation boundary.
