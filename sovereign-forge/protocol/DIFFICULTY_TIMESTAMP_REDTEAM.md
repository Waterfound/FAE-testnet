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
- Relay-delay budget used for the guarantee calculation: **5 s**.
- Worst producer/receiver relative lead under those budgets: **55 s**.
- Remaining future-wall headroom: **35 s**.

This is an activation precondition, not a claim that arbitrary unsynchronised clocks are safe. Nodes outside the declared clock budget may fail closed. Before mainnet activation, node startup/health telemetry must expose clock-health state or equivalent operator-visible evidence.

## Interpretation

The 6-hour testnet candidate intentionally trades more ordinary target movement for much faster recovery from abrupt browser-hash exits. The stochastic gate does not ratify 6 h for mainnet. It asks a narrower question: does ordinary Poisson noise or a severe daily hash cycle make the candidate pathological? The test thresholds are intentionally broad failure fences, not optimization targets.

## Remaining gates before activation

- independent second implementation reproducing frozen full-target vectors;
- public-testnet shadow observation over real chain history;
- explicit full-target header/codec migration and cumulative-work migration;
- activation anchor/height and rollback semantics;
- multi-host Independent Node soak + chaos + WAN + independent-operator validation;
- mainnet half-life ratification using the accumulated shadow/soak evidence.
