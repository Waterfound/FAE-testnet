# FAE Difficulty + Timestamp Hardening — adversarial simulation gate

Status: **candidate-not-active-consensus**

This gate extends the deterministic Difficulty + Timestamp package with seeded stochastic and operational-clock tests. It does not activate the candidate and does not alter `fae-v4-core.mjs` authority.

## Added attacks

1. **Stationary Poisson noise** — quantifies target spread for the precommitted 6/12/24/48-hour half-lives.
2. **Severe browser daily cycle** — deterministic 12h at 0.25x hash followed by 12h at 1.75x, deliberately harsher than an ordinary day/night cycle.
3. **Accumulated future timestamp attempt** — proves the 90-second wall is absolute relative to receiver wall time and cannot be banked as +90 seconds per block.
4. **Honest clock disagreement** — makes the operational assumption explicit instead of pretending future drift is only an adversarial parameter.
5. **Template-floor safety** — candidate template construction must never emit below the parent timestamp or at/below MTP, even when the local clock is behind chain time.

## Clock policy candidate

- Future timestamp wall: **90 s** (unchanged).
- Declared honest local-clock skew budget: **±30 s**.
- Relay-delay range: **0–5 s**. The upper bound supplies no guaranteed delay.
- Worst producer/receiver relative lead under those budgets: **60 s** (zero-delay delivery).
- Remaining future-wall headroom: **30 s**.

The previous 55 s / 35 s calculation described an exact 5 s relay, not a
guarantee over the entire permitted range. The 90 s wall and ±30 s skew
parameters are unchanged. See `DIFFICULTY_TIMESTAMP_ARRIVAL_CLOCK.md` for the
arrival/replay integration gate.

This is an activation precondition, not a claim that arbitrary unsynchronised clocks are safe. Nodes outside the declared clock budget may fail closed. Before mainnet activation, node startup/health telemetry must expose clock-health state or equivalent operator-visible evidence.

## Interpretation

The 6-hour testnet candidate intentionally trades more ordinary target movement for much faster recovery from abrupt browser-hash exits. The stochastic gate does not ratify 6 h for mainnet. It asks a narrower question: does ordinary Poisson noise or a severe daily hash cycle make the candidate pathological? The test thresholds are intentionally broad failure fences, not optimization targets.

The final branch head must pass the dedicated red-team CI together with the original deterministic vectors, shadow-observer tests, Independent Node v1.1 hardening and consensus-v3 shadow activation regression gates. A green simulation result is evidence for continued shadow evaluation, not permission to activate consensus.

## Remaining gates before activation

- independent second implementation reproducing frozen full-target vectors;
- public-testnet shadow observation over real chain history;
- explicit full-target header/codec migration and cumulative-work migration;
- activation anchor/height and rollback semantics;
- multi-host Independent Node soak + chaos + WAN + independent-operator validation;
- mainnet half-life ratification using the accumulated shadow/soak evidence.
