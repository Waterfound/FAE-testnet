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

## Fresh-genesis activation model

This package must not reinterpret the existing `fairyelf-public-testnet-v4` history, whose issuance and timing rules differ.

The candidate therefore has a separate network identity:

`fairyelf-public-testnet-v5-candidate-300s`

and a deterministic candidate genesis descriptor/commitment. Candidate history begins with height 0 and zero issuance, inherits no v4 balances or coinbase outputs, uses a distinct signed-transaction domain, and rejects v4 network/peer identities.

The eventual public-testnet activation profile is an additional boundary: its initial target and calibration-evidence digest must be explicit and are committed into a derived activation-genesis descriptor. The current candidate genesis and easy CI target therefore cannot silently become public activation parameters.

## 200-block coinbase maturity

The maturity convention is frozen as:

> A coinbase created at height `H` may first be consumed by a block at height `H + 200`.

Mempool admission evaluates the candidate next-block height using the identical predicate. Candidate coinbase outputs are tagged with consensus-derived creation/maturity metadata.

The integrated core and three-node test reject the height-1 coinbase spend one block before maturity and confirm it at the exact boundary.

## Difficulty + Timestamp binding at 300s

The hardened full-target Difficulty + Timestamp design is bound explicitly to this candidate:

- target: **300 seconds**;
- family: anchored ASERT-style full uint256 target;
- arithmetic: integer-only;
- half-life: **21,600 seconds (6h)**;
- MTP window: **11 blocks**;
- future drift: **90 seconds**.

The frozen vectors are reproduced independently in Node and Python.

### Initial target activation boundary

The L3 integration harness deliberately uses the easy DAA pow-limit so hundreds of blocks can be exercised rapidly. It is explicitly a **test profile**.

`activation-profile-v2-300.mjs` now makes the launch boundary fail closed. A public-testnet profile must explicitly provide a valid full-target initial difficulty and non-placeholder calibration-evidence digest. Test/CI/example profile ids and placeholder evidence are rejected. Changing either target or evidence changes the derived activation-genesis commitment.

This closes the **implicit-target software failure mode**, but the real launch target cannot be frozen until launch-hashrate evidence exists.

## Integrated candidate core

`node/candidate/fae-v5-300-core.mjs` composes:

- 300s economics and subsidy accounting;
- integer-atom halving/cap behavior;
- full-target DAA/timestamp validation;
- 200-block maturity in mempool and block application;
- signed transactions and fee conservation;
- deterministic UTXOs;
- cumulative chainwork;
- deterministic replay/rebuild;
- chainwork-based reorganization;
- detached-transaction resurrection;
- v4/v5 candidate isolation.

The integrated single-process test and the isolated HTTP multi-process test both pass.

## Internal three-node candidate network

A separate v5 candidate runner now executes three independent Node processes over HTTP. The CI execution environment is deliberately classified as **single-host multi-process**, not geographic WAN or independent-operator evidence.

The multi-node run proves:

- clean fresh genesis on every node;
- invalid target/subsidy rejection without state mutation;
- stable equal-work tie behavior with no arbitrary replacement;
- deterministic adoption of a higher-work branch;
- exact 200-block maturity enforcement on every node;
- transaction propagation/confirmation;
- isolation of an alternative branch;
- higher-work reorg and detached-transaction resurrection;
- reconfirmation on the winning branch;
- v4 envelope rejection;
- `activationAuthorized=false` and `publicConsensusChanged=false` throughout.

This closes the **internal multi-node semantic integration gate**. It does not claim the independently operated network that is currently unavailable.

## Evidence boundary

The earlier Block-Time v2 research contains real WAN propagation evidence for the 300/600/900 comparison. The new candidate-specific run contains stronger integrated consensus semantics but is single-host CI.

These evidence classes remain separate and are not relabeled.

Detailed results are recorded in `protocol/ECONOMIC_BLOCK_TIME_V2_300_L3_RESULTS.md`.

## Live-v4 isolation

Candidate CI asserts that current v4 still contains its existing 180-second / 10 FAE / 600,000-block / 12M parameters and fails if candidate modules leak into the live v4 node.

Therefore L3 can advance without making research commits authoritative by side effect.

## Current L3 disposition

| Area | State | Reason |
|---|---|---|
| Monetary constants | **GREEN** | Executable candidate + boundary tests |
| Atom-level issuance | **GREEN** | Exact terminal issuance and 0.0516 FAE shortfall frozen |
| 300s block-time research | **GREEN / pre-L3 ceiling** | L2 + real-WAN comparison completed |
| 600s alternative | **YELLOW / retained research challenger** | Not selected for this candidate |
| 900s alternative | **CLOSED** | Failed predefined promotion gate |
| Coinbase maturity | **GREEN** | Exact boundary tested in core + three-node path |
| DAA/timestamp vectors | **GREEN** | Node + Python reproduction |
| Integrated candidate core | **GREEN at L3 test profile** | Mining, tx, replay and reorg paths pass |
| Internal three-node HTTP integration | **GREEN** | Multi-process end-to-end run passes |
| Equal-work/higher-work branch behavior | **GREEN** | Tie remains local; higher work converges |
| Fresh-genesis / v4-v5 isolation | **GREEN at candidate layer** | Cross-network envelope rejected |
| Activation-profile mechanism | **GREEN** | Initial target/evidence cannot be implicit |
| Launch initial target calibration/freeze | **YELLOW blocker** | Requires real launch-hashrate evidence |
| Candidate-specific geographic WAN rerun | **YELLOW / opportunistic** | Not required to relabel current evidence |
| Materially larger independent network | **UNAVAILABLE / deferred ceiling** | External dependency unavailable |
| Activation authorization | **FALSE** | Explicit activation gate remains closed |

## Remaining sequence

The high-value software work is now narrow:

1. finish the Focused L3 review against the integrated candidate and activation-profile boundary;
2. preserve the easy pow-limit profile as test-only;
3. obtain launch-hashrate evidence when the relevant hardware/network state exists;
4. derive and freeze the real initial target/anchor through the activation-profile mechanism;
5. rerun the integrated L3 suite against that frozen profile;
6. use any materially larger independent/WAN confirmation that is actually available;
7. only then make an explicit public-testnet activation decision.

No public consensus change is authorized by this document.