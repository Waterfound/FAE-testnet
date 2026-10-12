# FAE Provider Escape & Reconstruction Inventory v1

Status: **candidate / read-only**  
Bound source: `2b9a90f0c96a17ad6945768b99763269bbcdd06d`

## Objective

Identify what must survive the loss of a provider, session or deployment environment before FAE can truthfully claim system-level reconstruction rather than component-level reproducibility.

This inventory does not move infrastructure.

| Component | Durable truth that must survive | Provider-specific state | Protected material | Reconstruction state |
| --- | --- | --- | --- | --- |
| Source + protocol implementation | Exact Git source/revision and reviewed history | Git hosting control plane | None required for public source recovery | **BOUNDED** — provenance model exists; whole-system provider-loss drill not yet proven |
| Browser client | Reviewed source + endpoint selection semantics | Hosting/CDN and default endpoint | None | **BOUNDED** |
| FAE node | Source + canonical protocol state/recovery inputs + stable identity where required | Host runtime/storage/network identity | Node private identity if stable identity is preserved | **ELEVATED** until identity/state migration is rehearsed |
| Standalone miner | Source + public node endpoint + public reward address | None required by design | None | **MINIMAL** |
| Share coordinator | Source + configuration + `coordinator-data` continuity | Host/Docker volume/DNS | Persistent Ed25519 private identity in protected storage | **ELEVATED** until protected migration is rehearsed |
| Release evidence | Exact source, reproducible inputs, hashes/provenance | CI/build provider artifacts | Signing/attestation material if used by a release path | **BOUNDED**; provider identity alone is not authority |
| Durable engineering state | Git-backed checkpoints/events/receipts + General Execution state | GitHub-hosted runtime workflow today | No project secrets should enter events/evidence | **BOUNDED**; chat/session independence proven by architecture |
| Stability Soak V3 | Frozen source, service bindings, node identities, controller/observer evidence, T0 once admitted | Current Render test environment | Stable node identity material | **FROZEN_WAIT** — current topology is evidence and must not be migrated by this work |

## Minimum reconstruction package

A future cross-provider drill should be able to begin from:

1. exact reviewed source revision;
2. authoritative configuration with secret values excluded;
3. durable evidence identifying required protected-state classes;
4. a secure out-of-band method to rematerialize protected identity material;
5. protocol state or an independently valid resynchronization path;
6. exact provenance/release verification instructions;
7. provider-neutral service requirements;
8. a test proving that reconstructed services do not acquire extra authority.

## Gaps

### PR-01 — Stable identity transport/recovery proof

The repository documents stable identities but this audit has not found a retained provider-loss rehearsal proving restoration without key leakage.

Disposition: **H3 design now; execution later in isolated environment.**

### PR-02 — Whole-system provider-loss drill

Component-level provider neutrality does not yet equal a single end-to-end reconstruction proof.

Disposition: **EXTERNAL_EVIDENCE after H1/H3 mature.**

### PR-03 — Default public endpoint concentration

The browser has provider escape through selectable node endpoints, but one default endpoint remains a concentration/correlation point.

Disposition: **CONDITION_WAIT until the Stability Soak V3 frozen execution is no longer a conflicting topology concern.**

## Terminal disposition

**PROVIDER_ESCAPE_INVENTORY_READY__END_TO_END_RECONSTRUCTION_EVIDENCE_OPEN**

No live provider mutation is justified by this inventory alone.
