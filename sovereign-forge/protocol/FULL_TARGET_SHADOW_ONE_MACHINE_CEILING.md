# Full-Target Shadow: One-Machine Failure-Domain Ceiling

Status: **lab-only / no consensus authority**

This gate is the final high-value local validation layer before independent physical hosts. It deliberately strengthens transport and process isolation on one physical runner without claiming that one host can prove independent WAN failure domains.

## Topology

The harness creates three Docker networks:

```text
A (weak branch) ---- net A-C ---- C
                               |
                            net C-P
                               |
                     degraded fault proxy
                               |
                            net P-B
                               |
                         B (strong branch)
```

Properties that are asserted, not assumed:

- A and B share no Docker network.
- C and B share no Docker network.
- C cannot fetch B directly.
- A cannot fetch B directly and B cannot fetch A directly.
- C can reach the proxy.
- The dual-homed proxy can reach B.
- C is configured to reach B only through the proxy.

This gives A, B, C and the proxy independent process/network namespaces while remaining on one physical machine.

## Degraded transport

`full-target-shadow-fault-proxy.mjs` retains its exact deterministic secure-response truncation behavior and additionally supports optional lab-only degradation controls:

- base response delay;
- deterministic bounded jitter;
- response fragmentation into fixed-size chunks;
- delay between chunks to create a throttled/slow-peer path.

The default values remain zero. Therefore existing validation paths keep clean passthrough semantics unless degradation is explicitly enabled.

Environment controls:

```text
FAE_SHADOW_PROXY_BASE_DELAY_MS
FAE_SHADOW_PROXY_JITTER_MS
FAE_SHADOW_PROXY_CHUNK_BYTES
FAE_SHADOW_PROXY_CHUNK_DELAY_MS
```

The one-machine ceiling harness enables all four controls while retaining deterministic secure-request cuts.

## Required sequence

1. **Lower-work durable start** — C converges to A and persists the weak branch before B is reachable.
2. **Headers cut** — C discovers B only through the degraded proxy; secure response ordinal 2 is truncated. C must remain exactly on A in live and durable state.
3. **Block-body cut** — secure response ordinal 3 is truncated. C must again remain exactly on A.
4. **Hard crash during fault** — C is killed with `SIGKILL` while the block-body fault remains active, then restarted from the same volume. It must recover the complete weak state, never a partial B suffix.
5. **Degraded-path recovery** — truncation is disabled but delay/jitter/fragmentation/throttling remain. A fresh secure session must rediscover the fork and atomically adopt B because B has higher cumulative work.
6. **Post-convergence partition** — B's only route is removed. Lower-work A remains reachable. C must not roll back.
7. **Restart while partitioned** — C is hard-killed and restarted while B is still unreachable. The persisted strong state must survive.
8. **Reconnect** — the degraded C→proxy→B route returns. C must remain on B.
9. **Accelerated churn soak** — repeated partition/reconnect phases plus another hard restart exercise lifecycle stability. This is an accelerated local stress pass, not a time-equivalent WAN soak.

## PASS invariants

A PASS requires all of the following:

- separate Docker network namespaces are actually present;
- direct C→B connectivity is absent;
- direct A↔B connectivity is absent;
- deterministic headers and block-body interruptions are both observed in evidence;
- no interrupted attempt changes C's selected tip/work;
- no interrupted attempt partially mutates durable chain state;
- hard restart during a reorg fault loads the complete prior chain;
- restored degraded transport permits fresh-session recovery;
- stronger cumulative work wins;
- reachable lower-work A cannot roll back the recovered B state;
- restart while B is partitioned preserves the strong durable state;
- reconnect and accelerated churn preserve the strong tip/work;
- secure context binding still matches the policy id;
- all code remains lab-only and absent from authoritative consensus entry points.

## What this closes

A PASS closes the practical **one-machine Network Recovery & Reorg ceiling** for the current shadow implementation: process separation, network-namespace separation, slow/degraded transport, deterministic mid-reorg interruption, hard crash, persistence recovery, rollback resistance and accelerated partition/reconnect churn.

## What it cannot prove

A one-machine PASS is **not** external WAN proof. It cannot establish independence of:

- physical host or kernel failure;
- hypervisor failure;
- provider control plane;
- ISP/routing path;
- region/power domain;
- physical clock source;
- independent operator behavior.

Those remain the purpose of `FULL_TARGET_SHADOW_EXTERNAL_VALIDATION.md`: minimum A/B/C on independent public hosts, followed by the real WAN interruption procedure, post-convergence partition/restart, soak, and independent-operator validation.

No result from this local gate authorizes consensus activation, DP6 activation, genesis changes, PPLNS changes, or mainnet/testnet authority changes.
