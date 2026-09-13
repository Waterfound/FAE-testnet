# FAE Economic + Block-Time v2 — 300s L3 Candidate

Status: **activation candidate / NOT active consensus**  
Branch: `economic-block-time-v2-300-l3`  
Focused Red Team: **L3 preparation active**  
Public testnet consensus: **unchanged**

## Candidate package

The candidate under review is the simple monetary package selected by the completed L2 research:

| Parameter | Candidate value |
|---|---:|
| Target block interval | **300 seconds** |
| Initial block subsidy | **14 FAE** |
| Halving interval | **430,000 blocks** |
| Theoretical geometric maximum | **12,040,000 FAE** |
| Base unit | **100,000,000 atoms = 1 FAE** |
| Coinbase maturity | **200 blocks** |
| Coinbase maturity at target | **16h40m** |
| Reference block capacity | **20 tx/block** |
| Reference nominal throughput | **0.0666667 tx/s** |

The halving calendar is `430,000 × 300 = 129,000,000 seconds`, approximately **1,493.06 days** or **4.09 years**.

## Important atom-level result

`430,000 × 14 × 2 = 12,040,000 FAE` is the correct theoretical geometric supply if halvings are treated as infinitely divisible.

Consensus rewards are integer atoms. If each era subsidy is implemented as integer halving / right shift, the finite atom-level sequence terminates after the 1-atom era. Under that simple rule the actually mintable total is:

**12,039,999.9484 FAE**

which is **0.0516 FAE (5,160,000 atoms)** below the 12,040,000 FAE theoretical cap.

L3 policy for this candidate: **do not add a special terminal top-up merely to manufacture an exact decimal supply**. Preserve the simple halving rule, keep `12,040,000 FAE` as the hard upper cap/theoretical maximum, and document the atom-level terminal issuance explicitly. This difference is caused only by indivisible base units and does not create over-issuance.

## Activation model

This package must not silently reinterpret the existing `fairyelf-public-testnet-v4` chain. The current chain was created under different subsidy, target, halving and maximum-supply rules.

The preferred L3 activation architecture is therefore a **fresh-genesis candidate testnet epoch** rather than pretending legacy v4 issuance was generated under the new monetary curve.

Required properties:

- new candidate network/epoch identity;
- clean issuance counters from candidate genesis;
- no automatic migration of legacy v4 coinbase outputs into candidate monetary accounting;
- explicit activation/release artifact after L3 passes;
- current v4 remains readable as historical test evidence;
- mainnet remains nonexistent/unaffected.

A future decision may choose another migration architecture, but such a choice reopens L3 monetary-accounting review.

## Current implementation gaps discovered at L3 entry

The live v4 reference currently encodes 180 seconds, 10 FAE, 600,000-block halvings and a 12,000,000 FAE cap. Those values must remain untouched until activation authority exists.

Two candidate dependencies are not yet permitted to be hand-waved:

1. **Coinbase maturity enforcement.** The candidate requires 200 blocks. The current independent-node state model exposes confirmed reward UTXOs without a 200-block spendability rule. Candidate integration must tag coinbase outputs and reject spends before maturity in every mempool, block-validation and reorg path.
2. **DAA/timestamp integration.** Merely replacing `TARGET_SECONDS=180` with `300` is not an L3-complete difficulty design. The previously developed Difficulty + Timestamp hardening package must be explicitly bound to this candidate, with all wall-clock assumptions and activation semantics tested together.

Both are **activation blockers**, not reasons to alter the economic candidate itself.

## L3 invariants

The candidate implementation must fail closed unless all of the following remain true:

- subsidy at height 1 is exactly `1,400,000,000` atoms;
- subsidy halves only at 430,000-block era boundaries;
- no reward path can exceed the 12,040,000 FAE cap;
- atom truncation can only reduce issuance, never increase it;
- coinbase is unspendable for 200 confirmations/blocks according to one frozen height convention;
- reorgs restore coinbase maturity deterministically;
- mempool admission and block validation enforce the same maturity rule;
- target time is 300 seconds everywhere the DAA/timestamp package requires it, with no hidden 180-second assumption;
- 20 tx/block remains an explicit capacity choice rather than an accidental inherited constant;
- candidate network identity prevents v4/v5 cross-replay or cross-sync;
- no branch, documentation file or lab module has activation authority by itself.

## L3 disposition at start

| Area | State | Reason |
|---|---|---|
| Monetary constants | **GREEN** | Simple and internally coherent |
| Atom-level issuance | **GREEN with explicit terminal truncation** | 0.0516 FAE below theoretical cap; no over-issuance |
| 300s block-time evidence | **GREEN / pre-L3 ceiling reached** | L2 + real-WAN evidence completed |
| 900s alternative | **CLOSED** | Failed predefined propagation-improvement gate |
| 600s alternative | **YELLOW / retained research challenger** | Not selected for activation |
| Coinbase maturity implementation | **RED blocker** | 200-block consensus enforcement not yet integrated |
| DAA/timestamp binding | **RED blocker** | Must bind the hardened DAA/timestamp package explicitly |
| Fresh-genesis activation boundary | **YELLOW → implement/test** | Preferred architecture frozen here, implementation pending |
| Activation authorization | **FALSE** | L3 not yet complete |

## Next implementation order

1. freeze executable candidate constants + arithmetic invariants;
2. add candidate-only CI proving current v4 cannot be changed accidentally;
3. integrate 200-block coinbase maturity in the candidate state machine;
4. bind the hardened Difficulty + Timestamp package to 300s;
5. run L3 reorg/mempool/issuance/activation-boundary tests;
6. only then decide whether the candidate is eligible for public-testnet activation.

No public consensus change is authorized by this document.