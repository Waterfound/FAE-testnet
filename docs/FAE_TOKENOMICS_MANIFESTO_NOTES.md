# FAE Tokenomics — Manifesto / Documentation Notes

Status: useful doctrine notes derived from the current authoritative tokenomics decision of 2026-10-06.  
These notes guide design and documentation; they do not activate consensus.

## Note — Orient with Bitcoin, do not mechanically imitate it

> **FAE orients with Bitcoin; it does not mechanically imitate it.**

Bitcoin is the reference for finite, deterministic, non-discretionary issuance. FAE should preserve those virtues without inheriting every distribution choice merely because Bitcoin used it.

## Note — Scarcity without excessive temporal privilege

> **Scarcity should not require concentrating most monetary opportunity near genesis.**

A finite supply and a long distribution tail are compatible. FAE can remain scarce while leaving meaningful primary issuance available to people and machines that arrive many years after launch.

## Note — Hardware generations and issuance generations should align

> **If general-purpose hardware should remain relevant across generations, primary issuance should remain materially available across generations.**

FAE's mining philosophy is not only that future general-purpose machines should remain technically capable of mining. They should encounter a network in which primary issuance is still economically meaningful.

This joins two goals:

- general-purpose hardware across generations;
- general-purpose participation across generations.

## Note — Halvings are security-budget events

> **A subsidy reduction is not only a scarcity event; it is also a repricing of miner revenue and therefore of the security budget.**

The protocol should not treat halving cadence as a cosmetic monetary parameter. Every discrete reduction changes miner economics, potential hash participation and the time available for fees to mature as a complementary security source.

## Note — Why 45%, not 50%

> **A 45% reduction preserves strong geometric scarcity while making each subsidy discontinuity smaller than a 50% halving.**

The retained reward is 55% per era:

`R(n+1) = 0.55 × R(n)`

The sequence remains finite and strongly declining, but its tail is longer:

`100% → 55% → 30.25% → 16.64% → 9.15% → 5.03% → ...`

There is no perpetual inflation implied by this rule.

## Note — Why six years

> **Six years is long enough to span technology generations without being so long that scarcity loses its cadence.**

Relative to a five-year era:

- the interval is 20% longer;
- subsidy-event frequency is 16.67% lower;
- the same 45% shock occurs less often;
- later cohorts retain materially more primary issuance.

Under the six-year / -45% curve, the fraction of issuance remaining is approximately:

- year 20: 14.14% under six years versus 9.15% under five;
- year 30: 5.03% versus 2.77%;
- year 40: 1.94% versus 0.84%.

These figures are reference evidence for the era-duration choice, not a frozen final supply.

## Note — Calendar intent, deterministic consensus

> **Six years is the economic calendar intent; final consensus should enforce it through an atom-exact integer block interval derived from the final block target.**

The design should not depend on discretionary wall-clock intervention. If the final target block interval changes, the block count must be recomputed rather than silently stretching or compressing the six-year monetary cadence.

## Note — Exact block cadence

> **FAE's monetary clock is measured in blocks.**

The authoritative subsidy era is **630,000 blocks**. This is preferable to encoding an approximate calendar duration into consensus.

At the current 300-second research incumbent, 630,000 blocks are approximately **5.989 years**, only four days short of six reference years. The economic intuition remains ~six-year eras, while the protocol rule is exact and deterministic.

## Note — Why 9 FAE and 630,000 blocks fit together

> **9 FAE × 630,000 blocks × the 45% first-era share = a natural 12.6M monetary scale.**

The first era emits:

`9 × 630,000 = 5,670,000 FAE`

Because the first era represents 45% of the theoretical geometric supply:

`5,670,000 / 0.45 = 12,600,000 FAE`

This is not a round-number supply chosen first and reverse-engineered afterward. It emerges directly from the starting reward, era length and retention ratio.

> **The parameters explain the supply, rather than the supply forcing the parameters.**

## Note — Hard ceiling versus atom-exact issuance

> **12,600,000 FAE is the authoritative hard ceiling.**

Recursive flooring to whole atoms produces an atom-exact terminal schedule of **12,599,999.81100000 FAE**, leaving **0.18900000 FAE** permanently unissued.

The protocol should never mint upward merely to hit the display ceiling exactly. Deterministic integer arithmetic finishing infinitesimally below the cap is preferable to exceeding it.

## Note — The compact monetary identity

The current authoritative monetary identity can be stated in one line:

> **9 FAE genesis subsidy → 630,000-block eras → -45% per era → 12.6M FAE maximum.**

This compactness is useful for users, implementers and independent verifiers. The economic rule can be explained without hidden calibration constants.

## Related mining doctrine

The tokenomics direction complements the mining-economics principle:

> **FAE tenta transformar mineração de uma corrida por compute density em uma corrida por memory economics.**

And the participation principle:

> **Bitcoin buys dedicated efficiency. FAE tries to reuse general-purpose capacity.**

The monetary schedule should reinforce, rather than undermine, that hardware philosophy.
