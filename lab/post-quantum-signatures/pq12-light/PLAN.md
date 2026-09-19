# FAE PQ-12 Light Physical Test — Build Colony Plan

**Status:** PLANNED / EXECUTOR NOT YET STARTED  
**FAE revision:** `2a86043c6e54ac28bb9fdba440c2d86b544c3f6d`  
**Build Colony:** `17979869a85c9f5adf2cef2ceb589a07fcef6239`  
**Gate class:** `EVIDENCE_ACQUISITION`

## Objective

Produce one short browser-only PQ-12 test URL that the user can open on iPad/iPhone and run without setup.

The host is transport only:

> **Test host observes local benchmark execution; it has no FAE authority.**

The page must not use the active FAE network, wallet, RPC, backend state, persistent storage, or user private material.

## Frozen light workload

- ML-DSA-44, ML-DSA-65, ML-DSA-87 only.
- SLH-DSA explicitly excluded.
- 1 warmup + 3 measured repetitions per operation/parameter set.
- Operations: keygen, sign, verify.
- Metrics: median latency, key/signature sizes, total elapsed time, hardwareConcurrency when available, WebCrypto availability, user agent.
- Ephemeral local test material only.
- No automatic result upload. User copies the JSON result back into ChatGPT.

This is intentionally **not a stress test**.

## Host decision

**Route A — AppDeploy: PRIMARY.** Frontend-only static HTTPS environment, no backend/secrets and no dependency on the user's Vercel daily deployment budget.

**Route B — standalone Vercel preview: FALLBACK.** Use only if Route A cannot produce a working public page. It must be a separate preview and never the main FAE testnet.

**Route C — GitHub Pages: LAST FALLBACK.** Free and reproducible, but may introduce repository configuration/manual activation friction.

The previous Replit attempt is not part of the evidence path and is not retried.

## Work packages

### PQ12-00 — Authority and intensity freeze
Freeze the invariants above before any implementation.

### PQ12-01 — Browser benchmark
Single-page flow:

`Start PQ-12 Light Test -> Progress -> Results -> Copy Results`

No extra modes or advanced controls.

### PQ12-02 — Public static delivery
Publish Route A. Fall back only on a real deployment failure.

### PQ12-03 — Automated preflight
Verify:
- page loads at mobile viewport;
- Start initiates the workload;
- completion is visible;
- JSON result is rendered;
- Copy Results exists;
- no active FAE/backend request is made;
- no frontend/runtime error occurs.

### PQ12-04 — Physical handoff
User opens the URL on iPad, runs once, copies the result and returns it here. iPhone repetition is optional after seeing the iPad result.

## Success criterion

[
\boxed{\text{One working public URL + one short physical iPad result}}
]

No protocol, activation, wallet, consensus or production authority follows from this test.
