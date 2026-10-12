# Stable Identity Recovery Rehearsal Design v1

Status: **DESIGN_READY / EXECUTION_GATED**

## Purpose

Prove that a stable FAE service identity can survive loss of its original runtime/provider environment without:

- publishing private identity material;
- placing protected material in Git, CI logs, Build Colony evidence or chat;
- silently replacing the identity with a new key;
- weakening exact-source provenance;
- granting the reconstructed service new protocol authority.

## Applicability

This design applies to stable node/coordinator identities. It must **not** be executed against the currently frozen Stability Soak V3 node identities.

## Isolated rehearsal

1. Create an isolated non-authoritative fixture with an ephemeral test-only stable Ed25519 identity.
2. Persist the identity only through a protected storage channel excluded from repository/evidence.
3. Record the public identity, exact source revision, configuration digest and service-state digest.
4. Destroy the first runtime environment.
5. Reconstruct the service in a second isolated environment from exact source plus the protected identity channel.
6. Verify:
   - public identity unchanged;
   - source revision exact;
   - configuration contract unchanged;
   - no private material appears in logs/artifacts/evidence;
   - service gains no payout, consensus, release or deployment authority;
   - a fresh identity substituted in place of the protected identity causes the continuity test to fail.
7. Destroy the isolated fixture and retain only non-secret receipts/digests.

## Required evidence

- exact source SHA;
- public identity before/after;
- non-secret configuration digest;
- negative-control result for substituted identity;
- secret-scan result over retained evidence;
- provider/runtime identities for both isolated environments;
- teardown receipt.

## Gate

Execution requires an environment in which protected identity material can be created/rematerialized without entering repository evidence. If that requires account-bound secret handling, classify it **HUMAN_GATE** rather than weakening the design.

## Explicit exclusions

No Stability Soak V3 identity, production key, wallet key, seed phrase, release signing key, consensus/economic change, mainnet action, or paid provider action is authorized by this design.
