# DP6 historical PoW vulnerability assurance — minimal main-ancestry replay candidate

Date: 2026-10-11. **Candidate only**; neither a DP6 consensus integration nor mainnet activation.

## Why this candidate exists

The historical assurance PR #296 (`assurance/dp6-path-binding-20261010`) is on an old research lineage and is materially divergent from today's FAE main. It cannot satisfy cross-lab's current-main-ancestry gate by rerunning CI; blind mass merging historical research changes is unsafe.

A new branch `assurance/dp6-main-ancestry-replay-20261011` was created from exact `main` **6d0c3956fdf72cd2e7543eee2539397ed5c0e699**. A first set of twelve source/contract/oracle/workflow files was transplanted as **the same original Git blob SHAs** from PR #296 exact original forward-port source `e14ee3900812b99737f1d47ed7bbdb7ffbb49620`: frozen HLS DP6, local path-binding verifier, ten bypass mutants, frozen contract/status/evidence, independently structured C++ verifier with frozen PHC reference dependency and vector harness, and read-only negative gate. This is a selective source/evidence forward-port, **not** a cherry-pick of unrelated historical research commits, not a new algorithm and not a promotion of historical static RESULT.json as newly observed evidence.

Added CI checks are:
- `fae-dp6-historical-bypass-negative`: full frozen HLS path witness plus 10 negative bypass/truncation mutants
- `fae-dp6-independent-semantic-replay`: build independent C++ verifier using PHC Argon2 at immutable `f57e61e19229e23c4445b85494dbf7c07de721cb`, replay 16 positive / 6 negative / 4 interface selector inputs
- `fae-dp6-rp-b3-t3-software-bound`: conditional random-I/O bank/concurrency/installed-cost sensitivity with explicit unmeasured inputs, copied from historical source along with its frozen two model inputs (five additional exact Git blobs)
- ordinary public source/provenance, CodeQL, cross-lab and portfolio gates, without waivers

A passing CI proves the candidate is executable on today's main ancestry. It does **not** prove that the current active FAE v4 node actually uses DP6, that a future mainnet verifier has frozen network/height/version selectors, that FPGA/ASIC specialization is unprofitable, or that ASIC DP6 work/cost bounds are known.

## Historical PoW regression scope
- One frozen DP6 public entrypoint with full 112-byte input and 160-byte output;
- Mandatory Argon2d 256 MiB state + RW5 eight 131,072-step programs;
- Header, previous hash, task, height, nonce and full final digest binding;
- Negative proof reuse, malformed legacy selectors and reduced-work mutations.

## Remaining material gates
- Produce and freeze actual final production/mainnet DP6 routing and independently replay its accepted/rejected proofs on that exact wiring. Until then final production path-binding is a **CONDITION_WAIT**, not `DONE`.
- The RP-B3-T3 memory/economic specialization model from the historical research branch is a **conditional sensitivity**, not a specialist LCVW proof. Genuine external dependent-random-I/O rates, controller/PHY, installed memory/package economics, commodity comparison and production assumptions are absent. **EXTERNAL_EVIDENCE_GATE**.
- The historical #296 lineage remains distinct and still fails current-main ancestry. This forward-port is not merge authority. Any future integration requires full FAE security and canonical gate independently.

Zero provider/credential change, paid resources, ASIC/FPGA experiment, memory-algorithm change, release or mainnet.

## Expanded forward-port evidence receipt

Five additional, identical Git blobs from the historical PR #296 have since been moved onto this same latest-main-ancestry candidate: its RP-B3-T3 model, test and read-only workflow plus the two immutable source-bound calculation inputs. Together with the original twelve this is **17 exact-object transplants**, plus new CI and documentation. The specialist throughput, effective random-dependent bank service and installed cost remain **unmeasured**. Passing conditional scenario tests does **not** validate economic ASIC resistance. A separate test-harness-only HTTP fix for CPU-bound PoW request idle keepalive has been staged for the previously red P2P-v6 integration, without relaxing its assertions.
