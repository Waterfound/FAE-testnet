# FAE — Browser-Coin Design Assurance Review

Status: **candidate assurance record / independently exercised bounded probes**.

This record does not change consensus, DP6, economics/tokenomics, activation height, release authority, deployment authority, or mainnet authority.

## Admission rule

`competitor weakness + corresponding FAE premise + insufficient current FAE coverage/evidence + material consequence = candidate improvement`

A difference from BrowserCoin is not itself a FAE defect.

## Canonical baselines reconstructed

- FAE canonical main at review start: `b00bbebca81a8f1085f7e61beddca862d8b5dfaa`.
- Canonical FAE monetary schedule at that revision: target 180 s, initial subsidy 10 FAE, halving era 600,000 blocks, max supply 12,000,000 FAE. The 300 s / 14 FAE / 430,000-block schedule is research-only and has no activation authority.
- BrowserCoin primary-source revision inspected: `swompythesecond/BrowserCoin@9e060f4822fcff5c3e2993fcd3c94f215b139685`.
- BrowserCoin source at that revision sets 150 s target, 50 BRC initial reward and 210,000-block halving interval; Sandglass v3 uses a 512 KiB scratch buffer with four dependent chains. These are external comparison facts only, not FAE requirements.

## Design Assurance Matrix

| Challenge | Existing FAE owner | Premise | Evidence already present | Residual | Coverage | CII admission | Required action |
|---|---|---|---|---|---|---|---|
| Temporal monetary distribution | Economic Block-Time / monetary consensus research | Issuance cadence must not outrun the opportunity for broad participation | Canonical 180/10/600k schedule; supply cap; economic/decentralization research; future 300/14/430k candidate explicitly research-only | No empirical proof that any particular wall-clock distribution is socially sufficient; this is already the economic research owner's question | EXISTING_FRONTIER_SUFFICIENT | NO_ACTION | No new frontier and no economic change |
| Specialized-hardware resistance | ASIC Lab / DP6 Robust Premise Review | A competent specialized implementation must not gain enough advantage to break participation goals | Real DP6 implementation/parity/memory structure; R3-T1 timing-closed physical build; durable HOLD explicitly says timing closure != specialized bound | Specialized attacker/PPA advantage bound remains unproven | EXISTING_FRONTIER_SUFFICIENT | NO_ACTION | Keep current DP6 owner/HOLD; do not duplicate ASIC work |
| Normal-use/browser lifecycle parity | Representative Device Evidence + Physical Autopilot | Mining must remain usable under normal-use, thermal and lifecycle conditions on representative devices | Frozen 4-class acceptance contract; pure mining, normal-use coexistence, lifecycle recovery, energy/thermal metrics; physical autopilot | Real four-class physical portfolio remains external evidence | EXISTING_FRONTIER_SUFFICIENT | NO_ACTION | Continue existing physical frontier only |
| Wallet origin/key compromise | Persistent Vault + Public Code Security + Release Provenance | For the admitted honest runtime, reviewed send intent must equal signed payload and the tested artifact must bind to delivery; arbitrary same-origin compromise is explicitly outside the claim | At-rest vault hardening; public-code threat model; supply-chain/release provenance; canonical current wallet signing source | Dedicated intent-freeze/substitution regression and delivered-artifact binding were not evidenced as one explicit gate | HARDEN_EXISTING_FRONTIER | HARDEN_EXISTING_FRONTIER | Contract + adversarial regression surface in existing owner; serialize implementation with active Persistent Vault work |
| Long-horizon full-node survivability | Independent Node + Full-target Headers Sync + Mainnet Readiness | Fresh/recovering nodes must remain able to reconstruct and validate state as chain age/storage grow | Headers-first validation, durable state recovery, historical bootstrap tests | Authoritative peer sync has explicit 50,000-block branch ceiling; no authoritative pruning/archival/long-horizon scale contract evidenced | HARDEN_EXISTING_FRONTIER | HARDEN_EXISTING_FRONTIER | Acceptance/scale/recovery evidence first; pruning/archival remains research until semantics are proven |
| Cold-start infrastructure independence | Peer Isolation/Eclipse + Independent Node + Mainnet Readiness | Official infrastructure loss must not eliminate an independently specified fresh-device bootstrap path | Peer authentication/diversity, coordinator-off tests, peer learning, partition/reconnect | Fresh zero-root node has no implicit discovery; production bootstrap requirements/nodes remain unset; no real-WAN official-infra=0 proof | HARDEN_EXISTING_FRONTIER | HARDEN_EXISTING_FRONTIER | Preserve zero-seed control, specify independently controlled bootstrap topology, then obtain real-WAN evidence |
| Protocol-governance survivability | Mainnet Readiness + Activation Boundary + Release Provenance/Verifier | Changes must have explicit authority, deterministic activation compatibility, and survivable procedures for disagreement/emergency cases | Candidate-only activation rules, explicit human authority gates, release provenance, version/policy mismatch fail-closed tests, final production freeze | Review did not locate authoritative evidence for maintainer-disagreement/emergency-change procedure; search incompleteness prevents claiming absence | COVERED_NEEDS_MORE_EVIDENCE | RESEARCH_REQUIRED | Bounded evidence reconstruction only; no new governance system yet |

## CII run

- CII source tree inspected: `1bcac09cc00774a63fc5ffe5a5ee3788d426facf`, v0.0.9.
- advisory packet id: `5e375d532847e9604b92a4ec34f5d0be2d4f029e27b953e6fe2a6031f1b4c197`.
- admitted: wallet integrity hardening, long-horizon hardening, cold-start hardening.
- governance: RESEARCH_REQUIRED.
- new frontiers justified: **0**.

## Build Colony execution

Initial bounded run:
- Build Colony source tree: `17979869a85c9f5adf2cef2ceb589a07fcef6239`.
- run id: `bc2-71a6f1e4cc210352`.
- manifest digest: `30089b7cb741ed570d86123e7687057cb5389e88092bbb4a3cd624b063c5fec8`.
- one parallel wave: wallet integrity, long-horizon survivability, cold-start independence.

Bounded replan after discovering that the existing cross-lab registry did not execute the new probes:
- run id: `bc2-efb3feb55efc4c13`.
- manifest digest: `b20845a38a250e80c654f0a815776933aa16a60529692686e474402b5dcd809d`.
- change: register only the three new probes in the existing cross-lab verifier; no weakening/removal of existing checks.

## Independent verification

PR #267 candidate head `20fdd625a8e5f0ae71ac75937aaf58bc262d3b7e`:

- cross-lab-integration-gate run 254: **PASS**; exact candidate head checked and all registered combined checks executed.
- the added probes therefore executed under GitHub Actions, not merely by the builder.
- this PASS means the contracts/probes are internally valid and current limits are reproducible. It is **not** Mainnet Readiness closure and does not authorize merge/release/deployment.

## Residual disposition

- Wallet: do not create a second wallet implementation. The next implementation step must serialize with the active Persistent Vault owner/PR because it touches the same signing state.
- Long horizon: the 50k ceiling is now an explicit assurance fact. Research/scale evidence should determine whether iterative sync, persistence changes, pruning/archival, or another bounded change is needed; no consensus-observable semantic change is authorized here.
- Cold start: zero-seed behavior is now explicit. A real proof requires independently administered bootstrap roots and later real-WAN evidence; official-infrastructure independence is not claimed yet.
- Governance: evidence reconstruction remains open; absence of a discovered document is not evidence of architectural absence.

## Authority

Builder evidence is not assurer approval. No action in this review authorizes main merge, release, deployment, consensus/DP6/economic change, activation height, production bootstrap selection, new physical/provider run, or mainnet.
