# FAE – Mining Tip Sync & Stale Work Recovery Lab

This Lab closes the browser-miner stale-work gap without using block-time changes as a correctness mechanism.

## Current frontier

**MTS-08 — Background, throttling, suspend and return**

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

## MTS-08 objective

Model browser lifecycle hazards: background timer throttling, long suspension with chain advancement, resume/return revalidation, and queued Worker callbacks around suspend/resume. The browser must never submit work whose parent freshness was not re-established after return.

No wallet secrets or real Proof of Work are required for the deterministic MTS-08 phase.
