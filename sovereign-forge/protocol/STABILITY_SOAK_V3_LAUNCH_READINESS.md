# FAE — Stability Soak V3 Launch Readiness

Status: **CONDITION_WAIT / EXTERNAL_PROVIDER_GATE**

This document is an operational checkpoint. It does not start Stability Soak V3, authorize spend, alter consensus/economics, or weaken any scientific criterion.

## Evidence rule

**Memory suggests. Evidence decides.**
A conversation state is never launch evidence. V3 is not started until a durable T0/run identity and provider/source bindings exist.

## Historical reconstruction

### V1

Canonical V2 documentation records the previous V1 run as healthy for approximately **4.004 hours** before an HTTP operation aborted.

Last preserved checkpoint:
- height: 49
- stale blocks: 0
- reorgs: 0 on all three nodes
- propagation P50: 95 ms
- propagation mean: 100.62 ms
- propagation P95: 128 ms
- propagation max: 196 ms
- one-sided Wilson 95% upper bound: approximately 5.23%

Classification: **FAIL / incomplete**, never PASS.

### V2

Frozen historical branch:

`archive/render-wan-lab-v2-failed-20260914`

Frozen V2 protocol head:

`91b74aac1a565a8d3be46bee902c931b995a9024`

V2 introduced bounded transport resilience:
- request timeout: 12 s
- attempts/request: 4
- maximum continuous transient outage: 180 s
- unresolved or >180 s outage: hard FAIL.

The first authorized V2 checkpoint was emitted at `2026-09-13T11:35:41.719Z`, proving the measurement loop started but not a PASS.

Subsequent diagnostic replay in PR #105 established the historical Frankfurt incident as a real runtime instance restart. The V2 WAN node kept chain and dynamically configured peers only in memory, so the restarted process returned at height 0 with no configured peers.

Current-stack replay then survived three equivalent hard restarts and reconverged in 231 ms, 237 ms, and 232 ms, preserving state and configured peer bootstrap. That failure mode is therefore addressed in the current stack without changing the frozen 180 s bound.

## V3 frozen evidence

Operational V3 harness freeze:

`8e061f81d0c9ec06e10f518a9dc3a9761cf7dfb3`

Historical zero-cost/prestart CI candidate:

`600c131fff12251f426883ad1000a8e5a7f068c0`

Historical GREEN zero-cost workflow evidence:
- `stability-soak-v3-zero-cost-colony` run `35337238899`
- fresh-bootstrap recovery gate: GREEN
- V3-sized 1,152-additional-block bootstrap: GREEN
- zero-cost quota/authority invariants: GREEN
- analyzer/Wilson discipline: GREEN
- frozen topology prestart gate: GREEN
- restart-aware harness smoke: GREEN.

Current explicit terminal/success contract entered at:

`359d2cefab3a2003c8563069f4f0d0adb77f44c3`

The contract requires at least 96 continuous hours, four 24 h phases, dual monitor coverage, frozen source binding, recovery <=180 s, observed stale rate <1%, one-sided Wilson 95% upper bound <1%, propagation P95 <5 s, complete reorg accounting, chain progression, complete timestamps and final-chain evidence. Partial execution may not PASS. Missing/malformed required evidence becomes EVIDENCE_INCOMPLETE.

## Current provider observation — 2026-09-29

Plan A's existing five Render services were inspected live.

All five:
- still exist;
- are on plan `free`;
- have auto-deploy disabled;
- are currently `suspended` with suspender `billing`.

The currently deployed commits are historical V2-era revisions:
- regional nodes A/B/C: `0513006f24eb4c3249aa6a2c47240200de99bb66`
- controller: `d84399c7eaa25fea5bdad0a32146e14c8b9c7645`
- observer/logger: `8a2a9ead7730521c86900210dd87ed91f686d504`

Therefore Plan A is **not launch-admissible now**.

No paid plan, paid fallback, provider upgrade, new spend, redeploy, or real soak launch was performed.

## Current exact-source preflight state

Launch-readiness branch:

`preflight/stability-soak-v3-launch-readiness-20260929`

A self-referential no-launch workflow guard was corrected at:

`ef8f6ca3838abf6ef0e882c10a31bc70a2ae6e9d`

A side-effect-free exact-source run request was then persisted at:

`3e830756d73491eddbaecc5dc0be23822431d8fb`

No GitHub Actions workflow run was observable for either revision at the time of this checkpoint. This is **not** a PASS. Historical GREEN evidence remains valid as historical evidence only.

## Exact Plan A launch admission procedure

Do not assign T0 unless every item below is positively evidenced.

1. The date is on or after **2026-10-01**.
2. Render workspace is not suspended.
3. All five intended services remain on the free plan.
4. A conservative capacity proof establishes at least **540 remaining free instance-hours** for the 108 h envelope (96 h + 12 h margin × 5 services).
5. Deploy/rebind the existing five services to the frozen V3 operational harness revision; do not create a second paid topology.
6. Verify auto-deploy remains OFF for all five services.
7. Verify all five services are healthy and bound to the intended frozen source.
8. Verify exactly three regional nodes: Oregon, Frankfurt, Singapore.
9. Verify distinct durable node identities.
10. Verify each node has at least two configured bootstrap peers.
11. Verify valid height/tip state and pre-T0 convergence.
12. Verify controller and observer are healthy.
13. Verify every node, controller and observer reports `run_started=false`.
14. Obtain an exact-source preflight execution receipt; historical CI alone is insufficient for an altered launch candidate.
15. Persist run ID, exact source commit, provider/service bindings, identities, starting height/tip, capacity proof and a future UTC T0.
16. Only after that durable launch-admission record exists may the 96 h clock begin.
17. No code/config/redeploy changes are allowed merely to rescue the experiment after T0. Any real FAE defect remains a defect; any provider/harness failure must be classified rather than hidden.

## Terminal classification

Use only:
- PASS
- FAIL
- INCONCLUSIVE
- PROVIDER_FAILURE
- HARNESS_FAILURE
- EVIDENCE_INCOMPLETE

A partial soak is never a PASS.

## Fallback boundary

Plan B and Plan C remain prepared concepts, not automatically admitted launch paths.

Plan B requires independent proof that its three Render nodes plus free Cloudflare observer/control surfaces are actually zero-cost and available at T0, including at least 324 remaining Render free instance-hours.

Plan C requires independent live proof of the free-tier eligibility, capacity and prerequisites for each provider before any provisioning or T0. No paid fallback or overage is authorized.

## Durable Execution checkpoint

General Execution portfolio:

`fae-stability-soak-v3-preflight-launch-readiness`

Bootstrap event:

`fae-stability-soak-v3-preflight-bootstrap-001`

Durable runtime consumption commit:

`63db9a0bc29c3e5cfc6bbd161944ee6fcfc269cf`

Persisted state digest:

`sha256:2d649b548c0b57abdc2664767ea223922dd05a9c5f259e007ffef99b6402fc19`

Current wake predicate:

`date>=2026-10-01 AND render_workspace_unsuspended=true AND remaining_free_instance_hours>=540 AND exact_source_preflight_receipt=PASS`

Until that predicate is satisfied, the correct state is **CONDITION_WAIT / EXTERNAL_PROVIDER_GATE**.
