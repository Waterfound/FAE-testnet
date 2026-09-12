# FAE Economic + Block-Time v2 — Focused Red Team L2 results

Status: **research result / no consensus activation**  
Compared targets: **300 / 600 / 900 seconds**  
Evidence: deterministic economics + propagation sensitivity + mining/payout variance + seeded stochastic DAA proxy  
Extended run: **256 seeds × 14 days × 4 scenarios × 3 candidates**

## Executive disposition

| Candidate | L2 disposition | Reason |
|---:|---|---|
| **300s** | **HOLD as research baseline** | Lowest DAA target-noise proxy, fastest shock response, exact 14 FAE / 430k / 12.04m monetary package, exact 200-block = 16h40m maturity, and lowest payout-event variance at equal expected issuance. |
| **600s** | **YELLOW — only meaningful challenger retained; not selected** | Monetary/maturity scaling is exact and clean, but DAA observation density halves and payout variance rises. It must earn a measured propagation/stale advantage at comparable throughput. |
| **900s** | **YELLOW — do not advance under current evidence** | Highest DAA noise/slower shock response, highest payout-event variance, atom/calendar and maturity quantization costs, with no demonstrated measured stale advantage yet. |

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

## Propagation sensitivity — measurable promotion thresholds

The first-order race model is `P(race) = 1 - exp(-delay / target)`. Starting from the 300s reference with 5s propagation, the baseline race pressure is ~1.65%.

A longer target only earns stale-rate credit if **measured propagation at comparable throughput** remains sufficiently below the proportional break-even delay:

| Candidate | Break-even delay vs 300s | Delay for ≥25% lower race pressure | Delay for ≥50% lower race pressure |
|---:|---:|---:|---:|
| 300s | 5.00s | 3.74s | 2.49s |
| **600s** | **10.00s** | **7.48s** | **4.98s** |
| **900s** | **15.00s** | **11.23s** | **7.47s** |

This converts the stale discussion into falsifiable empirical gates. For example, a 600s design that needs ~10s to propagate its throughput-neutral block has **no first-order stale advantage** over the 300s/5s baseline. To claim a material 25% improvement, measured comparable-throughput propagation should be at or below ~**7.48s**. For 900s, the corresponding threshold is ~**11.23s**.

Therefore fixed-payload comparisons are insufficient. A challenger advances only on measured end-to-end propagation with the block payload/capacity policy it actually intends to use.

## Mining payout variance and participation cost

Under the calendar+supply-neutral branch and equal miner hash share, expected payout per unit wall-clock time stays approximately unchanged, but block wins become less frequent and individually larger. For Poisson block wins, that increases payout variance over a fixed horizon:

| Target | Reward ratio vs 300s | Block-rate ratio | Relative expected payout/time | Relative payout variance/time | Relative payout σ over fixed horizon |
|---:|---:|---:|---:|---:|---:|
| **300s** | 1.000× | 1.000× | 1.000× | 1.000× | **1.000×** |
| **600s** | 2.000× | 0.500× | 1.000× | **2.000×** | **1.414×** |
| **900s** | 2.99944× | 0.333× | ~0.99981× | **~2.99888×** | **~1.732×** |

Thus 600s and 900s impose a real solo/on-chain reward-lumpiness cost even when long-run expected issuance is nearly unchanged. Pool/share systems can smooth user-visible payouts, but that does not erase the underlying block-event frequency or the protocol design burden around non-custodial payout accounting.

## Confirmation security normalization

At equal total network hash rate, expected work required per block scales approximately with target interval while expected blocks per unit time scale inversely. Their product—**expected chainwork per unit wall-clock time**—is therefore approximately invariant.

So raw confirmation count must not be used to claim that 600s or 900s is intrinsically safer or weaker. Roughly six 300s blocks, three 600s blocks and two 900s blocks all represent about 30 minutes of expected chainwork under equal network hash rate, before accounting for variance and real network conditions.

The correct security comparison is **cumulative work / time + reorg probability under measured conditions**, not block count alone.

## L2 gate outcome

The L2 review now closes or operationalizes the main easy-to-hide couplings: target-only edits are forbidden; atom-level supply exactness is enforced; maturity quantization is explicit; throughput/stale claims must be measured together; payout variance is charged; and confirmation comparisons are normalized by work/time.

The remaining discriminating evidence is empirical: real multi-node propagation at comparable throughput, measured stale rate, independent-node WAN/partition behavior, mining participation cycles, and payout/feedback UX. Under present evidence:

- **300s remains the research baseline.**
- **600s is the only longer-target challenger worth retaining**, because its monetary and maturity transformations are exact. It should not advance unless comparable-throughput propagation is **<10s**, and a meaningful promotion case should target **≤7.48s** to demonstrate at least ~25% lower first-order race pressure than the 300s/5s reference.
- **900s should not advance now.** A meaningful case would need propagation **≤11.23s** for the same ~25% race-pressure improvement while also compensating for the higher DAA noise, ~1.732× payout σ, atom/calendar complexity and maturity quantization.

L3 is intentionally **not started yet** because this L2 pass did not authorize an activation candidate. If 300s, 600s or 900s is later chosen for public-testnet activation, L3 becomes mandatory before the activation boundary.
