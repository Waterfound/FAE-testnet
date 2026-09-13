# FAE Economic + Block-Time v2 — 300s L3 Candidate

Status: **activation candidate / NOT active consensus**  
Branch: `economic-block-time-v2-300-l3`  
Focused Red Team: **L3 integration/review active**  
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

The executable candidate arithmetic and boundary tests freeze this result.

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

This remains candidate-only infrastructure and has no public activation authority.

## 200-block coinbase maturity

The maturity convention is frozen as:

> A coinbase created at height `H` may first be consumed by a block at height `H + 200`.

Mempool admission evaluates the candidate next-block height using the identical predicate. Candidate coinbase outputs are explicitly tagged with consensus-derived `created_height` and `coinbase_matures_at_height` metadata.

The maturity layer fails closed for one-block-early spends, missing/spent inputs, unknown UTXO origin, forged maturity metadata and duplicate inputs. Tests cover multi-output coinbase rewards, wallet spendability filtering and height rollback semantics.

The integrated candidate core now exercises the same rule through both real candidate mempool admission and candidate block application. A spend from the height-1 reward is rejected when proposed for height 200, admitted at tip 200 for candidate height 201, and then confirmed at height 201.

## Difficulty + Timestamp binding at 300s

The hardened full-target Difficulty + Timestamp design is bound explicitly to this candidate instead of silently inheriting 180-second assumptions:

- target: **300 seconds**;
- family: anchored ASERT-style full uint256 target;
- arithmetic: integer-only;
- half-life: **21,600 seconds (6h)**;
- MTP window: **11 blocks**;
- future drift: **90 seconds**.

A frozen 300-second vector set is checked by the Node implementation and independently reproduced by a Python reference implementation.

The integrated candidate core consumes this DAA/timestamp layer end to end. On-schedule blocks remain on the same full target, block validation commits the expected target, and historical replay reconstructs the same chain state.

### Initial target remains an activation-profile decision

The current L3 integration harness deliberately starts at the DAA **pow-limit/easy test target** so hundreds of candidate blocks can be mined inside CI. That target is a **test profile**, not a recommendation for public-testnet activation.

The eventual fresh-genesis activation package must explicitly freeze an initial target/anchor derived from the intended launch hash-rate and safety assumptions. L3 must not silently promote the easy CI target into public consensus. This remains a separate **YELLOW activation blocker**.

## Integrated candidate core

`node/candidate/fae-v5-300-core.mjs` now composes the previously separate candidate layers into a single non-activating state machine:

- 300s economics and subsidy accounting;
- integer-atom halving/cap behavior;
- full-target 300s DAA/timestamp validation;
- 200-block coinbase maturity in mempool and block application;
- signed candidate transaction domain;
- fee conservation and fee-to-coinbase accounting;
- deterministic UTXO materialization;
- candidate chainwork calculation;
- block replay/rebuild;
- chainwork-based reorganization;
- detached-transaction mempool resurrection;
- v4/v5 network/genesis isolation.

The integrated L3 test mines an actual candidate sequence through height 201, tests an immature spend at both mempool and direct-block paths, confirms it exactly at the maturity boundary, rebuilds the chain deterministically, creates a longer alternative branch, performs a chainwork reorg, resurrects the detached transaction and confirms it again on the winning branch. The original state remains unmodified when an invalid block is rejected.

## Live-v4 isolation

Candidate CI deliberately asserts that the current v4 reference still contains its existing 180-second / 10 FAE / 600,000-block / 12M parameters. It fails if candidate economics, DAA, maturity, network-boundary or integrated-core modules are imported into the live v4 node accidentally.

Therefore L3 work can proceed without turning research commits into consensus changes by side effect.

## L3 invariants

The activation candidate must fail closed unless all of the following hold:

- subsidy at height 1 is exactly `1,400,000,000` atoms;
- subsidy halves only at 430,000-block era boundaries;
- no reward path can exceed the 12,040,000 FAE theoretical cap;
- atom truncation can only reduce issuance;
- fees are redistributed but never counted as new monetary issuance;
- coinbase is unspendable before `H + 200` under the same rule in mempool and block validation;
- reorg/replay reconstructs maturity from canonical height and deterministic UTXO state;
- every candidate DAA path uses 300 seconds and the frozen full-target vector semantics;
- 20 tx/block remains an explicit capacity choice;
- candidate network/genesis identity prevents v4/v5 cross-replay and cross-sync;
- an activation profile must freeze its initial DAA target explicitly rather than inheriting the CI pow-limit;
- activation remains a separate explicit action after L3 passes.

## Current L3 disposition

| Area | State | Reason |
|---|---|---|
| Monetary constants | **GREEN** | Executable candidate + boundary tests |
| Atom-level issuance | **GREEN** | Exact terminal issuance and 0.0516 FAE shortfall frozen |
| 300s block-time research | **GREEN / pre-L3 ceiling** | L2 + real-WAN evidence completed |
| 600s alternative | **YELLOW / retained research challenger** | Not selected for this activation candidate |
| 900s alternative | **CLOSED** | Failed predefined promotion gate |
| Coinbase maturity policy | **GREEN** | Boundary, wallet and rollback tests implemented |
| Coinbase maturity core integration | **GREEN** | Mempool + direct-block + exact maturity boundary tested |
| DAA/timestamp vectors | **GREEN** | Frozen 300s vectors reproduced in Node + Python |
| DAA/timestamp core integration | **GREEN at L3 test profile** | Integrated block/replay path uses full target |
| Fresh-genesis/replay boundary | **GREEN at candidate layer** | Network/genesis/tx/peer separation implemented |
| Integrated candidate core | **GREEN at L3 test profile** | Mining, tx, maturity, replay and reorg path passes CI |
| Initial activation target/anchor | **YELLOW blocker** | Must be calibrated/frozen separately; CI pow-limit is not activation authority |
| Public multi-node candidate validation | **YELLOW** | Integrated candidate core has not yet been exercised as a fresh multi-node v5 candidate network |
| Activation authorization | **FALSE** | L3 not yet complete |

## Next implementation order

The remaining high-value work is now narrower:

1. harden the integrated candidate envelope/profile boundary so the eventual initial target/anchor cannot be implicit;
2. run the integrated candidate core as a separate fresh-genesis multi-node v5-candidate network, never as an in-place mutation of v4;
3. attack issuance, maturity, timestamp, reorg and v4/v5 isolation against that integrated multi-node candidate;
4. freeze the launch initial-target/anchor only after the relevant hash-rate evidence exists;
5. only then decide whether the candidate is eligible for public-testnet activation.

No public consensus change is authorized by this document.