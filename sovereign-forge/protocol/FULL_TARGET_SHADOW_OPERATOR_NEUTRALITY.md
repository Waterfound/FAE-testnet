# Full-Target Shadow: One-Man Operator-Neutral Reproducibility Gate

Status: **lab-only / no consensus authority**

## Design principle

FAE treats **one man, one machine** as a project constraint for this validation layer. Therefore an "independent human operator" is not a valid mandatory readiness dependency: a second human cannot be both required and absent by design.

The correct classification is:

```text
independent human operator: N/A — excluded by project principle
```

This is not converted into a fake GREEN. Instead, the strongest evidence available inside the constraint is collected by an **operator-neutral reproducibility surrogate**.

The surrogate asks a narrower and testable question:

> After the operator starts the gate, does the complete Network Recovery & Reorg result reproduce repeatedly without any phase-by-phase operator choice, selective retry, result selection, state reuse or relaxed acceptance rule?

## What the gate adds

The existing one-machine ceiling already proves isolated Docker network namespaces, deterministic headers/body cuts, `SIGKILL`, durable recovery, stronger-work adoption, lower-work rollback rejection, restart while partitioned and reconnect/churn.

This gate adds anti-operator-bias controls on top:

1. **Fixed replay count** — exactly five complete ceiling runs are required by the workflow.
2. **All-runs-must-pass** — there is no majority vote; one failed replay fails the gate.
3. **No selective internal retry** — a replay is recorded once. The collector continues only to preserve the complete failure evidence.
4. **Fresh disposable state per replay** — the underlying ceiling harness creates new containers, Docker networks and volumes and removes them at the end. The collector separately checks that no `fae-om-*` resources remain after each replay.
5. **Code identity binding** — evidence records the Git commit plus SHA-256 hashes of the one-machine harness, operator-neutral collector, independent verifier, shadow peer and fault proxy.
6. **Boot identity binding** — evidence records the Linux kernel boot ID of the single runner.
7. **Separate verifier implementation** — a Node verifier, separate from the Bash orchestration harness, re-parses every terminal summary and independently requires every invariant.
8. **Fail-closed evidence completeness** — missing logs, missing metadata, failed cleanup, unexpected replay count, failed invariant or corrupted scope boundary all fail verification.
9. **No scope inflation** — the verifier requires `external_wan_proof:false` and `consensus_authority:false`. This gate cannot claim a second physical failure domain, another human, or consensus authority.
10. **Immutable run history policy** — a failed run at a frozen target commit is evidence and must not be erased by rerunning the same commit until a passing attempt appears. A failure must be explained; if code changes are needed, the fix receives a new commit identity.

## Execution model

The workflow uses a single GitHub-hosted Linux runner and one Docker image. Five sequential complete replays execute on that one runner:

```text
frozen commit
    |
    +-- replay 1 -> disposable namespaces/volumes -> cleanup
    +-- replay 2 -> disposable namespaces/volumes -> cleanup
    +-- replay 3 -> disposable namespaces/volumes -> cleanup
    +-- replay 4 -> disposable namespaces/volumes -> cleanup
    +-- replay 5 -> disposable namespaces/volumes -> cleanup
    |
    +-- separate Node verifier
            |
            +-- PASS only if 5/5 are complete PASS
```

There is no interactive phase control, no manual choice of fault timing, no manual approval between stages and no retry-on-failure branch inside the gate.

## Required PASS result

The final attestation is `FAE_OPERATOR_NEUTRAL_REPRODUCIBILITY_V1` and must state:

- `status: PASS`;
- `independent_human_operator: N/A-by-design`;
- `single_physical_runner: true`;
- `fixed_replays: 5`;
- `all_replays_required: true`;
- `all_replays_passed: true`;
- `fail_closed: true`;
- `separate_verifier_codepath: true`;
- `code_identity_bound: true`;
- `boot_identity_bound: true`;
- `fresh_namespaces_and_volumes_per_replay: true`;
- `external_wan_proof: false`;
- `consensus_authority: false`.

Each replay log is SHA-256 hashed into the final attestation.

## Interpretation

If this gate passes, the Network Recovery & Reorg evidence ledger may classify:

```text
Independent human operator                  N/A — design-excluded
Operator-neutral execution                  GREEN
One-machine reproducibility                 GREEN
Anti-selection / all-runs-must-pass         GREEN
Independent verifier code path              GREEN
Code/evidence identity binding              GREEN
```

This is intentionally more precise than calling the human-operator line RED. RED would imply an engineering defect that should be repaired. Here the requirement itself conflicts with the project's one-man constraint, so it is **not applicable**, while its underlying concern — operator-dependent results — is attacked directly.

## What remains impossible on one machine

Even a perfect PASS cannot prove independence of:

- a second human operator;
- physical host/kernel failure domains;
- hypervisor, power, region or ISP independence;
- an independently authored implementation;
- external WAN behavior by itself.

Those claims remain outside this gate. Separate real-WAN, multi-host, multi-region and provider-diversity evidence may cover some of them, but they must not be relabeled as human independence.

## Authority boundary

This gate is evidence-only. It must not activate or change authoritative consensus, DP6, genesis, PPLNS, tokenomics or mainnet/testnet authority.
