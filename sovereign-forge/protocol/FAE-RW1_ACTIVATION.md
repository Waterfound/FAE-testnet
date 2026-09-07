# FAE-RW1 activation policy — Canonical 9

Status: **experimental testnet candidate; not active consensus**.

## Design philosophy

FAE-RW1 is the candidate path for the ASIC-resistance work discussed for Fairyelf. It must preserve three goals:

1. Mining includes **useful work**, not purposeless extra computation.
2. Mining economics should structurally favor ordinary home devices — especially mobile devices and laptops — rather than specialized mining hardware.
3. The incentive target is that a rational participant looking at the code and economics asks: **“why am I not using a mobile device to mine this?”**

These are design goals, not claims that ASIC resistance has already been proven.

## Current consensus boundary

The live network `fairyelf-public-testnet-v4` continues to validate the existing canonical-json double-SHA-256 Proof of Work. Browser/UI experiments may support FAE-RW1 alongside the legacy miner, but **no frontend artifact may silently redefine consensus**.

SHA-256-based mining remains the fallback until FAE-RW1 has passed the activation gates below. Any consensus switch requires an explicit protocol version, explicit activation height on testnet, published vectors, and rollback procedure.

## Mandatory activation gates

FAE-RW1 must not become testnet consensus until all of the following hold:

- A deterministic protocol specification defines challenge generation, work commitment, useful-work result encoding, PoW binding, verification and failure behavior.
- Challenges are bound to recent chain state and the candidate block so stale work, replay, precomputation and challenge substitution are rejected.
- Verification is deterministic across independent implementations and materially cheaper than producing accepted work.
- The useful-work component cannot be skipped while still obtaining a valid mining advantage.
- The design is attacked for work splitting, hidden parallelism, nonce/hash masking, challenge grinding, fabricated useful results, verifier asymmetry, replay, precomputation and specialized-hardware shortcuts.
- Cross-device benchmarks cover representative iPhone/iPad, Android, ARM/x86 laptops, desktop CPUs, GPUs and FPGA/ASIC threat models. “ASIC-resistant” is not declared from code inspection alone.
- The useful-work reward rule does not create a trusted coordinator, proprietary attestation dependency, device whitelist or manufacturer gate.
- Thermal management is treated separately from consensus. Mobile-friendly economics must not require unsafe sustained device temperature.
- Independent implementations reproduce frozen test vectors byte-for-byte and reject the same invalid vectors.
- Fork/reorg, stale-template, partition, reconnect and rollback tests pass before an activation height is scheduled.

## Deployment rule

Until the gates pass, production-facing testnet code may expose FAE-RW1 only as an explicitly experimental/candidate path with the legacy consensus path retained. Mainnet activation is prohibited without a separately reviewed protocol release.
