# Full-Target Shadow Operator-Neutral Evidence Ledger

Scope: **one-man / one-machine-per-execution / lab-only / no consensus authority**

This ledger freezes the first two complete executions of `FAE_OPERATOR_NEUTRAL_REPRODUCIBILITY_V1`.

## Result

```text
independent human operator:           N/A — design-excluded
operator-neutral execution:           GREEN
one-machine reproducibility:          GREEN
all-runs-must-pass anti-selection:    GREEN
separate verifier code path:          GREEN
code/evidence identity binding:       GREEN
cross-runner repeatability:           GREEN
```

No line above claims an independent second human, independent physical failure domains, external WAN proof, or consensus authority.

## Execution 1

```text
workflow run: 34755555116
commit:       bdab2f3088a02de658bdfe4d167d444098085e1e
runner:       GitHub Actions 1000001020
result:       SUCCESS
replays:      5/5 required complete replays
verifier:     PASS
scope guard:  PASS
artifact:     fae-operator-neutral-evidence-34755555116-1
artifact sha: 29dec018c12fe1eed5749fe0f19250f785bdc6bcbcad17159e7e8bcbd3892994
```

The fixed replay block, separate verifier, authority/scope isolation and evidence-preservation steps all completed successfully.

## Execution 2

```text
workflow run: 34755887518
commit:       2e90b002347218715c87c5b5c1391227f5177709
runner:       GitHub Actions 1000001021
result:       SUCCESS
replays:      5/5 required complete replays
verifier:     PASS
scope guard:  PASS
artifact:     fae-operator-neutral-evidence-34755887518-1
artifact sha: 7096a45b8c29ec13e11b1d93e52602b80adbd9c76768581b826a28e08e9a86df
```

Execution 2 used a different GitHub-hosted runner allocation from execution 1 and independently completed the same fixed five-replay gate.

## Aggregate

```text
complete sealed replays: 10
required replay failures: 0
workflow failures:        0
verifier failures:        0
runner allocations:       2 distinct
selective retry path:     none inside gate
majority-vote path:       none
```

A replay failure would fail the whole corresponding execution. A failure is evidence and is not erased by a later PASS at the same frozen target without explanation.

## Interpretation

These results directly attack the underlying concern normally delegated to an independent operator: accidental manual steering, selective result acceptance, stale local state, and dependence on one ephemeral execution environment.

They do **not** prove that a second human would independently reproduce the result. Under the FAE one-man principle that requirement is N/A rather than a permanent RED. The replacement, operator-neutral reproducibility, is empirically GREEN for the tested implementation.
