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

Under the 7 FAE / 300-second reference scenario, remaining issuance is approximately:

- year 20: 14.14% under six years versus 9.15% under five;
- year 30: 5.03% versus 2.77%;
- year 40: 1.94% versus 0.84%.

These figures are reference evidence for the era-duration choice, not a frozen final supply.

## Note — Calendar intent, deterministic consensus

> **Six years is the economic calendar intent; final consensus should enforce it through an atom-exact integer block interval derived from the final block target.**

The design should not depend on discretionary wall-clock intervention. If the final target block interval changes, the block count must be recomputed rather than silently stretching or compressing the six-year monetary cadence.

## Note — Reward and supply remain separate knobs

The authoritative decision here is:

- **7 FAE initial reward**;
- **45% subsidy reduction per era**;
- **6-year era duration**.

The starting reward is therefore no longer a calibration knob. The approximately **9.818M FAE** terminal issuance obtained under the 300-second reference scenario remains informative rather than fully authoritative because the final block target and exact era block count are still open.

This separation is intentional:

> **The starting reward is fixed. Final supply must emerge from the authoritative reward curve together with the finally selected block-time and atom-exact era length, rather than by retuning the 7 FAE start after the fact.**

## Note — Why 7 FAE is fixed

> **FAE starts at 7 FAE per block. That starting point is authoritative.**

The initial subsidy is part of the monetary identity of FAE, not a placeholder to be adjusted later merely to hit a preferred round-number supply. Future work may determine the exact terminal supply implied by the final block-time package, but it should not back-solve by changing the 7 FAE starting reward.

This preserves a simple monetary story: a modest starting reward, a slower six-year cadence, and a 45% reduction that leaves meaningful issuance available across future generations.

## Related mining doctrine

The tokenomics direction complements the mining-economics principle:

> **FAE tenta transformar mineração de uma corrida por compute density em uma corrida por memory economics.**

And the participation principle:

> **Bitcoin buys dedicated efficiency. FAE tries to reuse general-purpose capacity.**

The monetary schedule should reinforce, rather than undermine, that hardware philosophy.
