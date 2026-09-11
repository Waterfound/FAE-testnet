# FAE Difficulty + Timestamp — Activation Boundary Hardening

Status: **candidate / shadow-only / NOT active consensus**.

## Frozen invariants

1. Activation is height-based, never wall-clock based.
2. The ASERT anchor height is exactly the activation height. Anchor identity includes the block hash, legacy difficulty bits/target, and parent timestamp.
3. Heights below activation accept only the legacy `difficulty_bits` representation. A `target_hex` there is fail-closed.
4. Heights at/above activation accept only the full 256-bit `target_hex`. Legacy bits there are fail-closed.
5. The first full-target block is computed from the frozen legacy anchor; there is no target reset and no chainwork reset.
6. Fork choice compares cumulative work across the boundary using exact legacy work before activation and exact target work after activation.
7. A rollback below activation restores legacy validation deterministically. Re-entry across activation must reproduce the same frozen boundary rules.
8. Reorgs may cross the activation boundary; regime is a pure function of block height plus the frozen boundary, never node-local activation state.
9. Any mismatch in anchor identity, encoding regime, expected target, or chain continuity fails closed.
10. This candidate has no authority until activation rehearsal, dual implementation parity, reorg/fork adversarial gates, and explicit testnet activation approval are complete.

## Why anchor == activation height

Public-testnet replay showed that inheriting an old ASERT anchor across long inactive gaps can dominate the candidate target. Pinning the anchor to the activation boundary makes the transition local, reproducible, and auditable while preserving the legacy target as the starting work reference.

## Remaining pre-activation gates

- randomized/property attack of boundary ± N blocks;
- deep reorgs originating below activation and resolving above it;
- competing forks with different timestamps/targets but valid cumulative work;
- restart/replay while the stored tip is on either side of activation;
- second-runtime implementation of the boundary state machine;
- continuous public-testnet shadow telemetry observation;
- explicit activation rehearsal on testnet before any authoritative change.

Independent Node WAN/soak/chaos/independent-operator validation remains a later external gate and is not claimed by this document.
