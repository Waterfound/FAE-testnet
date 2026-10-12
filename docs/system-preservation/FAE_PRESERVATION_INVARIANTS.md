# FAE Preservation Invariants

The preservation audit adds these **non-consensus** engineering invariants on top of the existing security baseline:

- **PRES-01 — Knowledge ≠ reachability.** Public source and protocol knowledge are never treated as access control.
- **PRES-02 — Reachability ≠ authority.** Exposed interfaces receive only the authority necessary for their function.
- **PRES-03 — Provider identity ≠ protocol authority.** A default provider may be convenient but must remain replaceable where technically reasonable.
- **PRES-04 — Secrets ≠ evidence.** Recovery and verification evidence never require publishing reusable protected material.
- **PRES-05 — Session ≠ control plane.** Browser/chat/login context cannot be the only durable source of execution truth.
- **PRES-06 — External quietness ≠ internal blindness.** Exposure reduction must preserve receipts, lineage, diagnostics and exact-source evidence.
- **PRES-07 — Recovery is proven.** Persistent state that matters to identity or continuity needs a reconstruction/migration proof or an explicit residual gate.
- **PRES-08 — Open tests are protected from preservation drift.** An evidence-critical topology such as Stability Soak V3 cannot be altered merely to reduce exposure before that frontier closes.

These invariants do not activate consensus rules, alter economics, or authorize deployment.
