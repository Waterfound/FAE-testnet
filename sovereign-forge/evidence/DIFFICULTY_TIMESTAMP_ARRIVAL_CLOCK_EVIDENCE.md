# Difficulty + Timestamp arrival-clock evidence

Date: **2026-09-14**. Scope: **local integration; candidate/lab-only**.

Base: `8a641f13ef96c7539f2d5162eb735a71cb9d3861` on
`Waterfound/FAE-testnet/main`. Implementation, test and protocol changes are
co-versioned with this ledger. Runtime: Node.js **v24.19.0**, Python **3.12.14**.

| Check | Observed result |
| --- | --- |
| New arrival-clock suite | 8/8 tests passed |
| Existing deterministic, stochastic and shadow suites | 17/17 tests passed |
| Independent Python frozen-vector reproduction | PASS |
| Full-target mixed-header sync rehearsal | PASS |
| Full-activation rehearsal | PASS |
| Shadow peer reconnect, fork choice and restart | PASS |
| Concurrent sync and stored-state validation | PASS |
| Mid-reorg interruption and recovery | PASS |
| External-validation kit, exercised locally | PASS |
| Workflow YAML and authority-isolation check | PASS |
| Patch whitespace check | PASS |

The eight arrival tests were rerun successfully after the default sync clock was
changed to sample actual arrival time. The table reports distinct tests, not a
sum inflated by that rerun. The six standalone integration programs each emit a
structured PASS summary; their internal assertions are not counted as separate
unit tests here.

## What this establishes

- Arrival gates apply to headers, bodies, append and serialized adoption.
- Premature data leaves live and durable state unchanged and can later be
  accepted at the exact receiver-clock boundary.
- A receiver-clock correction between download and adoption is rechecked.
- Previously accepted history survives a backward clock correction on restart.
- The existing legacy 120 s and activated-candidate 90 s rules are preserved.
- The ±30 s honest-clock envelope has 30 s guaranteed headroom under a 90 s wall.
- Original DAA vectors, full-target policy identity and active v4 sources remain
  unchanged.

## What this does not establish

No new public-WAN execution, measured NTP/UTC accuracy, multi-provider compute
independence, long-duration soak, 300 s economic-candidate qualification or
mainnet activation is claimed. The external-validation kit row is a **local**
check of that kit, not satisfaction of its external evidence gate.

Remote Node 22 / Python 3.13 CI results must be read from the associated GitHub
Actions run. They are not inferred from these local results.
