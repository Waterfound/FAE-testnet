# FAE – Mining Tip Sync & Stale Work Recovery Lab

This Lab closes the browser-miner stale-work gap without using block-time changes as a correctness mechanism.

## Current frontier

**MTS-09 — Multi-tab, multi-context, other-device and remote-miner independence**

MTS-00 through MTS-06 are GREEN. MTS-05 adds race-safe Worker generation fencing plus a fail-closed authoritative freshness barrier immediately before direct block submission.

## Frozen invariants

- Network state is authoritative.
- Direct-work parent identity is `header.height - 1 + header.previous_hash`.
- The authoritative observation is `/status height + tip_hash`.
- A chain-tip change invalidates current PoW work.
- A mempool-only change does not invalidate current PoW work.
- A late callback from an old Worker generation cannot mutate the active generation.
- No direct solution may reach `/submit-block` without a fresh authoritative parent check.
- Ambiguous/unavailable freshness fails closed: no block submission.
- Cross-tab signaling may accelerate revalidation but is never chain authority.
- Correctness is independent of choosing a 180s or 300s block target.

## Verified path

MTS-01 reproduced the original stale-work gap deterministically.

MTS-02/03 froze work identity, Worker generations, and the authoritative tip classifier.

MTS-04 cancels stale direct PoW automatically and reacquires fresh work.

MTS-05 closes post-cancellation races and the nonce-to-submit race.

MTS-06 provides the deterministic VM/fake-Worker/fake-network regression harness.

## MTS-07 result

MTS-07 is GREEN without a runtime patch: 12 consecutive tip replacements, 2,000 delayed-scheduling progress callbacks, three consecutive status failures with recovery, and solution-during-outage all preserved zero stale submissions and automatic recovery.

## MTS-08 result

MTS-08 is GREEN. The stress-first run reproduced a lifecycle gap: stale direct work survived foreground visibility return and pageshow until the polling timer. The minimal miner patch now forces immediate authoritative revalidation on both lifecycle events and fails closed when freshness cannot be re-established. Final lifecycle matrix: 5/5 PASS; canonical verifier: 31/31 PASS.

## MTS-09 objective

Prove independent convergence across multiple tabs/contexts and externally advanced chain state. No tab, device, or remote miner may need a same-device signal to discover stale work. Optional cross-context hints remain acceleration-only and cannot become authority.

The initial MTS-09 phase remains stress-first and requires no wallet secrets or real Proof of Work.
