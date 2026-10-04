# FAE Canonical State

Status: living context registry for FAE engineering work  
Last reviewed: 2026-09-28  
Tokenomics authority updated: 2026-10-04  
Repository: `Waterfound/FAE-testnet`

## Purpose

This file is a small living registry for the current accepted FAE state. It is not a replacement for consensus specifications, frozen evidence, release manifests, or lab reports.

Before making a consequential FAE engineering decision, read the current version of this file from `main` and then follow the referenced source artifacts. If an older conversation conflicts with this registry, do not rely on the stale conversation. If this registry conflicts with a referenced authoritative or frozen source artifact, the source artifact wins and this file should be corrected.

Frozen historical evidence must remain frozen. Update this file only when an accepted parameter, candidate, gate, or authority state materially changes.

## Canonical readiness orchestration

Machine-readable readiness registry:

- `docs/FAE_MAINNET_READINESS_STATE.json`
- schema: `FAE_MAINNET_READINESS_STATE_V1`
- generated from canonical `main` revision `48ba1df01075f7e6714d2e98d5ce8df827d1e5f2`
- reconciliation workstream role: `SECONDARY`
- authority: documentation/evidence state only; this registry does not create protocol or mainnet authority

Current portfolio ordering at this reconciliation checkpoint:

- `ACTIVE`: FAE Research — 180s Economic + Block-Time Validation
- `SECONDARY`: FAE — Mainnet Readiness & Canonical State Reconciliation
- rule: **Parallelize independence. Serialize shared state.**

The 180s Research workstream is isolated on `colony/fae-180s-economic-block-time-validation-001`. At the MR-05 serialization check on 2026-09-28 it was strictly ahead of `main` and did not modify this registry. Any later integration must re-resolve both `main` and the Research branch before mutating shared canonical state.

Readiness state names are frozen in the machine-readable registry. In particular, `HUMAN_GATE` means the *next admissible* advancement requires a physical, account-bound, or authority-bound Waterfound action. Mere incompleteness or machine-executable waiting is not a human gate.

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

## Authoritative future tokenomics design

Waterfound-authoritative economic design decision recorded on 2026-10-04:

- initial subsidy: **10 FAE/block**;
- subsidy reduction per era: **45%**;
- retained subsidy per era: **55%**;
- target era duration: **6 calendar years**;
- issuance shape: **finite geometric decline**;
- perpetual tail inflation: **none**;
- premine / treasury / administrative mint: **none**.

Compact rule:

`R(0) = 10 FAE` and `R(n+1) = floor(R(n) × 55 / 100)` in consensus base units. The monetary ceiling is **14,026,000 FAE**. The final block-count implementation remains to be derived after the final block target is selected.

This decision is authoritative for the **starting reward, monetary ceiling, shape and calendar cadence of future FAE tokenomics**. It does **not** activate economics on the public testnet and does not create mainnet authority.

### Parameters intentionally still open

The following are not frozen by the 2026-10-04 authority decision:

- final block target: **not yet frozen**; 300 seconds remains the current research incumbent;
- exact era block count: **not yet frozen**;
- coinbase maturity: **not yet frozen by this tokenomics decision**;
- fee/security-budget model: **still unresolved**;
- activation height: **not selected**.

The six-year rule is a **calendar-economic intent**. Final consensus must translate it into a deterministic integer block interval only after the final target block time is selected. A later block-time change must not silently stretch or compress the six-year issuance cadence.

### Current derived alignment scenario

The following is derived evidence, not a block-time activation decision.

With the authoritative **10 FAE/block** starting reward, **14,026,000 FAE** hard monetary ceiling, six-year era intent and 55% reward retention:

- a strict 6.000-year reference at 300 seconds gives **631,152 blocks/era** and atom-exact scheduled issuance of **14,025,599.85343248 FAE**, leaving **400.14656752 FAE** permanently unissued below the ceiling;
- the largest constant integer era length at the 300-second candidate that remains below the authoritative ceiling is **631,170 blocks/era**;
- that cap-aligned candidate schedules **14,025,999.85342830 FAE**, leaving only **0.14657170 FAE** permanently unissued;
- at 300 seconds, 631,170 blocks correspond to approximately **6.000171 years**;
- conversely, making 631,170 blocks equal exactly six reference years implies approximately **299.99144446 seconds/block**.

This is why the new economics strongly align with the existing ~300-second block-time research incumbent without silently making 300 seconds authoritative.

The authoritative hard ceiling is **14,026,000 FAE**. Atom-flooring is allowed to leave a small permanently unissued remainder below that ceiling; the schedule must never exceed it.

### Supersession

The prior future-economic package:

- 14 FAE/block;
- 430,000-block 50% halvings;
- approximately 4.09-year eras;
- ~12.04M FAE theoretical supply;

is now **superseded as the preferred future tokenomics package**. Historical artifacts that studied that package remain frozen evidence and must not be rewritten.

The 300-second block-time research itself is not superseded by this tokenomics decision; block-time remains a separate parameter frontier.

The 5-year / -45% candidate is:

`CLOSED_AS_PRIMARY__SENSITIVITY_CHALLENGER_ONLY`

Primary authority/evidence references:

- `docs/FAE_TOKENOMICS_AUTHORITY_20261004.json`
- `docs/FAE_TOKENOMICS_MANIFESTO_NOTES.md`
- `docs/research/FAE_ISSUANCE_ERA_FINAL_RUN_20261004.json`
- `docs/research/FAE_ISSUANCE_ERA_FINAL_VERDICT_20261004.md`
- `lab/economics/issuance-era-final-comparison.mjs`

Authority status:

- tokenomics design authority: **YES — 10 FAE initial reward / 14,026,000 FAE ceiling / 6 years / -45%**;
- active public-testnet consensus changed: **false**;
- economics activated: **false**;
- activation height selected: **false**;
- mainnet launch authorized: **false**.

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

`SCHEDULED / PREPARED_NOT_STARTED`

Operational checkpoint:

`2026-10-01`

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
- representative-device evidence: unresolved; readiness package is `REPRESENTATIVE_DEVICE_EVIDENCE_PACKAGE_READY`
- operational soak: unresolved; no PASS should be inferred from elapsed time or a partial run
- independent-operator evidence: unresolved

A fresh operational soak may be admitted only after its complete frozen window and predefined gates are satisfied. Do not convert a partial or interrupted run into PASS.

## Representative Device Evidence Readiness

Current readiness state:

`DONE / REPRESENTATIVE_DEVICE_EVIDENCE_PACKAGE_READY`

The software-only preparation for future representative-device physical evidence is complete. The frozen package defines representative-device eligibility, pre-result selection locking, a four-class coverage contract, controlled physical workloads, environment/performance/energy/thermal schemas, a single-capture normalization path, checksummed evidence bundles, deterministic run/portfolio verifiers, adversarial false-PASS tests and a four-class synthetic clean-room rehearsal.

The rehearsal passed only as `READINESS_REHEARSAL_ONLY`. It is explicitly not physical evidence and cannot satisfy the external gate.

Representative Device Evidence therefore remains:

`EXTERNAL_EVIDENCE / NOT_OBTAINED`

The required initial physical portfolio covers:

- mobile/tablet ARM;
- thin-and-light integrated compute;
- consumer discrete GPU;
- compact/handheld consumer hardware.

At least two ISA families and three form factors must be represented. Actual models must be selected and locked before any FAE result for those devices is observed. Historical measurements, MTS-12 iPad evidence and ASIC/F2 evidence are not retroactively promoted into this gate.

Primary references:

- `lab/representative-device-evidence-readiness/acceptance-contract.json`
- `lab/representative-device-evidence-readiness/README.md`
- `docs/FAE_REPRESENTATIVE_DEVICE_EVIDENCE_READINESS_BUILD_COLONY_RUN.json`
- `docs/FAE_REPRESENTATIVE_DEVICE_EVIDENCE_READINESS_CLOSURE.json`
- `.github/workflows/representative-device-evidence-readiness.yml`

## Representative Device Physical Autopilot

Current software execution-kit state:

`DONE / REPRESENTATIVE_DEVICE_PHYSICAL_AUTOPILOT_READY`

The machine-side execution layer for the frozen Representative Device Evidence contract is complete. It provides:

- a shared browser harness for physical-device PoW and evidence capture;
- a zero-dependency Node.js localhost controller for Mac, Windows/Linux consumer-GPU machines and Steam Deck-class devices;
- pre-result device selection locking bound to the live v4 tip;
- full-duration sustained-mining and normal-use coexistence scheduling;
- genuine browser lifecycle recording with no synthetic lifecycle credit;
- optional local thermal/device telemetry;
- automatic capture → staging → evidence bundle → deterministic verifier processing;
- browser-only export/import for iPad/no-install devices;
- one-command local physical autostart and one-tap URL autostart with fail-closed public-address requirements;
- a public no-login browser harness at `https://fae-rde-physical-autopilot-1lztsf.v2.appdeploy.ai/`.

The public environment completed a zero-click end-to-end `REHEARSAL_ONLY` campaign with six captures. That result validates orchestration only and carries **no** physical-evidence authority.

The remaining work is genuinely physical/external:

- real runs on the preselected required devices;
- five genuine hidden → visible lifecycle cycles on classes for which the frozen RDE contract requires them;
- optional wall-power evidence only when a real/machine-readable source exists;
- final external admission of the complete four-class portfolio.

Representative-device physical evidence therefore remains `EXTERNAL_EVIDENCE / NOT_OBTAINED`.

Primary references:

- `lab/representative-device-physical-autopilot/protocol.json`
- `lab/representative-device-physical-autopilot/execution-kit.json`
- `lab/representative-device-physical-autopilot/README.md`
- `docs/FAE_REPRESENTATIVE_DEVICE_PHYSICAL_AUTOPILOT_BUILD_COLONY_RUN.json`
- `docs/FAE_REPRESENTATIVE_DEVICE_PHYSICAL_AUTOPILOT_CLOSURE.json`
- `.github/workflows/representative-device-physical-autopilot.yml`

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
- BE-06 Oracle pre-create/host-creation envelope: admitted for the exact zero-cost-only request and explicitly authorized within that envelope;
- Oracle persistent host: not yet established in accepted evidence;
- current readiness classification: `HUMAN_GATE / EXTERNAL-INFRA BLOCKED`, because the next admissible Explorer advance requires the account-bound persistent-host creation step;
- no paid fallback, Explorer LIVE claim, consensus authority, wallet authority, mining authority, or Stability Soak capacity transfer follows from BE-06.

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

## Wallet Transaction UX

Current state:

`DONE / PUBLICATION_VERIFIED`

Evidence:

- `docs/wallet-transaction-ux/contract.json`
- `docs/wallet-transaction-ux/wtx-07-publication-evidence.json`
- publication-evidence merge checkpoint: `48ba1df01075f7e6714d2e98d5ce8df827d1e5f2`

The publication receipt records successful canonical verification, cross-Lab verification, recurring security assurance, CodeQL, a READY production deployment, and exact served-file matching for the integrated Wallet Transaction UX. This closes the bounded TXID visibility/copyability + transaction-history discoverability workstream. It does not create Explorer, consensus, backend, key-material, or mainnet authority.

## ASIC resistance / F2 external state

The ASIC/F2 workstream is not integrated into current FAE `main`; its evidence remains Lab/Durable state and must not be represented as canonical protocol completion.

Latest reconciled external state observed on 2026-09-28:

- A3-R4 physical implementation: `PASS_PHYSICAL_TIMING_CLOSED` on Lab branch evidence;
- an existing A3-R4 AFI, `afi-0bd37117433ff02d7`, was subsequently observed `available`;
- General Execution contains a narrow Waterfound authority receipt admitting that already-existing AFI only while it remains bound to the verified A3-R4 source/Developer_CL identity;
- that receipt explicitly does **not** authorize F2 runtime execution, benchmark, attacker sweep, sustained validation, release, consensus activation, or mainnet.

Current readiness classification:

`HUMAN_GATE`

The next admissible F2 runtime action therefore requires a new exact authority grant. Do not create another AFI or infer completion from AFI availability.

External references:

- `Waterfound/FAE-testnet@d1d98251dc2c58d53a843d5f04c2fc8ff3af0d4d`
- `Waterfound/General-Execution:authority/fae-asic-a3-r4-existing-afi-authority-resume-001.json`
- `Waterfound/General-Execution:provider-inbox/fae-a3-r4-afi-available-001.json`

## Mining Tip Sync / stale-work recovery

The software and real-browser frontiers have advanced materially, but MTS-12 remains a physical-device gate.

Current state:

`HUMAN_GATE`

The latest physical iPad evidence preserved on `main` records:

- the real-tip convergence gate passed;
- zero known-mismatch submissions, zero race-lost 409 responses, zero unclassified stale responses, and no manual restart in that run;
- the background/foreground metric from that attempt was invalid for a runtime correctness verdict because it measured a Lab-issued request-completion path rather than the production miner foreground-event-to-request-start latency;
- no miner defect was proven and no runtime write was authorized.

A corrected physical iPad/Safari lifecycle run is still required before MTS-12 can become GREEN.

Primary references:

- `lab/mining-tip-sync/authority.json`
- `lab/mining-tip-sync/evidence/mts-12-physical-attempt-003.json`
- `lab/mining-tip-sync/evidence/mts-12-prep.json`

## Security and post-quantum research

Public-code security baseline:

`CLOSED / BASELINE_READY_FOR_RECURRING_ASSURANCE`

The bounded Public-Code Security Readiness project reached its PSR-19 closeout with zero open baseline blockers and recurring Project Assurance as the continuing mechanism. This is a security-baseline claim only and grants no release, consensus, economics, deployment, or mainnet authority.

Primary references:

- `docs/security/FAE_PSR18_PUBLIC_CODE_SECURITY_VERDICT_V1.json`
- `docs/security/FAE_PSR19_BOUNDED_PROJECT_CLOSEOUT_V1.json`

Post-Quantum Signature Lab:

`RESEARCH_ONLY / SOFTWARE_ONLY_POST_QUANTUM_RESEARCH_CEILING_REACHED`

PQ-00 through PQ-11 are GREEN inside the frozen shadow-only authority boundary. PQ-12 physical-device evidence is optional for that software-only ceiling. No PQ parameter set is selected for active FAE and activation remains unauthorized.

Primary references:

- `lab/post-quantum-signatures/gate-status.json`
- `lab/post-quantum-signatures/authority.json`

## Sovereignty, recovery and release provenance

Accepted software/evidence state includes:

- Git-host independence recovery proof integrated at `a9ae1980206c8b0d73cd391c4a970b76b70336e0`;
- GitLab sovereign backup-control tooling integrated at `51579c98073f1193da2c69f50cdfea0d26116fbb`;
- PSR-13 reproducible release provenance integrated at `a0be46e22e5ecf3400922f9fa3f267c35bd46916`;
- H2 release reproducibility: GREEN, packaging-only;
- H2 mainnet rehearsal package: GREEN, rehearsal-only;
- H2 independent release/mainnet verifier: GREEN, verification-only.

These are capability/evidence completions, not proof that a particular external mirror is currently synchronized and not a production release freeze. Final production release identities remain unset under the production-freeze section above.

## Independent Operator Readiness

Current readiness state:

`DONE / INDEPENDENT_OPERATOR_EVIDENCE_PACKAGE_READY`

The software-only preparation for a future independent-operator proof is complete. The frozen package includes the independent-operator definition and acceptance contract, clean-room bootstrap procedure, source/release provenance binding, signed network/genesis identity evidence, authenticated-peer and tip observations, controlled restart/recovery evidence, a checksummed machine-readable bundle, a deterministic fail-closed verifier, adversarial false-PASS tests, and self-contained operator instructions.

The real-process clean-room rehearsal passed as `READINESS_REHEARSAL_ONLY`. It is explicitly **not** independent-operator evidence and cannot satisfy the external gate.

Independent Operator Evidence therefore remains:

`EXTERNAL_EVIDENCE / NOT_OBTAINED`

The next admissible step is IOR-X: an eligible real independent operator executes the frozen package using operator-controlled resources and returns provenance-bound evidence. No result in this readiness closure changes consensus, economics, activation height, production bootstrap values, mainnet readiness, or mainnet authorization.

Primary references:

- `lab/independent-operator-readiness/acceptance-contract.json`
- `lab/independent-operator-readiness/README.md`
- `docs/FAE_INDEPENDENT_OPERATOR_READINESS_BUILD_COLONY_RUN.json`
- `docs/FAE_INDEPENDENT_OPERATOR_READINESS_CLOSURE.json`
- `.github/workflows/independent-operator-readiness.yml`

## Mainnet-readiness unresolved evidence

The machine-readable readiness registry preserves the distinction between completed software/evidence gates and unresolved external or authority gates.

Still unresolved as mainnet evidence include:

- physical HFB / work-per-watt / work-per-dollar evidence;
- representative-device evidence;
- Stability Soak V3 operational completion;
- independent-operator evidence;
- Explorer independent persistent-host binding;
- ASIC/F2 runtime and downstream attacker/sustained evidence;
- MTS-12 corrected physical-device evidence;
- all final production-freeze values and explicit launch authority.

Peer Isolation & Eclipse Resistance should **not** be grouped into this generic unresolved bucket: real-WAN Gate 3 was integrated as evidence at `946bfc8b0baae2a50f960a4ca63756c08fdef319`.

Difficulty + Timestamp II should likewise be represented as completed Lab/candidate evidence at `e3e66f2ca43a4ff071a538cbeae6b9ddc68dc510`, while the active-v4 180s DAA question remains separately owned by the active 180s Research workstream.

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
