# FAE Tokenomics — Manifesto / Documentation Notes

Status: useful doctrine notes derived from the authoritative tokenomics decision of 2026-10-04.  
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

## Note — Reward and supply remain separate knobs

The authoritative decision here is:

- **10 FAE initial reward**;
- **14,026,000 FAE hard monetary ceiling**;
- **45% subsidy reduction per era**;
- **6-year era duration**.

The starting reward and monetary ceiling are therefore no longer calibration knobs. The remaining implementation problem is to translate the six-year calendar intent into an atom-exact integer block interval once the final block target is frozen.

> **The reward curve is fixed first: 10 FAE at genesis, -45% every six-year era, never exceeding 14.026M FAE. Implementation must fit the curve; the curve must not be retuned to fit implementation.**

## Note — Why 10 FAE is fixed

> **FAE starts at 10 FAE per block. That starting point is authoritative.**

The initial subsidy is part of the monetary identity of FAE, not a placeholder to be adjusted later. The authoritative starting reward is 10 FAE per block.

This preserves a simple monetary story: a 10 FAE starting reward, a six-year cadence, and a 45% reduction that leaves meaningful issuance available across future generations.

## Note — Hard ceiling versus scheduled issuance

> **14,026,000 FAE is the authoritative maximum, not a requirement that the final atom-exact schedule mint the last fraction of an FAE.**

Recursive flooring to whole atoms may leave a small permanently unissued remainder. That is preferable to exceeding the monetary ceiling.

Under the cap-aligned 300-second candidate translation, 631,170 blocks per era would schedule approximately **14,025,999.85342830 FAE**, leaving **0.14657170 FAE** permanently unissued below the cap.

This is a Bitcoin-oriented property: the ceiling is an upper bound; deterministic integer arithmetic may finish slightly below it.

## Related mining doctrine

The tokenomics direction complements the mining-economics principle:

> **FAE tenta transformar mineração de uma corrida por compute density em uma corrida por memory economics.**

And the participation principle:

> **Bitcoin buys dedicated efficiency. FAE tries to reuse general-purpose capacity.**

The monetary schedule should reinforce, rather than undermine, that hardware philosophy.
