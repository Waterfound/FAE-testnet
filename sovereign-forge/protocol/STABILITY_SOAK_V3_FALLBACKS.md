# Stability Soak V3 — Zero-Cost Fallback Ladder

Status: **prepared candidates only**. Neither fallback starts a soak, changes consensus/economics, promotes a candidate, or grants mainnet authority.

## Plan A — frozen preferred path

Reuse the existing five Render Free services from the frozen V3 operational commit `8e061f81d0c9ec06e10f518a9dc3a9761cf7dfb3`. This remains preferred if the October refresh leaves the workspace unsuspended with at least 540 Free instance-hours and every prestart gate is GREEN.

## Plan B — Hybrid Render nodes + Cloudflare control plane

Use only the three regional Render nodes (Oregon, Frankfurt, Singapore). Move the controller to Cloudflare Workflows Free and the independent observer to a Cloudflare Worker Cron + D1 Free evidence store.

This reduces the Render envelope from:

`5 × 108h = 540h`

to:

`3 × 108h = 324h`.

The controller's 5-minute durable loop is budgeted conservatively at <=576 Workflow steps/day. The observer samples once per minute and stores bounded evidence in D1, far below current Free request/write limits. The 180-second failure bound is unchanged.

**Trigger:** Render works after refresh, but a five-service 540h envelope is not comfortably available.

## Plan C — Render-independent multi-provider topology

Nodes:

- A: Google Cloud Free Tier `e2-micro`, Oregon (`us-west1`).
- B: Koyeb Free Instance, Frankfurt.
- C: Oracle Cloud Always Free compute, São Paulo (`sa-saopaulo-1`) as the tenancy home region.

Controller/observer: same Cloudflare Free control plane as Plan B.

This preserves three nodes, three regions, and three node providers while removing Render from the run path.

Important admission conditions:

- Google Free Tier eligibility and an active billing account must be proven; no paid upgrade is authorized.
- Koyeb's Free service must receive regular inbound peer/controller/observer traffic so it never reaches the documented one-hour idle scale-to-zero boundary.
- OCI Always Free must use São Paulo as the tenancy home region. Because Oracle may reclaim idle Always Free instances after a seven-day low-utilization window, the V3 VM should be provisioned/restarted close to T0 and checked before the 96h clock.
- Any signup/payment-method verification is a human/account prerequisite, not authorization to incur charges.
- If any provider cannot prove zero-cost eligibility before T0, Plan C stays blocked.

## Rejected shortcuts

GitHub-hosted Actions are not continuous-node infrastructure because individual jobs are capped at six hours. Cloudflare Workers Free are not PoW/node hosts because the Free CPU budget is too small. Oracle Always Free alone cannot provide three geographic regions because Always Free compute is restricted to the tenancy home region. Koyeb alone provides only one Free Instance per organization.

No fallback may change the 180-second recovery boundary merely to make a topology pass.

## Official evidence snapshot (2026-09-18)

- Render Free: https://render.com/docs/free
- Cloudflare Workflows pricing/Free limits: https://developers.cloudflare.com/workflows/reference/pricing/
- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
- Google Cloud Free Tier: https://docs.cloud.google.com/free/docs/free-cloud-features
- Koyeb instances/free instance limits: https://www.koyeb.com/docs/reference/instances
- Oracle Always Free resources: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- Oracle regions: https://docs.oracle.com/en-us/iaas/Content/General/Concepts/regions.htm
- GitHub Actions limits: https://docs.github.com/en/actions/reference/limits
