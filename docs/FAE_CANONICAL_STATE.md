# FAE Canonical State

Status: living context registry for FAE engineering work  
Last reviewed: 2026-09-23  
Repository: `Waterfound/FAE-testnet`

## Purpose

This file is a small living registry for the current accepted FAE state. It is not a replacement for consensus specifications, frozen evidence, release manifests, or lab reports.

Before making a consequential FAE engineering decision, read the current version of this file from `main` and then follow the referenced source artifacts. If an older conversation conflicts with this registry, do not rely on the stale conversation. If this registry conflicts with a referenced authoritative or frozen source artifact, the source artifact wins and this file should be corrected.

Frozen historical evidence must remain frozen. Update this file only when an accepted parameter, candidate, gate, or authority state materially changes.

## Current live public-testnet authority

Authoritative network:

- network: `fairyelf-public-testnet-v4`
- target block interval: 180 seconds
- initial subsidy: 10 FAE/block
- halving era: 600,000 blocks
- maximum supply: 12,000,000 FAE
- premine / treasury / administrative mint: none

The live public testnet has not been silently migrated to the future economic candidate.

Primary references:

- `README.md`
- `sovereign-forge/release/software-only-ceiling-freeze.json`
- `sovereign-forge/node/authoritative/fae-v4-core.mjs`

## Preferred future economic candidate

Current preferred research candidate:

- target block interval: 300 seconds
- initial subsidy: 14 FAE/block
- halving era: 430,000 blocks
- hard monetary ceiling / theoretical geometric maximum: 12,040,000 FAE
- base unit: 100,000,000 atoms = 1 FAE
- coinbase maturity: 200 blocks = 16h40m at 300 seconds

Atom-exact Pure Halving arithmetic from 14 FAE and 430,000-block eras yields:

- exact maximum scheduled issuance: 12,039,999.94840000 FAE
- permanently unissued remainder under the 12,040,000 FAE hard ceiling: 0.05160000 FAE = 5,160,000 atoms

Authority status:

- research incumbent / preferred future candidate
- not active public consensus
- candidate selection does not equal activation
- activation height: not selected
- candidate -> authoritative: false
- mainnet launch authorized: false
- public consensus changed: false
- Focused Red Team L3 required before any activation package can advance

Block-time research disposition:

- 300s: GREEN research incumbent
- 600s: YELLOW challenger, not selected
- 900s: CLOSED for the current branch

Primary references:

- `sovereign-forge/protocol/ECONOMIC_BLOCK_TIME_V2_LAB.md`
- `sovereign-forge/protocol/ECONOMIC_BLOCK_TIME_V2_PRE_L3_CEILING.md`
- `sovereign-forge/release/software-only-ceiling-freeze.json`

## Software ceiling

The H2 serialized integration freeze reached:

`SOFTWARE_ONLY_PRE_MAINNET_CEILING_REACHED`

The accepted H2 meaning is narrow:

- software-only work available before new external evidence was exhausted at that freeze;
- this does not claim mainnet readiness;
- newly discovered external evidence may reopen only the affected boundary;
- no candidate receives production, consensus, or launch authority from H2.

Frozen H2 baseline:

`745faec3c2ee3fd214199b60293f46e7b9d5a92b`

Primary references:

- `sovereign-forge/protocol/AGENT_BUILD_COLONY_H2_FINAL_SERIALIZED_INTEGRATION.md`
- `sovereign-forge/release/software-only-ceiling-freeze.json`

## Stability Soak V3 operational state

Current operational state:

`PREPARED_NOT_STARTED`

Frozen V3 source checkpoint:

`600c131fff12251f426883ad1000a8e5a7f068c0`

Frozen Render operational commit:

`8e061f81d0c9ec06e10f518a9dc3a9761cf7dfb3`

The historical V2 WAN-lab state remains preserved separately; do not reinterpret either interrupted historical soak as PASS.

Preferred execution order:

1. **Plan A — existing five Render Free services.** On or after 2026-10-01, first verify the workspace is unsuspended and that at least 540 Free instance-hours are available for the 108-hour envelope. Verify stable node identities, peer bootstrap, monitor URLs, frozen commit, health, three distinct node identities, at least two bootstrap peers per node, and controller/observer `run_started=false`. Only then may a future `T0` be assigned.
2. **Plan B — hybrid fallback.** If Render works but a five-service/540h envelope is not comfortably available, keep only A/B/C on Render, run the logical controller inside Node A (no extra Render instance), and use Cloudflare Worker Cron + D1 as the independent observer/evidence collector. Nodes preserve fine local first-seen and reachability timestamps for later collection. Required Render envelope remains 324 instance-hours. The 180-second recovery/outage bound remains unchanged.
3. **Plan C — Render-independent fallback.** If Render remains unavailable or Plan B cannot satisfy the frozen prestart gates, use the admitted multi-provider candidate: Google Cloud Free Tier node in Oregon, Koyeb Free node in Frankfurt, Oracle Always Free node in São Paulo. The controller runs inside Google Cloud Node A; Cloudflare Worker Cron + D1 provides the independent observer/evidence store. Provider free-tier eligibility, zero-cost status, geographic requirements, and all account prerequisites must be proven before `T0`; no paid upgrade or overage is authorized by this fallback.

Validated fallback runtime freeze:

`140be01baff5a770263f81a13b728e63b0ce02cb`

Preserved branch: `freeze/stability-soak-v3-fallback-runtime-20260918`

Fallback artifacts:

- `sovereign-forge/release/stability-soak-v3-fallbacks.json`
- `sovereign-forge/protocol/STABILITY_SOAK_V3_FALLBACKS.md`
- `sovereign-forge/tests/stability-soak-v3-fallbacks.test.mjs`

The V3 criteria must not be weakened to make any provider topology pass. In particular, the 180-second recovery/outage bound remains frozen.

## External evidence gates

Current admitted state:

- physical HFB / RTX + watts evidence: unresolved
- representative-device evidence: unresolved
- operational soak: unresolved; no PASS should be inferred from elapsed time or a partial run
- independent-operator evidence: unresolved

A fresh operational soak may be admitted only after its complete frozen window and predefined gates are satisfied. Do not convert a partial or interrupted run into PASS.

## Final production freeze still unresolved

The H2 freeze still leaves production-specific values unselected, including:

- production activation height
- bootstrap requirements
- bootstrap nodes
- final release artifact and manifest digests
- final release source commit/tree
- final production genesis values required by the release package

These must remain unset until their own evidence and explicit authority gates are satisfied.

## Block Explorer engineering state

The Block Explorer remains a separate, read-only FAE application boundary.

Accepted implementation state carried by canonical main after BE-02 integration:

- BE-01 read-model/authority contract: verified;
- BE-02 Independent Node `/explorer/*` read surface: verified;
- Explorer data source: coherent snapshots of independently validated node state;
- supported read resources: status, latest blocks, block lookup, transaction lookup, address events/balance, universal search;
- address history includes transfer and mining/reward events;
- address pagination cursors bind to the observed tip hash and fail closed across tip change;
- Explorer mutating methods: forbidden;
- Explorer database/indexer: not required; any future cache/index remains derived disposable state;
- consensus, fork choice, wallet ownership/signing, transaction admission, mining, economics, network survival and mainnet authority: unchanged;
- BE-03 standalone Explorer application source: verified as a separate static read-only application under `explorer/`;
- Explorer application transport: fixed to the verified `/explorer/*` GET surface, with no generic arbitrary-path client;
- Explorer UI: status metrics, latest blocks, universal search, block/TX/address details, reward + transfer activity and tip-bound pagination;
- Explorer application network binding: fail closed unless successful responses identify `fairyelf-public-testnet-v4` and include a valid observed tip binding;
- Explorer application imports from Wallet/Mining active site: none;
- BE-04 provider-independent deployment artifact: candidate verified;
- Explorer public frontend: verified at `https://fae-block-explorer-e2z4q3.v2.appdeploy.ai/` in `PUBLIC_PREBIND / UNBOUND` state;
- hosted config: `api_base: null`, `read_only: true`, source-bound to `eabddc8db3f79f4ac6a7544316809f3d879954fe`;
- public frontend QA: no reported frontend, network or backend errors in the provider snapshot;
- public HTTPS Independent Node binding: blocked pending an eligible persistent Independent Node host;
- Explorer LIVE state: **NOT_LIVE**; the public prebind does not authorize chain data, consensus, wallet, signing or mining authority;
- BE-05 provider discovery: no eligible existing persistent Independent Node host found in the connected Render, Vercel, AppDeploy, DigitalOcean, AWS EC2 or accessible Lightsail inventory;
- BE-05 provider-neutral runtime contract: prepared for a private-loopback Independent Node with durable validated state behind an exact-route read-only gateway and provider HTTPS termination;
- BE-05 public gateway: prepared and tested to expose only GET/OPTIONS on the six verified `/explorer/*` resources; node submission/feed/state routes remain private;
- BE-05 binding probe: prepared and tested for HTTPS, network identity, observed-tip coherence, CORS GET/OPTIONS policy, POST rejection and hidden submit routes;
- BE-05 deployment/binding: **not performed and not authorized**; a persistent eligible host remains an external evidence gate.

Primary references:

- `lab/block-explorer/read-model-v1.json`
- `lab/block-explorer/authority.json`
- `sovereign-forge/node/explorer-read.mjs`
- `lab/block-explorer/tests/be-02-query-surface.test.mjs`
- `explorer/README.md`
- `explorer/api-client.mjs`
- `explorer/app.mjs`
- `lab/block-explorer/tests/be-03-app.test.mjs`
- `explorer/build.mjs`
- `lab/block-explorer/tests/be-04-deployment.test.mjs`
- `lab/block-explorer/be04-public-prebind-evidence.json`\n- `lab/block-explorer/be05-provider-scan.json`\n- `lab/block-explorer/be05-node-deployment-v1.json`\n- `lab/block-explorer/be05-readonly-gateway.mjs`\n- `lab/block-explorer/be05-binding-probe.mjs`

## Cross-Lab integration rule

Lab-local success does not automatically make a result canonical or live.

Required status separation:

- `LAB_VERIFIED` — bounded Lab evidence passed;
- `INTEGRATED_MAIN` — the result is present in canonical `main`;
- `COMBINED_MAIN_VERIFIED` — the exact combined `main` revision passes the cross-Lab integration gate;
- `LIVE` — deployment/runtime evidence binds the running system to that exact integrated revision or artifact.

Before a Lab result is merged, its candidate branch must contain the latest canonical `main`. If `main` advances, the Lab branch must be reconciled again before final integration. Independent Lab passes do not prove combined behavior.

Primary references:

- `docs/FAE_LAB_INTEGRATION_PROTOCOL.md`
- `lab/integration/registry.json`
- `tools/verify-lab-integration.mjs`
- `.github/workflows/lab-integration-gate.yml`

## Working rule for future conversations and automations

For FAE work:

1. resolve this file from current `main`;
2. inspect the referenced source artifact for the boundary being changed;
3. treat old conversation context as informative, not authoritative, when it conflicts with current canonical repository state;
4. never update frozen historical evidence merely to make it look current;
5. update this living registry after an accepted, evidence-backed state change;
6. never infer activation, mainnet authority, or candidate promotion from research status alone.
