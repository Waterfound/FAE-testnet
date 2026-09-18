# MTS-12 — Physical iPad Acceptance Protocol

Status: PREPARED_NOT_STARTED

This frontier validates deployment/browser integration only. It does not authorize runtime, consensus, economic, wallet, key, telemetry, or block-time changes.

## Preconditions

- MTS-11 real-browser evidence is GREEN.
- Deployed browser miner contains the frozen MTS-10/MTS-11 miner SHA-256.
- The public testnet is healthy enough to return authoritative `/status` and `/template`.
- No private key, seed phrase, passphrase, or reusable secret is required for the test.

## Physical scenarios

1. Start Mining once in Safari and leave it running across at least one externally produced chain advance. PASS only if mining automatically replaces stale work without Stop -> Start.
2. Open two Safari tabs on the same iPad and mine in both. When one tab or another miner advances the chain, the other tab must abandon old work and acquire a template bound to the new tip without manual restart.
3. Background one mining tab long enough for browser scheduling to be throttled, advance the chain elsewhere, return to the tab, and verify immediate recovery without manual restart.
4. Repeat with the tab that did not find the block in foreground while another same-device tab advances the chain.
5. Observe at least one remote-miner advance where no local tab could have known the new tip except through the network. The local miner must still recover automatically.

## PASS invariant

The user-facing invariant is:

`Start Mining once -> chain may advance anywhere -> browser miner self-revalidates -> stale Worker stops -> fresh template starts -> no manual Stop -> Start required.`

Same-device BroadcastChannel may reduce latency but is never accepted as proof of correctness. Network authority remains `/status` height + tip_hash.

## Evidence to record

For each scenario record only non-sensitive observations: approximate wall-clock time, whether the stale worker visibly stopped/restarted, whether mining continued automatically, whether manual Stop -> Start was needed, and any displayed stale/freshness message. Do not record wallet secrets.

## FAIL policy

Any reproducible need for manual Stop -> Start, continued hashing after an observable authoritative tip replacement, false cancellation on an unchanged tip, or stale block submission is a FAIL and reopens engineering. A one-off inability to observe timing precisely is not by itself a correctness FAIL if automatic recovery is still clearly observed.
