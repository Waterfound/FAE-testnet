# F180-12 — Terminal Research Verdict

## Verdict

**INSUFFICIENT_EVIDENCE**

This is a **research conclusion only**. It does not change the active public-testnet consensus, select an activation height, authorize mainnet, or change the 300s research incumbent.

## Why this verdict is mechanically required

The Build Colony froze verdict precedence before the results:

1. `MATERIAL_RISK_FOUND`
2. `INSUFFICIENT_EVIDENCE`
3. `SUPPORTED_WITHIN_CURRENT_EVIDENCE`

The final independent verification run **36449101268** passed and found:

- `hardFailureConfirmed = false`
- `directExternalEvidenceStillMissing = true`
- computed verdict: `INSUFFICIENT_EVIDENCE`

Therefore no verified material-risk hard gate takes precedence, but the evidence set is still incomplete for a supported mainnet-grade claim.

## What survived the attack

The exact active-v4 DAA converged under the frozen honest 0.1×–10× hash-rate shocks without locking at the difficulty bounds. The 180s target also has a meaningful participation advantage: more frequent block/reward events and lower payout-count variance for small miners than 300s/600s under the same hash-share model.

The tested +120s timestamp strategies altered global cadence in some cases, but did not demonstrate an increase in the attacker's relative block share in the paired model.

## What remains concerning

The active DAA is coarse because difficulty is represented as integer leading-zero bits. A converged deterministic regime can correspond to about **127.3–254.6 seconds** around the nominal 180s target. In the 256-seed stable-hash study, the median per-seed mean interval was about **191.6 seconds**, with repeated retarget-bit changes.

A shorter 180s interval also increases sensitivity to fixed network delay and fixed outages. In the first-order model, a 0.1s-versus-5s propagation gap corresponds to about **2.76%** accepted-event advantage at 180s, compared with about 1.65% at 300s and 0.82% at 600s. During a 208s isolation, the idealized probability of at least one block elsewhere is about **68.5%** at 180s.

These are WARN signals, not direct proof that 180s is unsafe.

## What is still missing

The current evidence cannot justify `SUPPORTED_WITHIN_CURRENT_EVIDENCE` because it lacks:

- fresh directly comparable 180s WAN/physical evidence with raw provenance;
- an admitted >=500-sample 180s propagation dataset with P50/mean/P95 and P99 when available;
- a natural stale/fork/reorg denominator sufficient for the frozen Wilson confidence gates;
- fresh recovery/partition evidence against a precommitted recovery bound;
- authoritative raw provenance for the historical V1/V2 result bundles, or a fresh superseding dataset.

V1 and V2 remain **FAIL**. V3 remains a separate `PREPARED_NOT_STARTED` operational gate and was not substituted by this research.

## Protocol effect

None.

- Active public-testnet target remains **180 s**.
- Active economics remain unchanged.
- **300 s remains the GREEN research incumbent**, not active consensus.
- No activation height was selected.
- No mainnet authority was created.
- No consensus change was authorized.

The bounded conclusion is therefore:

> **180s was not falsified by the completed software-only evidence, but it is not sufficiently supported by the currently admitted evidence for a mainnet-grade block-time claim.**

The verdict may be reopened when fresh 180s WAN/physical/natural-event evidence satisfies the frozen admission gates.
