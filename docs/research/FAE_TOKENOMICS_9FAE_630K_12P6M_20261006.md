# FAE Authoritative Tokenomics — 9 FAE / 630,000 / -45% / 12.6M

Status: **AUTHORITATIVE DESIGN / NOT ACTIVE CONSENSUS**  
Date: 2026-10-06

## Authoritative monetary profile

- initial subsidy: **9 FAE/block**;
- subsidy reduction per era: **45%**;
- retained subsidy: **55%**;
- era length: **630,000 blocks**;
- hard monetary ceiling: **12,600,000 FAE**;
- issuance: **finite geometric**;
- perpetual tail inflation: **none**;
- premine / treasury / administrative mint: **none**.

The compact schedule is:

`R(0) = 9 FAE`

`R(n+1) = floor(R(n) × 55 / 100)` in atoms

with each reward level lasting exactly **630,000 blocks**.

The natural theoretical supply is:

`9 × 630,000 / (1 - 0.55) = 12,600,000 FAE`

With deterministic flooring to whole atoms at each era transition, the scheduled terminal issuance is:

**12,599,999.81100000 FAE**

leaving **0.18900000 FAE** permanently unissued below the hard ceiling.

## Calendar interpretation

Block count is the authoritative monetary cadence.

At the current 300-second block-time research incumbent:

- 630,000 blocks = **2,187.5 days**;
- ≈ **5.98905 years**;
- approximately **4 days shorter than six reference years**.

Therefore the design preserves the intended ~six-year cadence while using a simple exact consensus integer.

The 300-second block target remains separately unresolved and is not promoted by this tokenomics decision.

## Distribution profile

The first era emits exactly **5,670,000 FAE**, or 45% of the theoretical supply.

The reward sequence begins:

- 9.00000000
- 4.95000000
- 2.72250000
- 1.49737500
- 0.82355625
- 0.45295593
- 0.24912576
- 0.13701916
- ...

The fraction still unissued after each complete era is geometric:

- after era 1: **55.0000%**;
- era 2: **30.2500%**;
- era 3: **16.6375%**;
- era 4: **9.150625%**;
- era 5: **5.03284375%**.

This is the intended intergenerational-distribution property: scarcity increases strongly while meaningful primary issuance remains available to later cohorts.

## Why this package is preferred

The package is mathematically compact:

> **9 FAE → 630,000-block eras → -45% → 12.6M FAE**

The max supply is not independently back-solved. It emerges naturally from the starting reward, era size and retention ratio.

The 630,000-block era is also close to the previously selected six-year economic cadence at the 300-second research incumbent, while being easier to encode, verify and reason about in consensus.

## Authority boundary

This decision supersedes the previous future tokenomics authority of **10 FAE / 14.026M**.

It does not change the currently running public testnet and creates no activation height, release, production or mainnet authority.
