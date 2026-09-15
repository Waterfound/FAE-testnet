# Agent Build Colony — H2 Final Serialized Integration

Status: **software-ceiling integration evidence / no consensus or mainnet authority**

Frozen G2 baseline: `bd5425e6245dee558422438fad7f56ad79b6721b`

H2 is the terminal integration gate for this Agent Build Colony cycle. It adds no consensus mechanism, release authority, economic authority, launch value or network authority. Its only job is to prove that the independently verified software-only work can coexist in one serialized repository state without silently changing earlier assumptions.

## Serialized chain

H2 freezes these already-integrated stages:

1. post-Colony differential hardening — `cfd08a88f0f4f2e66560811cdd7eac6f8eec9cf9`;
2. Worker E v2 reproducible source release — `92088ac1d60043f870b2e1eec06d7a0817325896`;
3. Worker F v2 release-bound mainnet rehearsal — `20a37c26125c5a11ba4c6808c1b4e1d6a07afd88`;
4. Worker G2 independent Git-oracle verifier — `bd5425e6245dee558422438fad7f56ad79b6721b`.

The H2 workflow verifies the exact additive file ownership of every serialized transition. Unexpected historical scope expansion is a failure.

## Integrated candidate map

H2 requires all consensus-adjacent Colony modules to remain explicitly non-authoritative:

- activation boundary — `candidate-not-active-consensus`;
- state/wallet/UTXO transition — `candidate-not-active-consensus`;
- compatibility/replay — `candidate-not-active-consensus`;
- network composition — `candidate-not-active-consensus`;
- mainnet rehearsal — `candidate-not-authorized-mainnet`.

The preferred future monetary/safety candidate remains:

- 300-second target interval;
- 14 FAE initial subsidy;
- 430,000-block halving era;
- theoretical 12,040,000 FAE maximum supply;
- 200-block coinbase maturity.

These values remain rehearsal/candidate data only.

## Current authority remains unchanged

H2 independently freezes the current public-testnet implementation constants:

- network: `fairyelf-public-testnet-v4`;
- target interval: 180 seconds;
- initial subsidy: 10 FAE;
- halving era: 600,000 blocks.

No H2 file may modify the authoritative v4 core.

## Final software-ceiling verdict

The executable H2 gate freshly produces an E-v2 release, verifies it through the F-v2 release binding, constructs a complete synthetic rehearsal configuration and deliberately supplies all external-evidence booleans as `true` only as a negative authority control.

Even under that maximal synthetic input, the result must remain:

- `candidate_to_authoritative: false`;
- `mainnet_launch_authorized: false`;
- `automatic_go_path: false`;
- `decision: HOLD_FINAL_EXPLICIT_AUTHORIZATION`.

The evidence output labels the software verdict as:

`SOFTWARE_CEILING_REACHED_WITH_EXTERNAL_EVIDENCE_REMAINING`

This wording is intentionally narrow. It means the Colony has exhausted the high-value software-only scope represented by A–F/G2/H2. It does not claim the missing external evidence has been obtained.

## External evidence still required

H2 explicitly carries forward, without marking present:

- physical HFB / RTX + watts evidence;
- representative-device evidence;
- operational soak;
- independent-operator evidence.

Production activation height and production bootstrap topology also remain unselected in the checked-in templates.

## Evidence bank

Before H2 can be GREEN it reruns, in serialized order:

- E v2 release reproducibility;
- F v2 mainnet rehearsal;
- G2 independent Git-oracle verification;
- activation boundary hardening;
- deep reorg/fork hardening;
- full activation rehearsal;
- full-target headers-first sync;
- genesis body-replay regression;
- state-transition oracle/core differential evidence;
- network-composition oracle/runtime differential evidence;
- the original integrated Colony H gate.

Canonical-source and Independent Node workflows are also triggered by the H2 test path and remain external integration gates on the pull request.

## Integration rule

H2 itself is additive-only and owns only its test, workflow and protocol document. It must not repair an earlier layer while claiming to integrate it. Any newly discovered defect belongs in a separate repair branch followed by a fresh serialized H2 attempt.

> **H2 may conclude that the software-only ceiling has been reached. It may not conclude that mainnet is authorized.**
