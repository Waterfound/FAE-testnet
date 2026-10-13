# FAE Elements & Tasks — Strategic Execution Selection and Feedback Discipline

**Decision:** 2026-10-13. **Scope:** cross-cutting operational selection rule for the existing **14 Mainnet-Critical Elements** (1–14) and their dependent Tasks, labs and frontier owners. **Status:** proposed documentation-only rule pending owner admission; not an additional Element, protocol change, or launch authority.

> **Maximum Machine Autonomy. Minimum Wasted Engineering. Maximum Verified Mainnet Progress.**

## Why this exists

The October 13 engineering burst produced source-confirmed security defects, narrow repairs, regression suites and candidate integration, but also duplicate test identifiers, divergent integration branches and disproportionate investment in a disabled optional PPLNS feature. Many source tests GREEN do **not** imply proportional mainnet gate closure; a reported +1 percentage point in analytic readiness is not the value or reliability of the work. Preserve the evidence and improve **selection, serialization and feedback**, not by reducing admissible machine autonomy.

## Binding selection discipline for each existing Element

Before a new independent execution wave, the owning machine should record, in the Element's existing work record or checkpoint (without creating another tracker):

1. **Current source & owner:** most recent exact source SHA, live-vs-candidate-vs-disabled reachability, existing PRs, concurrent owner, and the canonical mainnet gate it may close.
2. **Decision relevance:** what launch-critical uncertainty, reproducible high-severity defect, explicit integration prerequisite or external evidence requirement is being reduced? An optional inactive feature is deferred unless activation isolation fails or the issue can reach active consensus/security.
3. **Decisive evidence:** an explicit falsifiable negative/RED, a minimal REPAIR if proven, positive controls, exact-head GREEN and appropriate combined integration checks. Source-owner GREEN is not integrated or production GREEN.
4. **Opportunity cost:** compare expected blocker/gate closure, material severity, execution cost, evidence quality, dependencies, interference and alternatives. Prioritize *risk removed per constrained machine capacity*, not prompt/PR/test volume. Do not invent numerical probabilities or report metric inflation.
5. **Ownership and collisions:** *Parallelize independence. Serialize shared state.* One owner per integration boundary, tests and fixture identifiers globally unique, re-read moving heads, retain protected branches and separate alternatives. Do not duplicate PCC or compete with another conversation's writer.
6. **Feedback and stop predicate:** after each decisive cycle, classify **CONTINUE / INTEGRATE / REDIRECT / CONDITION_WAIT / EXTERNAL_EVIDENCE / HUMAN_GATE / CLOSE**. State what specifically changed in mainnet blockers and why another experiment would have higher value. Stop exploratory expansion when marginal information gain is immaterial.

## Repeatable decision loop

**RECONCILE → RANK → SELECT → ATTACK/BUILD → RED → REPAIR → GREEN → SERIAL INTEGRATION → MAINNET-GATE FEEDBACK → CONTINUE, REDIRECT OR CLOSE.**

Reports must distinguish (a) new information, (b) defects removed in source branches, (c) exact integrated security demonstrated, (d) actual canonical/production gate closure and (e) external/human blockers. Publish honest statuses and exact evidence links; do **not** increment a mainnet readiness estimate because another suite, branch or draft PR passed.

## Coverage and authority

This selection overlay applies to all existing Mainnet-Critical Elements:

1. Public-Code Security;
2. Final Consensus & Economics Freeze;
3. Production Chain Identity / Genesis;
4. Production Network Bootstrap;
5. Complete User Journey;
6. Clean-State Mainnet Rehearsal;
7. Final Reproducible Release;
8. Operational Stability;
9. Representative Physical PoW Evidence;
10. Final White-Box Project Assurance;
11. Open-Source, Legal & Disclosure;
12. Mainnet Activation / Incident Runbook;
13. Node & User Documentation;
14. Canonical Launch Freeze.

It **does not** replace the Elements & Tasks owner records, the 24-gate mainnet readiness ledger (`docs/FAE_MAINNET_READINESS_STATE.json`), or the draft authored-product bridge (`docs/product/FAE_ELEMENT_PRODUCT_GATE_BRIDGE.md`, PR #298). It creates **zero new Elements, gates, schedules, credentials, tools, production settings, consensus decisions, fee/PPLNS activations, or spending**.

Waterfound retains final authority. Keep One Man involvement near zero until a genuine human gate; the machine should autonomously resolve admissible choices inside its existing authority. Under the most recent HPA mainnet-critical cutline in private Systems #26, optional inactive pool-feature exploration is not a substitute for active-consensus security, W2 fee/security-budget closure, release-image default-disabled proof, independent operational evidence or final explicit mainnet authorization.

**Acceptance by an Elements owner:** reference this rule in the next admissible Element/Task checkpoint and use it as a preflight/feedback filter. That adoption is **not** itself a completed security gate, a mainnet score increase or a merge authorization. This documentation-only proposal must be reconciled by the existing registry owner before canonical adoption.
