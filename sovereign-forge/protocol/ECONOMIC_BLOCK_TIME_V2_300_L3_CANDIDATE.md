# FAE Economic + Block-Time v2 — 300s L3 Candidate

Status: **activation candidate / NOT active consensus**  
Branch: `economic-block-time-v2-300-l3`  
Focused Red Team: **L3 implementation/review active**  
Public testnet consensus: **unchanged**

## Candidate package

The candidate under review is the simple monetary package selected after the completed L2 research:

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

## Atom-level issuance

`430,000 × 14 × 2 = 12,040,000 FAE` is the theoretical geometric supply if halvings are infinitely divisible.

Consensus rewards are integer atoms. With the deliberately simple integer right-shift halving rule, the finite atom sequence terminates naturally at:

**12,039,999.9484 FAE**

That is **0.0516 FAE (5,160,000 atoms)** below the theoretical cap. L3 keeps this behavior intentionally: **no terminal top-up** is added merely to force an exact decimal total. Atom truncation may reduce issuance; it may never increase it beyond the 12.04M cap.

The executable candidate arithmetic and boundary tests now freeze this result.

## Fresh-genesis activation model

This package must not reinterpret the existing `fairyelf-public-testnet-v4` history, whose issuance and timing rules differ.

The candidate therefore has a separate network identity:

`fairyelf-public-testnet-v5-candidate-300s`

and a deterministic fresh-genesis descriptor/commitment. Its activation boundary explicitly requires:

- height 0 / issued atoms 0 at candidate genesis;
- no inherited v4 balances or v4 coinbase outputs;
- a distinct transaction domain that commits to the candidate genesis identity;
- peer compatibility requiring both the candidate network id and candidate genesis commitment;
- explicit rejection of v4 peers/transactions by candidate boundary helpers;
- v4 remaining historical test evidence rather than being rewritten as candidate history.

This is still candidate-only infrastructure and has no public activation authority.

## 200-block coinbase maturity

The maturity convention is frozen as:

> A coinbase created at height `H` may first be consumed by a block at height `H + 200`.

Mempool admission evaluates the candidate next-block height using the identical predicate. Candidate coinbase outputs are explicitly tagged with consensus-derived `created_height` and `coinbase_matures_at_height` metadata.

The candidate maturity layer now fails closed for:

- one-block-early spends;
- missing/spent inputs;
- unknown UTXO origin;
- forged maturity metadata;
- duplicate inputs.

Tests also cover multi-output/direct-PPLNS-style coinbase rewards, wallet spendability filtering, and a reorg that moves the chain from above the maturity boundary back below it. Maturity is recomputed from canonical height rather than cached from the formerly taller branch.

**Remaining maturity work:** wire this policy into a dedicated fresh-genesis candidate state machine so both real mempool admission and candidate block validation exercise it end to end. The live v4 state machine is intentionally untouched.

## Difficulty + Timestamp binding at 300s

The hardened full-target Difficulty + Timestamp design is now bound explicitly to this candidate instead of silently inheriting 180-second assumptions:

- target: **300 seconds**;
- family: anchored ASERT-style full uint256 target;
- arithmetic: integer-only;
- half-life: **21,600 seconds (6h)**;
- MTP window: **11 blocks**;
- future drift: **90 seconds**.

A frozen 300-second vector set is checked by the Node implementation and independently reproduced by a Python reference implementation. The candidate economic manifest points to those vectors and records the cross-runtime validation boundary.

This advances DAA/timestamp from an unbound blocker to an **integration-stage gate**. It is not yet authorized as live consensus until a fresh candidate node consumes the candidate DAA end to end.

## Live-v4 isolation

Candidate CI deliberately asserts that the current v4 reference still contains its existing 180-second / 10 FAE / 600,000-block / 12M parameters. It also fails if the candidate economics, DAA, maturity, or network-boundary modules are imported into the live v4 node accidentally.

Therefore L3 development can continue without turning research commits into consensus changes by side effect.

## L3 invariants

The activation candidate must fail closed unless all of the following hold:

- subsidy at height 1 is exactly `1,400,000,000` atoms;
- subsidy halves only at 430,000-block era boundaries;
- no reward path can exceed the 12,040,000 FAE theoretical cap;
- atom truncation can only reduce issuance;
- coinbase is unspendable before `H + 200` under the same rule in mempool and block validation;
- reorgs deterministically restore immaturity when height falls below the boundary;
- every candidate DAA path uses 300 seconds and the frozen full-target vector semantics;
- 20 tx/block remains an explicit capacity choice;
- candidate network/genesis identity prevents v4/v5 cross-replay and cross-sync;
- activation remains a separate explicit action after L3 passes.

## Current L3 disposition

| Area | State | Reason |
|---|---|---|
| Monetary constants | **GREEN** | Executable candidate + boundary tests |
| Atom-level issuance | **GREEN** | Exact terminal issuance and 0.0516 FAE shortfall frozen |
| 300s block-time research | **GREEN / pre-L3 ceiling** | L2 + real-WAN evidence completed |
| 600s alternative | **YELLOW / retained research challenger** | Not selected for this activation candidate |
| 900s alternative | **CLOSED** | Failed predefined promotion gate |
| Coinbase maturity policy | **GREEN at policy/test layer** | Boundary, reorg and wallet tests implemented |
| Coinbase maturity node integration | **YELLOW** | Dedicated candidate state machine still required |
| DAA/timestamp vectors | **GREEN** | Frozen 300s vectors reproduced in Node + Python |
| DAA/timestamp node integration | **YELLOW** | Candidate node must consume it end to end |
| Fresh-genesis/replay boundary | **GREEN at policy/test layer** | Candidate network/genesis/tx/peer separation implemented |
| Candidate node integration | **YELLOW** | Fresh candidate core/node still to be assembled and exercised |
| Activation authorization | **FALSE** | L3 not yet complete |

## Next implementation order

The remaining high-value work is now narrower:

1. assemble a dedicated fresh-genesis candidate core/state machine using the frozen economics, maturity, DAA/timestamp and network-boundary modules;
2. exercise real mempool admission + block validation + reorg replay under that candidate core;
3. run L3 adversarial issuance, maturity, timestamp, reorg and v4/v5 isolation tests against the integrated candidate;
4. only after those gates pass decide whether the candidate is eligible for public-testnet activation.

No public consensus change is authorized by this document.