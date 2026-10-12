# FAE Issuance Era — Final 5-Year vs 6-Year Verdict

Status: research terminal disposition / no consensus authority
Date: 2026-10-04
Branch: research/fae-issuance-era-5y-vs-6y-20261004

## Executive verdict

**6 YEARS / -45% PER ERA**

Within the assumptions frozen for this decision — 7 FAE initial reward, 45% subsidy reduction per era, finite deterministic issuance, and FAE's goal of preserving meaningful mining opportunity across successive generations of general-purpose hardware — the 6-year era is the preferred and final design verdict between the two candidates.

The 5-year candidate is closed as the primary choice and retained only as a sensitivity challenger.

This does not activate economics, alter public-testnet consensus, authorize mainnet, or select an activation height.

## Decisive structural result

For any calendar time t >= 0:

floor(t / 6) <= floor(t / 5)

Because the retained reward multiplier is 0.55:

0.55^floor(t/6) >= 0.55^floor(t/5)

Therefore, with the same 7 FAE initial reward, the 6-year schedule:

- never has a lower block subsidy than the 5-year schedule at the same calendar date;
- never has more subsidy transitions by the same calendar date;
- retains more future issuance at every tested calendar checkpoint;
- gives every later hardware cohort at least as much subsidy opportunity, and generally more.

Its direct monetary cost under this normalization is a larger terminal supply.

## Deterministic run

Comparison source:

- lab/economics/issuance-era-final-comparison.mjs
- source commit: 24229b4a24e56cf28fd292a5be2918321f0ed596
- source blob: e3aab0b2c03f64b45273d092cf198dde25196e08

The exact comparison logic was executed with Node.js v22.16.0.

Local execution hashes:

- source SHA-256: d0e813fcbd9aff66fb67131d69d382f3bd27b54dd1084c71b1e3db860f408a53
- output SHA-256: aa3da9cbe532b285f8fcc993759a95874df565bef3c0f262a4c075f8c0aea85f

Machine-readable receipt:

- docs/research/FAE_ISSUANCE_ERA_FINAL_RUN_20261004.json

## Fixed 7 FAE initial reward

Using 300 seconds only as an atom-exact block-count example:

| Metric | 5 years | 6 years |
|---|---:|---:|
| Blocks per era | 525,960 | 631,152 |
| Terminal scheduled issuance | 8,181,599.83403040 FAE | 9,817,919.80083648 FAE |
| Equivalent annualized subsidy decay | 11.2696% | 9.4836% |
| Equivalent subsidy half-life | 5.797 y | 6.957 y |

The 6-year terminal supply is 20% larger because every reward level persists 20% longer. It remains below the prior 12.04M research candidate.

## Distribution tail

| Network age | Remaining — 5y | Remaining — 6y | Relative 6y advantage |
|---:|---:|---:|---:|
| 10 y | 30.25% | 38.50% | +27.3% |
| 20 y | 9.15% | 14.14% | +54.5% |
| 30 y | 2.77% | 5.03% | +81.8% |
| 40 y | 0.84% | 1.94% | +131.4% |

Distribution milestones:

| Cumulative issuance | 5y | 6y |
|---:|---:|---:|
| 50% | 6.01 y | 7.21 y |
| 80% | 13.76 y | 16.52 y |
| 90% | 19.43 y | 23.32 y |
| 95% | 25.07 y | 30.09 y |
| 99% | 38.81 y | 46.58 y |

## Subsidy-shock cadence

The individual shock remains 45% in both candidates.

Six years does not make the event itself smaller. It makes:

- the era interval 20% longer;
- the event frequency 16.67% lower, because 1/6 is 16.67% lower than 1/5;
- the equivalent annualized subsidy decay approximately 9.48%, versus 11.27% for 5 years.

## External-evidence direction

The external evidence review did not identify a universal empirical optimum at exactly 5 or 6 years. It did support the direction relevant to this choice:

- Bitcoin's subsidy schedule uses large discrete reductions on a roughly four-year cadence;
- published and working research finds that subsidy discontinuities can create miner-profitability and security-budget shocks;
- empirical research finds hash supply responds to mining rewards;
- post-halving Bitcoin observations show meaningful miner/hashrate adjustment after subsidy cuts;
- fee revenue remains volatile even in a mature PoW network, so fee replacement should not be assumed to grow smoothly.

The source ledger is preserved in the machine-readable run receipt.

## Fixed-supply sensitivity

The strongest argument for 5 years appears if a terminal supply target is frozen first.

If both candidates are forced near the prior 12.04M FAE target, the real-valued initial rewards are approximately:

- 5 years: 10.30116359 FAE/block;
- 6 years: 8.58430299 FAE/block.

Under fixed terminal supply, the 6-year candidate starts with only 83.33% of the 5-year initial subsidy.

That means 5 years can provide a larger early subsidy-based security budget if final supply is immutable.

This does not overturn the current verdict because the current question freezes 7 FAE initial reward, while 12.04M remains a non-authoritative research candidate.

If a specific terminal supply is later frozen before the initial reward, this boundary must be re-evaluated.

## General-purpose hardware alignment

FAE is attempting to keep ordinary and heterogeneous computing economically meaningful over long periods. A monetary schedule that exhausts primary issuance too quickly would undermine that objective even if the PoW itself remained technically general-purpose friendly.

The design principle is:

> If general-purpose hardware should remain relevant across generations, primary issuance should remain materially available across generations.

At year 20, 6 years leaves about 14.14% of total issuance unmined versus 9.15% under 5 years.

At year 30, the difference is roughly 5.03% versus 2.77%.

That is large enough to be a design property rather than cosmetic timing.

## Bitcoin orientation

Five years is closer to Bitcoin's roughly four-year cadence. That is its clearest remaining advantage.

However, FAE already intentionally differs through a 45% reduction instead of 50% and through mining economics aimed at general-purpose hardware participation.

FAE should orient with Bitcoin, not mechanically imitate it.

## Final decision

**6 YEARS / -45% PER ERA**

Classification:

- 6 years: SELECTED_RESEARCH_PARAMETER_FOR_ERA_DURATION
- 5 years: CLOSED_AS_PRIMARY__SENSITIVITY_CHALLENGER_ONLY

Reason:

Six years preserves the desired Bitcoin-oriented properties — deterministic issuance, finite supply, geometric decline and no perpetual tail inflation — while better preserving subsidy continuity and materially extending primary issuance to future generations of general-purpose hardware.

## Authority boundary

This report creates no consensus change, public-testnet economic change, activation height, release authority, production authority or mainnet authority.

The selected era duration must later be reconciled with the finally selected block target, atom-exact block-count interval, initial reward, final supply, fee/security-budget model, coinbase maturity and activation package.
