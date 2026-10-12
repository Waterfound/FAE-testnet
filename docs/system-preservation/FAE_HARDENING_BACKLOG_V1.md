# FAE System Preservation — Bounded Hardening Backlog v1

Bound source: `2b9a90f0c96a17ad6945768b99763269bbcdd06d`

This backlog is derived from `FAE_EXPOSURE_MATRIX_V1.json`. It is deliberately **proof-first**. None of these items authorize live topology or credential changes.

## H1 — Executable Exposure Contract

Create a deterministic offline validator for the preservation matrix.

It should fail closed when:

- a surface lacks evidence references;
- a classification is outside the frozen enum;
- an UNKNOWN surface is represented as closed;
- protected material is copied into the matrix instead of referenced abstractly;
- an action silently claims consensus, economics, release or mainnet authority.

**Admissibility:** software-only, non-live, reversible.  
**Priority:** first.

## H2 — Provider Escape Inventory

Produce a component-level inventory of what is required to reconstruct FAE operation after losing one provider control plane.

Record source/evidence dependencies, protected state dependencies, public DNS dependencies and genuine account-bound gates.

**Admissibility:** read-only.  
**Do not:** migrate providers during this wave.

## H3 — Stable Identity Recovery Rehearsal Design

Design an isolated rehearsal for moving/restoring a stable node/coordinator identity while:

- never putting private material in Git, CI logs or Build Colony evidence;
- proving the public identity remains stable;
- proving a newly generated identity is not silently substituted;
- preserving exact-source provenance.

**Admissibility:** design now; execution only in an isolated non-Soak environment under separately resolved protected-material handling.

## H4 — Public Endpoint Concentration Review

After Stability Soak V3 is no longer frozen, evaluate whether browser defaults can reduce single-provider concentration without reducing usability or pretending endpoint diversity creates protocol trust.

**Current status:** CONDITION_WAIT on Soak V3.  
**Do not mutate current default endpoint in this program.**

## H5 — Preservation Regression Gate

After H1-H4 produce executable requirements, add a recurring non-secret regression gate that verifies preservation invariants for changes touching deployment/configuration/authority boundaries.

This must complement, not replace, Project Assurance.

## H6 — Cross-provider Reconstruction Drill

Run only after the inventory and identity rehearsal are mature. The goal is to prove:

> a provider environment can disappear without losing project truth, protocol correctness, protected identities that must remain stable, or the ability to reconstruct service from durable evidence.

This is an **EXTERNAL_EVIDENCE** frontier if it requires real provider infrastructure.

## Current ceiling

H1 and H2 are machine-executable now.  
H3 is design-executable now but protected-material execution is gated.  
H4 is CONDITION_WAIT on the frozen Soak V3.  
H5 waits on H1-H4 evidence.  
H6 is external evidence after the preceding contracts mature.
