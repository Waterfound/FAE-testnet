# FAE System Preservation Baseline v1

Status: **candidate / evidence-bound / no live mutation**  
Bound source: `2b9a90f0c96a17ad6945768b99763269bbcdd06d`  
Doctrine dependency: Waterfound/Systems `doctrine/system-preservation-low-exposure-001`

## Purpose

This baseline applies **System Preservation / Low-Exposure Architecture** to FAE without duplicating the existing public-code security program.

FAE already assumes a white-box adversary:

> FAE must remain secure even if an attacker knows 100% of the source code.

System Preservation asks a different question:

> **Which externally observable, reachable, authoritative, provider-bound or irreplaceable surfaces are actually necessary, and can FAE reconstruct safely if one environment disappears?**

Canonical shorthand:

> **Externally quiet. Internally observable. Recoverable by construction.**

## Authority boundary

This baseline is read-only with respect to live operation.

It does **not** authorize or perform:

- consensus or economic changes;
- release or mainnet activation;
- provider/account mutation;
- credential creation, disclosure or rotation;
- repository visibility changes;
- public endpoint removal or topology changes;
- Stability Soak V3 source, identity, deployment or T0 changes;
- paid fallback or new spending.

## Existing preservation-positive properties

### Public-code security

`SECURITY.md` and `docs/security/FAE_PUBLIC_CODE_THREAT_MODEL_V1.md` explicitly forbid source secrecy as a security assumption. Preservation therefore cannot be implemented by hiding source or relying on an attacker not discovering an endpoint.

### Secret-free sovereign mining

`standalone/README.md` requires only a node endpoint and a public reward address. Seed phrases, private keys, vaults, wallet sessions and signing authority are explicitly outside the miner. Persisted configuration is allow-listed and secret-shaped fields are rejected.

This is a strong preservation property because compromise or loss of the standalone miner process does not imply custody authority.

### Narrow coordinator exposure

`sovereign-forge/deploy/coordinator-dedicated/README.md` exposes the coordinator through TLS while keeping port 3190 internal to Docker. The coordinator holds no payout private key and no consensus authority.

Its stable Ed25519 identity is deliberately persistent in `coordinator-data`; that is **necessary stable identity**, not a finding by itself. The preservation question is whether migration/reconstruction of that protected identity is sufficiently explicit without leaking it into evidence.

### Provider identity is not protocol authority

The public-code threat model explicitly states that a hosting/provider control plane may be compromised and that provider identity alone is insufficient for repository/deployment integrity. Exact-source provenance and protocol validation remain the meaningful controls.

## Exposure Budget v1

The machine-readable matrix is `FAE_EXPOSURE_MATRIX_V1.json`.

Classifications:

- **MINIMAL** — no meaningful avoidable persistent exposure observed.
- **BOUNDED** — exposure exists and is currently justified/contained.
- **ELEVATED** — exposure is functionally valid but concentration/correlation/recovery cost merits a hardening candidate.
- **UNKNOWN** — evidence is insufficient; do not broaden exposure until resolved.
- **FROZEN_WAIT** — the surface belongs to a currently frozen or gated execution and must not be optimized in-place.

The objective is not to force every public service to MINIMAL. FAE is a network: nodes and APIs must sometimes be reachable. The objective is to ensure that necessary exposure does not silently accumulate authority or become an irreplaceable recovery dependency.

## Baseline findings

1. **Public source visibility — MINIMAL preservation concern.** Source transparency is intentional and protected by the white-box model. Hiding it would not improve the security premise.
2. **Default public node endpoint — BOUNDED/ELEVATED provider concentration.** Browser operation currently has a default public Supabase endpoint. Reachability is necessary for browser-first use, but default-provider concentration and correlation should remain explicit rather than invisible.
3. **User-selectable node override — BOUNDED.** The browser can select another node and verifies the reported network before persisting the endpoint. This improves provider escape, but endpoint identity alone is not authority.
4. **Dedicated coordinator — BOUNDED.** Public TLS exposure is intentional; internal service port remains non-public; payout and consensus authority are absent.
5. **Persistent coordinator identity — ELEVATED recovery concentration until migration evidence exists.** Stability is required, but the documented Docker volume is a protected recovery dependency. This is a recovery-proof question, not a request to publish or rotate the key.
6. **Standalone miner — MINIMAL.** Secret-free, browser-independent and wallet-independent operation materially reduces authority concentration.
7. **GitHub/provider build surfaces — BOUNDED.** Provider compromise is explicitly outside protocol authority; exact-source provenance and reproducibility reduce the consequence of provider visibility.
8. **Stability Soak V3 topology — FROZEN_WAIT.** Its five-service topology and node identities are test evidence surfaces. They must remain untouched by this work while the prestart identity gate is unresolved.
9. **Operator/session coupling — BOUNDED with one known genuine gate.** Durable Execution removes chat continuity from project truth, while the current Soak V3 node-b/node-c protected identity material remains a legitimate account-bound human gate.
10. **Cross-provider reconstruction — UNKNOWN as a system-wide property.** Several components are individually reproducible, but a single evidence package proving reconstruction after loss of a provider control plane has not been established by this audit.

## Candidate hardening direction

The first hardening wave should be **non-live and proof-oriented**, not topology-changing:

```text
Exposure Budget contract
  -> static evidence validator
  -> provider/recovery escape inventory
  -> stable-identity migration rehearsal design
  -> only then consider behavioral exposure changes
```

This preserves the existing security baseline and avoids optimizing away evidence or availability.

## Terminal classification for this audit

**FAE_SYSTEM_PRESERVATION_BASELINE_MATERIALIZED**

The baseline exposes actionable preservation questions without asserting mainnet readiness and without mutating live FAE behavior.
