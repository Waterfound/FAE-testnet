# FAE Consensus Authoritative 0.7 reconciliation gate

Status: integration candidate for the public testnet, not a silent consensus replacement.

## Provenance

The authoritative development line recovered from the project library is `fairyelf-0.7.0-testnet.zip`, the final package in the 0.4 -> 0.5 -> 0.6 -> 0.7 sequence. Its original suite passes 40/40 tests plus sovereignty audit, maintainer audit, deterministic manifest verification and the Python consensus oracle.

0.7 preserves the 0.4 architecture (headers-first/common-ancestor synchronization, peer resource controls, non-custodial delayed-PPLNS, direct-PoW fallback, sovereign signer and candidate binary codec) and adds persistent peer identity/trust continuity plus an authenticated encrypted X25519/HKDF/AES-256-GCM peer channel.

## Precedence rules

1. Later ratified FAE protocol decisions override stale constants embedded in the historical package.
2. Security and sovereignty invariants from the Authoritative line are preserved unless a later implementation demonstrably strengthens the same invariant.
3. The current canonical chain history, UTXO semantics and cumulative-work/reorg recovery must not regress.
4. Any rule that changes block validity requires an explicit activation boundary and dedicated migration tests.
5. Candidate features remain candidate until explicitly activated; code presence is not consensus activation.

## Explicit STOP conflicts

- Keep 180-second target. Do not reintroduce the older 190-second constant.
- Keep `fairyelf-public-testnet-v4` and its existing historical chain. Do not replace it with the old `fairyelf-testnet-v2` lineage.
- Keep cumulative-work fork choice and the 3-node partition/reorg transaction-recovery behavior already verified on Canonical 9.
- Do not promote the historical batch-retarget design as a mainnet rule. Difficulty evolution remains subject to the later DAA research/activation gate.
- Binary consensus codec v3 remains candidate/inactive.
- Multi-output coinbase / delayed-PPLNS changes block validity and therefore requires an explicit testnet activation gate before becoming active.

## Integration order

1. Non-consensus P2P hardening: persistent Ed25519 identity, TOFU continuity/explicit rotation, resource guard, authenticated encrypted peer channel.
2. Headers-first/common-ancestor branch synchronization on top of the existing canonical chain and reorg recovery.
3. Coordinator discovery and non-custodial delayed-PPLNS with direct-PoW fallback.
4. Multi-output coinbase behind an explicit activation boundary.
5. Sovereign signer and transfer-intent bridge.
6. Candidate codec/test vectors, fuzz/property/oracle coverage and deployment/audit material.
7. Combined regression suite, then promotion to `main` and public-testnet deployment only if all gates are green.
