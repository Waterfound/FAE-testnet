# FAE Economic + Block-Time v2 Lab — 300 / 600 / 900 seconds

Status: **research-only / candidate-not-active-consensus**  
Focused Red Team: **L2 active from lab start**  
Activation rule: **L3 required before any selected candidate can be activated on the public testnet**

## Authority boundary

This lab compares 300, 600 and 900-second block targets in parallel. **300 seconds is the baseline.** The lab does not change public-testnet block validity, the live DAA, timestamp rules, subsidy, coinbase maturity, fork choice, header format, or activation height.

The current public consensus remains authoritative until a separate explicit activation package is ratified. Candidate selection inside this lab is not activation.

## Baseline monetary package under study

The 300-second baseline uses the current preferred research candidate:

- target block interval: **300 seconds**;
- initial subsidy: **14 FAE/block**;
- halving interval: **430,000 blocks**;
- theoretical geometric maximum supply: **12,040,000 FAE**;
- base unit: **100,000,000 atoms = 1 FAE**;
- coinbase maturity: **200 blocks = 16h40m at 300 seconds**.

These are lab inputs, not a silent rewrite of the live public-testnet constants.

## Why target time cannot be changed alone

A target-block change is coupled to economics and state behavior. If every block-count constant is naively left untouched, 600s and 900s silently alter monetary time, maturity time, nominal capacity and confirmation UX even though theoretical supply remains unchanged.

| Metric, with block-count constants frozen | 300s | 600s | 900s |
|---|---:|---:|---:|
| Blocks/year | ~105,190 | ~52,595 | ~35,063 |
| 430k-block halving cadence | ~4.09 y | ~8.18 y | ~12.26 y |
| First-era issuance @ 14 FAE/block | ~1.473m FAE/y | ~736k FAE/y | ~491k FAE/y |
| 200-block maturity | 16h40m | 33h20m | 50h00m |
| Reference capacity @ 20 tx/block | 0.0667 tx/s | 0.0333 tx/s | 0.0222 tx/s |

Therefore the L2 review treats a target-only edit as a **coupling failure**, not as a valid candidate configuration.

## Monetary-policy branches exposed by the lab

The simulator makes three policies explicit rather than smuggling one in:

1. **Height-frozen:** keep 14 FAE and 430,000 blocks. The theoretical supply remains 12.04m FAE, but the calendar issuance curve stretches 2x at 600s and 3x at 900s.
2. **Calendar-neutral / reward-frozen:** scale halving height to preserve the ~4.09-year cadence while keeping 14 FAE/block. This contracts theoretical supply to ~6.02m FAE at 600s and ~4.013m FAE at 900s.
3. **Calendar + supply neutral, atom-exact:** search for an integer halving height and integer atom reward that preserve the 12.04m geometric supply while minimizing calendar error.

For 600 seconds the atom-exact result is simple: **28 FAE × 215,000 blocks**, preserving both the supply and the baseline halving calendar exactly.

For 900 seconds the naive real-number pair `~42.0001 FAE × 143,333 blocks` is not a valid exact monetary rule because the reward is not an integer number of atoms. The nearest exact atom-level pair inside the research search window is:

- **4,199,218,750 atoms = 41.9921875 FAE/block**;
- **143,360 blocks/halving**;
- exact geometric supply: **12,040,000 FAE**;
- calendar error versus the 300s baseline halving time: **24,000 seconds = 6h40m** over ~4.09 years.

This is a useful L2 result: monetary granularity becomes part of block-time selection. A mathematically neat scaling ratio is not sufficient if it cannot be represented exactly in consensus base units.

No branch is ratified by this lab.

## Maturity and block-count quantization

Preserving 16h40m maturity is exact at 600s: **100 blocks**. It is not exactly representable at 900s because `60,000 / 900 = 66.666…` blocks. The nearest whole-block rule is **67 blocks = 16h45m**, a +5 minute error; 66 blocks would be 16h30m.

This means a 900s candidate must either accept explicit wall-clock quantization, redefine the desired maturity, or introduce a different maturity rule. The lab does not silently choose among those policy changes.

## DAA coupling

The existing Difficulty + Timestamp research line uses an anchored ASERT-style family with wall-clock half-lives. The v2 lab keeps half-life expressed in **seconds/hours**, not in a frozen number of blocks.

For a fixed six-hour half-life the observation density is:

- 300s: **72 blocks / half-life**;
- 600s: **36 blocks / half-life**;
- 900s: **24 blocks / half-life**.

Longer target intervals therefore reduce the number of observations available to the DAA during the same wall-clock response window. A seeded anchored-ASERT research proxy is included to quantify the resulting target variance. It is explicitly floating-point research code and is **not** a consensus implementation.

## Stale / propagation coupling

As a first-order Poisson race proxy, the probability of another block appearing during propagation delay `d` is `1 - exp(-d/T)`.

At 5 seconds of propagation delay with fixed payload size:

- 300s target: ~**1.65%** race pressure;
- 600s target: ~**0.83%**;
- 900s target: ~**0.55%**.

But preserving the baseline nominal throughput requires approximately 40 tx/block at 600s and 60 tx/block at 900s. If propagation delay scales linearly with that larger payload (5s → 10s → 15s), `d/T` is unchanged and the first-order race pressure returns to ~**1.65% for all three candidates**.

This is an important L2 result: a longer block target does not provide a free stale-rate improvement if the network simultaneously increases block payload to preserve throughput. Real propagation measurements are required to determine whether scaling is sublinear enough for 600/900s to retain a material advantage.

## Confirmation and mining-event semantics

Block-count UX cannot be compared naively across candidates. Six confirmations at 300s is ~30 minutes; the same wall-clock window is about three confirmations at 600s and two at 900s. Likewise, solo-mining and block-event frequency falls 2x/3x at longer targets. Under calendar+supply-neutral issuance, per-block rewards rise roughly 2x/3x, preserving expected issuance per time but increasing event granularity and payout latency.

Any PPLNS/share-window rule expressed in blocks instead of work/time must therefore be re-reviewed before a longer target can advance.

## Focused Red Team L2 — findings/gates

| ID | Area | L2 finding / gate | State |
|---|---|---|---|
| E-01 | Economics | A block-time change must not silently stretch or compress the monetary calendar. | **BLOCKER for target-only change** |
| E-02 | Coinbase | 200-block maturity becomes 33h20m / 50h at 600/900s unless explicitly rescaled. | **BLOCKER for target-only change** |
| E-03 | Capacity | 20 tx/block halves / thirds nominal throughput at 600/900s. | **BLOCKER for target-only change** |
| E-04 | Base units | Supply-neutral reward/halving pairs must be exactly representable in atoms. | **CLOSED as lab invariant** |
| E-05 | Quantization | 900s cannot represent the baseline 16h40m maturity exactly in whole blocks. | **YELLOW / explicit policy required** |
| D-01 | DAA | Half-life must be parameterized in wall-clock time; hidden 180/300-second assumptions are forbidden. | **OPEN / test** |
| D-02 | DAA noise | 6h gives only 72/36/24 observations for 300/600/900s; quantify variance before selection. | **YELLOW / proxy favors 300s** |
| M-01 | Mining UX | Longer targets reduce block-event frequency and increase feedback/payout-event latency. | **OPEN / measure** |
| S-01 | Stales | Longer targets may reduce propagation-race pressure only after payload/throughput effects are charged. | **YELLOW / no free advantage** |
| A-01 | Activation | Lab code must have zero authority over public consensus. | **HARD INVARIANT** |
| A-02 | Activation | Choosing a winner is not activation; L3 is mandatory before testnet activation. | **HARD INVARIANT** |

## Candidate decision rule

The lab must not rank 600s or 900s above 300s merely because fixed-payload stale probability is lower. A challenger must demonstrate a net gain after charging the costs of slower confirmation UX, lower block-event frequency, DAA observation density, maturity semantics, throughput/capacity, atom-level monetary granularity and monetary-policy coupling.

The 300-second candidate remains the baseline until evidence shows that a longer interval materially improves robustness enough to justify those costs.

## Empirical gates retained from earlier block-time research

Before any activation package is considered, evidence should include:

- propagation median <1s, mean <2s, P95 <5s;
- steady stale rate <1%, stress stale rate <2%;
- rapid recovery after severe hash-rate loss/gain without pathological oscillation;
- no profitable timestamp-oscillation behavior under the candidate timestamp rules;
- no coordinator/operator required for consensus safety;
- independent-node partition/reconnect and reorg recovery;
- browser/mobile participation cycles and sustained participation tests.

A candidate that reaches the activation stage receives **Focused Red Team L3 before activation**, not after.
