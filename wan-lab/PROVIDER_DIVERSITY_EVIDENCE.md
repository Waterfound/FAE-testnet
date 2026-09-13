# FAE WAN Lab — Provider Diversity Evidence

Status: **research/lab-only — no consensus authority**

This note freezes the provider-diversity result already observed in the external WAN lab so it does not depend only on transient Render logs.

## Evidence boundary

The gate uses four project-operated nodes:

- A — Render / Oregon
- B — Render / Frankfurt
- C — Render / Singapore
- D — Supabase Edge Function

This establishes diversity between two hosting/control-plane providers used by the FAE WAN lab: **Render and Supabase**. It does **not** claim that the providers use different underlying hyperscalers, physical networks, operators, legal jurisdictions, or independent human maintainers.

## Empirical PASS

Observed at `2026-09-12T04:33:18.182Z` from `FAE_PROVIDER_DIVERSITY_GATE_V1`.

Result: **PASS**

Propagation evidence:

| Path class | Samples | P50 | Mean | P95 | Max |
|---|---:|---:|---:|---:|---:|
| All | 48 | 97 ms | 161.5 ms | 325 ms | 351 ms |
| Cross-provider | 28 | 217 ms | 208.5 ms | 327 ms | 351 ms |
| Within Render | 20 | 94 ms | 95.7 ms | 111 ms | 125 ms |

The test also created a real cross-provider competing fork, forced an extension on the losing side, converged all four nodes, then partitioned the Supabase node from the Render trio and healed the partition.

During provider partition:

- Render A/B/C converged at height 47 on one tip.
- Supabase D remained at height 46 on the alternate side.

After heal:

- A/B/C/D all converged at height 47 on the same tip.
- reorg counters showed the cross-provider recovery was exercised rather than merely observing steady-state connectivity.

Final observed reorg/stale state from the PASS report:

- A: reorg 3, stale 6
- B: reorg 3, stale 6
- C: reorg 3, stale 6
- D: reorg 4, stale 6

## Important failed attempts

Earlier/later failures are retained as evidence rather than hidden:

1. An early attempt failed because a Supabase reset operation used a `DELETE` rejected for lacking a `WHERE` clause.
2. A later controller redeploy failed closed with `four_nodes_required` because its node environment was incomplete.

Neither failure invalidates the clean PASS above; both are orchestration/configuration failures and were separately observable.

## Verdict

**Provider-diversity lab gate: PASS for Render + Supabase hosting/control-plane diversity.**

Not established:

- underlying hyperscaler independence;
- physical network/failure-domain independence between providers;
- independent human operator diversity;
- Full Target Shadow consensus authority;
- mainnet/testnet activation authority.
