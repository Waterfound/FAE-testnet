# FAE Issuance Era Study — 5 years vs 6 years

Status: **research-only / no consensus authority**  
Date: 2026-10-04  
Base: `bbcef7fe72693544f9c73e4aaa6b77751aa2c462`

## Question

For the proposed smoother FAE issuance curve, with a **45% subsidy reduction per era** (55% retained), is a **5-year** or **6-year** era more suitable?

## Frozen assumptions for this bounded comparison

- block target: **300 seconds**;
- initial subsidy: **7 FAE/block**;
- era transition: **reward := floor(reward × 55 / 100) in atoms**;
- base unit: **100,000,000 atoms = 1 FAE**;
- reference calendar: **365.25 days/year = 105,192 blocks/year**;
- no premine/treasury/admin mint;
- research only; no activation, release, or mainnet authority.

The 45% reduction rate is held constant. This study isolates **era duration**.

## Deterministic issuance results

| Metric | 5-year era | 6-year era |
|---|---:|---:|
| Blocks/era | 525,960 | 631,152 |
| First-era issuance @ 7 FAE | 3,681,720 FAE | 4,418,064 FAE |
| Atom-exact terminal scheduled issuance | 8,181,599.83403040 FAE | 9,817,919.80083648 FAE |
| Non-zero reward eras | 34 | 34 |
| Terminal era boundary | ~170 years | ~204 years |

The higher terminal supply for 6 years is not caused by a different decay curve. It follows solely from holding **7 FAE/block** for 20% longer in every era.

If a future design instead fixes the theoretical target near **12.04M FAE**, the initial reward can be calibrated independently. Under the same assumptions, the real-valued starting rewards are approximately:

- 5 years: **10.30116359 FAE/block**;
- 6 years: **8.58430299 FAE/block**.

Therefore supply target and era duration should remain separate policy decisions.

## Late-adopter tail

Fraction of total geometric issuance still available at selected calendar ages:

| Network age | 5-year era | 6-year era |
|---:|---:|---:|
| 5 y | 55.000% | 62.500% |
| 6 y | 50.050% | 55.000% |
| 10 y | 30.250% | 38.500% |
| 12 y | 24.805% | 30.250% |
| 15 y | 16.638% | 23.444% |
| 18 y | 12.145% | 16.638% |
| 20 y | 9.151% | 14.142% |
| 24 y | 5.856% | 9.151% |
| 30 y | 2.768% | 5.033% |
| 40 y | 0.837% | 1.938% |

Calendar time to major cumulative-distribution milestones:

| Emitted | 5-year era | 6-year era |
|---:|---:|---:|
| 50% | ~6.01 y | ~7.21 y |
| 80% | ~13.76 y | ~16.52 y |
| 90% | ~19.43 y | ~23.32 y |
| 95% | ~25.07 y | ~30.09 y |
| 99% | ~38.81 y | ~46.58 y |

The 6-year schedule stretches the same geometric curve by exactly **20% in calendar time**.

## Decision criteria

### 1. Intergenerational access to primary issuance

**6 years wins.**

At year 20, approximately **14.14%** of issuance remains under the 6-year schedule versus **9.15%** under 5 years. This materially increases the amount of primary issuance available to later cohorts.

This aligns with the FAE premise that future generations of general-purpose devices should encounter not only a technically mineable network, but a still-meaningful primary issuance opportunity.

### 2. General-purpose hardware generations

**6 years wins, with a caveat.**

FAE does not know future hardware cadences. However, a longer monetary era is less likely to concentrate multiple subsidy shocks inside the useful lifetime of a general-purpose machine. It gives new CPU/GPU/unified-memory generations a wider calendar window in which subsidy remains material.

This is a structural alignment, not a claim about any specific vendor release cadence.

### 3. Miner revenue shock

**Tie on magnitude; 6 years wins on frequency.**

Each transition cuts subsidy by the same **45%**. Six years does not make an individual transition softer than five years. It makes that shock **20% less frequent**.

For a young network with an immature fee market, less frequent subsidy shocks reduce the cadence of abrupt security-budget repricing.

### 4. Security-budget continuity before fees mature

**6 years wins.**

Holding each subsidy level for an additional year provides more time for usage and fee demand to develop before the next 45% reduction. This is particularly relevant to FAE because general-purpose participation may develop more gradually than dedicated industrial mining.

### 5. Bitcoin orientation / scarcity tempo

**5 years wins.**

Five years stays closer to Bitcoin's familiar multi-year halving rhythm and reaches scarcity milestones sooner. Six years is still recognizably Bitcoin-oriented because it remains deterministic, finite, geometrically declining, and free of tail inflation, but it is a more deliberate departure.

### 6. Monetary-policy simplicity

**Tie.**

Both require one integer block interval and the same 55% retention rule. Six years does not add algorithmic complexity.

### 7. Risk of over-long initial calibration

**5 years slightly wins.**

If the initial subsidy or security budget is badly calibrated, a 6-year era leaves the first setting in place one year longer. This is a real cost of longer monetary commitment. It should be addressed through pre-launch evidence, not discretionary post-launch monetary adjustment.

## Terminal disposition

**Preferred candidate: 6 years / -45% per era.**

The advantage is not aesthetic. It follows from FAE's stated objective of sustaining economically meaningful participation across successive generations of general-purpose hardware.

The decisive property is:

> **If general-purpose hardware should remain relevant across generations, primary issuance should remain materially available across generations.**

Five years remains a valid conservative challenger and is closer to Bitcoin's cadence. But once the -45% curve is accepted, the extra year produces a useful 20% calendar extension of the entire issuance tail, reduces the frequency of subsidy shocks, and leaves substantially more primary issuance available at 15–30 year horizons.

This study therefore recommends:

`6 YEARS / 45% REDUCTION` as the **research incumbent for era duration**, while preserving:

- **7 FAE initial reward** as a separate candidate parameter;
- final supply as a separate policy decision;
- 300s block time as a separate candidate;
- no activation or consensus change from this result.

## Important non-claim

This analysis does **not** prove that 6 years is optimal under every future fee-market, hashrate, price, or adoption path. A final monetary package should still receive adversarial review against:

- low-fee security-budget scenarios;
- high/low adoption trajectories;
- miner concentration;
- issuance capture by early hardware cohorts;
- atom-exact terminal supply;
- block-time coupling;
- coinbase maturity;
- mainnet launch conditions.

The present result is a bounded comparative preference: **6 years is better aligned with the current FAE philosophy than 5 years, given the same -45% decay rule.**
