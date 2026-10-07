# FAE System Preservation — Exposure Audit 001

**Source:** `2b9a90f0c96a17ad6945768b99763269bbcdd06d`  
**Mode:** read-only, evidence-first  
**Live mutations:** none  
**Stability Soak V3:** untouched

## Verdict

```text
AUDIT_COMPLETE__HARDEN_EXISTING_FRONTIERS
```

FAE does **not** need another generic security program. Its existing public-code security model already assumes complete source disclosure and treats provider identity as non-authoritative.

The preservation gap is narrower:

> reduce unnecessary persistent exposure and concentration while keeping public functionality, exact-source evidence and deterministic recovery.

## Exposure budget

| Surface | Reachability | Observability | Authority | Provider coupling | Recovery | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| Public source | MINIMAL | ELEVATED | MINIMAL | BOUNDED | MINIMAL | Accepted by design |
| Browser default node | ELEVATED | ELEVATED | BOUNDED | ELEVATED | BOUNDED | Harden existing frontier |
| Standalone miner | BOUNDED | BOUNDED | MINIMAL | MINIMAL | MINIMAL | Covered |
| Share coordinator candidate | BOUNDED | ELEVATED | BOUNDED | BOUNDED | BOUNDED | Preservation review |
| Soak V3 infrastructure | BOUNDED | ELEVATED | MINIMAL | ELEVATED | BOUNDED | HOLD until current test closes |
| Public-code assurance | MINIMAL | BOUNDED | MINIMAL | MINIMAL | MINIMAL | Reuse, do not duplicate |

## Evidence highlights

The FAE security policy explicitly states that the system must remain secure when an attacker knows the entire source. Therefore hiding repositories, source, protocol details or public-node implementation is **not** an admissible preservation strategy.

The browser currently contains a concrete default public-testnet node endpoint. This does not create protocol authority because a user can select another verified FAE node, but it does make one provider path the obvious default and concentrates availability/metadata.

The standalone miner is already close to the desired preservation shape: it stores only allow-listed non-secret configuration, needs no wallet or signing authority, can select a node, and requests fresh state after restart.

The coordinator candidate also has useful low-exposure properties: its service port is internal, only the TLS edge is public, and it holds no payout private key or consensus authority. The remaining preservation question is whether its stable identity and persistent ledger can be reconstructed/migrated without silent provider dependence.

The current Stability Soak V3 topology is an explicit **do-not-disturb zone**. Its exact source, stable identities and five-service configuration are evidence for another open frontier. System Preservation therefore records that exposure but does not attempt to reduce it while the test is unresolved.

## First hardening candidates

1. **SP-H1 — Default-node indirection.** Remove unnecessary provider identity from the compiled browser default path while preserving user-selected nodes, deterministic diagnostics and existing trust semantics.
2. **SP-H2 — Coordinator recovery proof.** Add an offline reconstruction/migration rehearsal for the stable coordinator identity and ledger, without exposing private material.
3. **SP-H3 — Exposure Budget check.** Add a repository-level machine-readable assurance check for new hard-coded provider endpoints, authority-bearing public surfaces and undocumented single-point recovery state.

These are candidate-only. Any live provider mutation, secret rotation, endpoint cutover, consensus/economic change, release or mainnet action remains outside current authority.
