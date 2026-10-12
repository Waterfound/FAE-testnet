# FAE Post-Quantum Signature Lab

Status: **SHADOW / NO ACTIVATION AUTHORITY**

This directory is the only implementation write scope for the FAE Post-Quantum Signature Lab unless a later, explicit Build Colony package narrows or extends the scope without crossing the active-protocol boundary.

## Boundary

The active FAE system remains authoritative and unchanged:

- Ed25519 remains the active wallet/signature primitive.
- Transaction v2 remains the active transaction format.
- Current `faet` addresses remain authoritative.
- Public-testnet consensus is unchanged.
- No mainnet activation authority is granted.

The Lab may read active reference code for parity and compatibility testing. The dependency direction is one-way: **active runtime code must never import or depend on Lab code**.

## PQ-00 gate

PQ-00 is GREEN only when:

1. the authority manifest is fail-closed;
2. the boundary guard confirms the active runtime contains no Lab dependency;
3. the branch diff changes only PQ-authorized paths;
4. removing the Lab leaves the active FAE implementation unchanged;
5. CI verifies the guard before later PQ work is admitted.

PQ-01 standards pinning may begin only after this boundary is verified.

## Authority

See `authority.json`. Research may advance; activation may not.
