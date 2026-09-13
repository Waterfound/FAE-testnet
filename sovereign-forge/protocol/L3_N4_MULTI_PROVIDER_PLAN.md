# FAE v5 300s — N4 Multi-Provider Candidate Validation Plan

Status: **prepared external gate / NOT active consensus**

Purpose: close provider/failure-domain uncertainty after N2 one-machine scale and N3 geographic WAN evidence, without falsely claiming independent-operator evidence.

## Evidence target

N4 means the same v5 300s candidate protocol is exercised across **at least two infrastructure providers** under one operator. It must remain distinct from N5, which requires genuinely independent operators.

Preferred topology:

- **4 candidate nodes**;
- **2 infrastructure providers**;
- at least **3 geographic regions**;
- no shared process memory or filesystem;
- public HTTPS or TCP-reachable peer endpoints;
- identical candidate code commit and candidate profile identity;
- one controller may coordinate the experiment, but consensus state remains inside the individual nodes.

A minimum 3-node / 2-provider topology may be used for a preliminary pass, but the 2+2 provider layout is preferred because it permits a clean provider-vs-provider partition.

## Required gates

1. **Identity gate** — all nodes report the same candidate network/profile/genesis identity and remain non-activating.
2. **Cross-provider propagation gate** — blocks produced on each provider are accepted by nodes on the other provider.
3. **Provider partition gate** — provider A and provider B are isolated and build separate branches.
4. **Equal-work policy gate** — equal-work branches are not replaced arbitrarily during controlled reconciliation.
5. **Higher-work convergence gate** — once one branch becomes higher-work, all reachable nodes converge deterministically.
6. **Provider-loss gate** — all nodes on one provider are made unavailable; the surviving provider remains internally consistent.
7. **Cold restart/catch-up gate** — at least one node returns from clean state and reconstructs the winning chain from remote peers.
8. **Maturity/reorg gate** — a transaction crossing the 200-block coinbase maturity boundary remains correct across provider partition/reorg.
9. **Profile-boundary gate** — peers with mismatched profile/genesis identity are rejected.
10. **Activation boundary** — the final report must still show `activationAuthorized=false` and `publicConsensusChanged=false`.

## Evidence classification

A successful run may assert:

- `multiProviderEvidence=true`;
- `providerCount>=2`;
- `geographicRegionCount>=3` when achieved;
- `providerFailureDomainExercise=true`;
- `candidateConsensusSemanticsPass=true`.

It must still assert:

- `independentOperatorEvidence=false` unless a genuinely separate operator participated;
- `activationAuthorized=false`;
- `publicConsensusChanged=false`.

## Relationship to the one-machine result

N2 already proves that substantially larger node/process/topology scale can be tested on one machine. N4 is not a replacement for N2 and does not need a very large node count; its value comes from **independent infrastructure failure domains**. The efficient path is therefore to keep N4 small but diverse rather than paying to reproduce 16 nodes across providers.

## Preferred execution shape

Use two existing/temporary nodes on provider A and two temporary nodes on provider B. Run the exact same candidate test profile first. Once the real launch initial target is calibrated, repeat the same N4 protocol with the frozen profile before any activation decision.

No resource creation or paid infrastructure is authorized by this document. Provisioning remains an explicit operational decision.
