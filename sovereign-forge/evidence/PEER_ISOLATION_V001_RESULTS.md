# FAE — Lab Peer Isolation & Eclipse Resistance v0.0.1

**Verdict: PASS_LOCAL_CANDIDATE. Production integration: pending.**

The first executable candidate is frozen on branch
`lab-peer-isolation-eclipse-resistance-v001`. Its reviewed scope consists of a
pure defensive peer policy, a fixed loopback adapter, invariant tests and an
evidence gate. The main branch and authoritative implementations were not
modified by this work.

## Recorded verification

| Evidence | Result |
| --- | --- |
| Tested implementation commit | `367f7fd6d2f0dc0c92f66d179ed3a041e8075e29` |
| Canonical base | `3e2ed24e57d9c6886b234ebb7e5633cbe8b220c7` |
| Local Node.js v24.19.0 | 22 passed; 0 failed, cancelled, skipped or todo |
| GitHub Actions Node.js v22.23.2 | 22 passed; 0 failed, cancelled, skipped or todo |
| Source hashes across both runs | Exact match; both tested clean worktrees |
| Real transport | Authenticated encrypted sessions over loopback |
| Time basis | Virtual monotonic policy time for expiry and backoff |
| Consensus / production authority | None |
| WAN, independent operators, proven eclipse resistance | Not established |

[Successful CI run 34764579815](https://github.com/Waterfound/FAE-testnet/actions/runs/34764579815)
completed on 2026-09-13. Job `103743160717` passed the candidate/scope/recovery
gate and preserved artifact `10319983408`.

The downloaded archive's SHA-256 was independently recomputed locally and
matched the GitHub artifact digest:
`b5387890c95b046927a943fb1c9a4814aba23d5cfe255d3b777be8cfd54d8dd3`.
The artifact's TAP and loopback JSON hashes were also checked against its
summary. The three original files are preserved here, with only filenames
changed, so evidence remains available after the CI artifact retention period:

- [CI summary and source hashes](PEER_ISOLATION_V001_CI_SUMMARY.json)
- [CI loopback phase records](PEER_ISOLATION_V001_CI_LOOPBACK.json)
- [CI raw test output](PEER_ISOLATION_V001_CI_TESTS.tap)

## Observed local recovery

| Phase | Fresh peer observations | Candidate state |
| --- | ---: | --- |
| Configured before contact | 0 | ISOLATED |
| Three sources verified; observer synchronizes | 3 | DEGRADED |
| Configured anchor unavailable | 2 | DEGRADED; anchor missing |
| All sources unavailable | 0 | ISOLATED |
| Same anchor identity restarts and reconnects | 1 | DEGRADED |
| Fresh observer bootstraps from the restarted source | 1 | DEGRADED |

Both observers converged on the same validated 11-block historical fixture,
including all state/ledger fields. Coordinator count remained zero. The fixture
is existing test data; this work did not mine or change the public testnet.
Multiple loopback nodes correctly remained one transport group. These results
prove neither separate physical failure domains nor independent peer owners.

## Implemented protections

- Only completion of a locally leased, identity-checked outbound probe creates
  fresh contact evidence. Hints and historical authentication do not.
- Contact expiry, immediate invalidation on failed refresh, bounded retry,
  expired-result rejection and no inherited liveness on restart.
- Identity deduplication, conservative address grouping, mapped IPv4 handling,
  and no diversity credit from unresolved DNS names alone.
- Separate capacity for operator-configured peers, local-only anchor pinning,
  and bounded discovery admission by source group, destination group and identity.
- Concurrent-attempt and window budgets, local keyed ordering, and rotation
  that progresses even when a missing anchor has a one-slot probe budget.

The protocol records the candidate thresholds and evidence boundaries in
[PEER_ISOLATION_ECLIPSE_RESISTANCE_V001.md](../protocol/PEER_ISOLATION_ECLIPSE_RESISTANCE_V001.md).

## Next concrete work

This is the first Lab milestone, not its local ceiling. Next, build and review
the transport-aware candidate integration for discovery, sync and relay:
bind observed DNS/socket addresses, handle redirects and cancellable deadlines,
retain bounded persistent hints without reviving liveness, and exercise
recovery under repeated topology changes. Only after that integration should
the Lab seek wider network and operator evidence. Existing Network Recovery &
Reorg evidence remains complementary; no gates are inherited automatically.

The local diversity state is a connection-health assessment. It never means
that an identity is honest, that prefixes belong to different operators, or
that an eclipse has been ruled out.
