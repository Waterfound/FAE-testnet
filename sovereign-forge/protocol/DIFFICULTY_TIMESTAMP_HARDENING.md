# FAE Difficulty + Timestamp Hardening — candidate gate

Status: **candidate-not-active-consensus**

This work hardens the next FAE difficulty/timestamp design without changing the current v4 consensus authority. `fae-v4-core.mjs` remains authoritative until an explicit activation decision is made after simulation, shadow observation and public-testnet evidence.

## Why this gate exists

The current v4 core uses a 20-block batch retarget and integer leading-zero `difficulty_bits`. That is adequate for the functional testnet lineage, but it is not the intended mainnet-oriented design for a browser-heavy PoW network with rapid hash entry/exit. The current timestamp rule also relies on parent monotonicity plus a local future-clock bound.

The 180-second protocol research gate requires the difficulty algorithm and timestamp rules to be designed together: per-block anchored exponential adjustment, deterministic integer arithmetic, median-time-past, bounded future drift, cross-implementation vectors and adversarial timestamp tests.

## Candidate design

- Target interval: **180 seconds**.
- DAA family: anchored ASERT-style per-block target computation.
- Arithmetic: **integer-only** in the candidate consensus calculation; no `Math.log`, `Math.log2`, floating exponent or platform-dependent floating-point target math.
- Target representation in this research layer: full unsigned 256-bit target. This deliberately avoids pretending that the current integer `difficulty_bits` header can express a smooth per-block target.
- MTP window: **11 blocks**.
- Parent rule: candidate timestamp may not move behind the parent timestamp.
- Future drift: **90 seconds** in the candidate test rule.
- Easiest target: equivalent to the current 12-leading-zero-bit floor.
- Candidate half-lives tested: **6, 12, 24 and 48 hours**.
- Provisional testnet candidate: **6 hours**. This is not a mainnet ratification.

The ASERT fixed-point polynomial follows the published aserti3-2d structure: 16.16 fixed-point exponent, truncating division, arithmetic/floor shift decomposition and the published cubic approximation. FAE uses its own 180-second ideal interval and tests its own half-life range rather than copying BCH's production constant.

## Deterministic severe-hash-change comparison

Expected-value replay from an on-schedule anchor, using an instantaneous 80% hash-rate loss (network falls to 0.2x) and +80% gain (network rises to 1.8x):

| Half-life | 80% loss: expected block <=10 min | 80% loss: <=6 min | +80% gain: expected block >=2 min |
|---:|---:|---:|---:|
| 6 h | ~4.84 h | ~12.10 h | ~2.54 h |
| 12 h | ~9.49 h | ~24.16 h | ~5.02 h |
| 24 h | ~18.95 h | ~48.09 h | ~10.01 h |
| 48 h | ~37.53 h | ~96.14 h | ~19.95 h |

The 6-hour candidate is therefore the only member of the precommitted 6/12/24/48-hour set that returns an 80%-loss network to an expected <=10-minute block interval within five hours. It is intentionally provisional because shorter half-lives trade faster recovery for greater response to ordinary Poisson timing noise.

## Timestamp manipulation bound

With a 90-second absolute future-drift budget, the first-order ASERT target-easing bound is approximately:

- 6 h: 2,888 ppm (~0.289%)
- 12 h: 1,444 ppm
- 24 h: 722 ppm
- 48 h: 361 ppm

The important property is that forward drift is an absolute wall-clock lead, not an additive per-block allowance. A miner cannot legitimately accumulate +90 seconds on every successive block while remaining inside the future-clock rule.

## Frozen vectors

`protocol/DIFFICULTY_TIMESTAMP_VECTORS.json` freezes:

- exact target-hex outputs on schedule;
- exact +/- one-half-life power-of-two target changes;
- half-half-life polynomial outputs;
- MTP and future-drift boundaries;
- the candidate parameter set.

Any second implementation must reproduce these vectors byte-for-byte before activation can be considered.

## Fail-closed activation boundary

This package MUST remain non-authoritative until all of the following hold:

1. deterministic vectors pass in at least two independently implemented runtimes;
2. timestamp boundary/adversarial tests pass;
3. seeded stochastic simulations quantify ordinary-regime target variance for 6/12/24/48 h;
4. hash loss/gain, daily browser cycles and miner timestamp strategies do not produce pathological oscillation;
5. a shadow observer runs on the public testnet without changing accept/reject decisions;
6. header/codec migration for a full target representation is specified and dual-validated;
7. independent-node multi-host soak + chaos + WAN testing is available;
8. activation height/anchor is explicit, reproducible and rollback-safe.

Until then, the current v4 core remains authoritative and this module is research/test-only.
