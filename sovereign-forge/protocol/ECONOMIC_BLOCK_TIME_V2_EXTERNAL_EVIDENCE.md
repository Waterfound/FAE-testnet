# FAE Economic + Block-Time v2 — External Measurement Evidence Gate

Status: **research-only / no consensus authority**  
Scope: measured evidence for 300 / 600 / 900-second block-time comparison  
Activation: **never authorized by this gate; L3 remains mandatory before any testnet activation**

## Purpose

The analytical L2 pass found that 600s and 900s cannot be credited with a stale-rate advantage merely from a longer target. The decisive question is empirical: at **comparable nominal throughput and payload policy**, how quickly do blocks propagate and what stale behavior is actually observed across independent nodes?

This gate converts that question into a machine-readable, fail-closed evidence check. It can strengthen or reject a longer-target challenger inside L2. It cannot select a consensus rule and cannot activate one.

## Required comparison structure

Every evidence bundle compares:

- a **300-second baseline shadow run**;
- exactly one challenger: **600 or 900 seconds**;
- the same measurement harness commit;
- the same environment identifier;
- the same payload-policy identifier;
- nominal transaction throughput within **±5%** between baseline and challenger.

The comparison is invalid if the candidate wins only because it carries materially less transaction throughput or a different payload mix.

## Minimum evidence admission

Each run must contain at least:

- **3 nodes**;
- **2 regions/failure domains**;
- **500 propagation samples**;
- propagation median, mean and P95;
- steady-regime block/stale counts;
- stress-regime block/stale counts;
- nominal transactions/second;
- a shared payload-policy identifier.

The minimum is deliberately higher than a short smoke test because a P95 and sub-percent stale claim should not be inferred from a handful of block events.

Raw logs and sample files should be retained separately. The evaluator consumes the summary bundle; a summary without underlying retained evidence is not sufficient for final protocol review.

## Absolute readiness gates

The evaluator preserves the previously precommitted research thresholds:

- propagation median **<1 second**;
- propagation mean **<2 seconds**;
- propagation P95 **<5 seconds**;
- steady stale-rate **95% Wilson upper bound <1%**;
- stress stale-rate **95% Wilson upper bound <2%**.

Using the Wilson upper bound prevents a tiny sample with zero observed stales from being treated as proof of a sub-percent stale regime.

## Comparative promotion gate

For the same propagation statistic, the first-order race proxy is:

`P(race) = 1 - exp(-delay / target)`

The challenger must demonstrate at least **25% lower P95 race pressure** than the measured 300-second baseline:

`candidate_P95_race / baseline_P95_race <= 0.75`

This is a **promotion-evidence threshold**, not an activation threshold. Passing it says the longer target has finally earned a measured network-level benefit large enough to remain a serious challenger after the L2 costs already identified.

A 50% reduction is recorded separately but is not required.

## Fail-closed evaluator

`node/lab/economic-block-time-v2-evidence-gate.mjs` rejects malformed or weak evidence before comparison. It returns:

- evidence admission details;
- baseline absolute-readiness result;
- challenger absolute-readiness result;
- measured P95 race-pressure ratio;
- `l2NetworkPromotionEvidencePass`;
- `selectionAuthorized: false`;
- `activationAuthorized: false`.

A PASS therefore means only: **this challenger has produced admissible measured network evidence worthy of continued L2 consideration**.

## Evidence bundle schema

```json
{
  "schema": "fae-economic-block-time-v2-measurement/1",
  "harnessCommit": "<40-char lowercase git SHA>",
  "environmentId": "<comparison environment>",
  "baseline": {
    "targetSeconds": 300,
    "nodeCount": 3,
    "regionCount": 2,
    "propagationSamples": 500,
    "payloadPolicyId": "comparable-throughput-v1",
    "nominalTps": 0.0666666667,
    "propagationSeconds": {"median": 0.5, "mean": 0.8, "p95": 1.5},
    "steady": {"blocks": 500, "staleBlocks": 0},
    "stress": {"blocks": 500, "staleBlocks": 2}
  },
  "candidate": {
    "targetSeconds": 600,
    "nodeCount": 3,
    "regionCount": 2,
    "propagationSamples": 500,
    "payloadPolicyId": "comparable-throughput-v1",
    "nominalTps": 0.0666666667,
    "propagationSeconds": {"median": 0.7, "mean": 1.0, "p95": 2.0},
    "steady": {"blocks": 500, "staleBlocks": 0},
    "stress": {"blocks": 500, "staleBlocks": 2}
  }
}
```

The numbers above are only a schema example and test fixture, not real FAE network measurements.

## Execution

```bash
node sovereign-forge/node/lab/economic-block-time-v2-evidence-gate.mjs measurement.json
```

Malformed or insufficient evidence exits non-zero. A syntactically valid bundle may still evaluate to `l2NetworkPromotionEvidencePass: false`; that is a legitimate research result and must not be converted into a pass by changing thresholds after seeing the outcome.

## Boundary to L3

Even if a challenger passes this measurement gate, the result must be reconciled with the full L2 record: DAA variance/recovery, monetary exactness, maturity semantics, payout variance, mining participation and independent-node behavior.

Only an explicit subsequent candidate-selection decision can close L2. **Focused Red Team L3 is then required before any public-testnet activation boundary.**
