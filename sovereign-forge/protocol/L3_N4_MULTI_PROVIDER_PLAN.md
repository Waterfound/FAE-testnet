# FAE v5 300s — N4 Multi-Provider Candidate Validation Plan

Status: **portable provider package GREEN / external N4 execution pending / NOT active consensus**

Purpose: close provider/failure-domain uncertainty after N2 one-machine scale and N3 geographic WAN evidence, without falsely claiming independent-operator evidence.

## Evidence target

N4 means the same v5 300s candidate protocol is exercised across **at least two infrastructure providers** under one operator. It must remain distinct from N5, which requires genuinely independent operators.

Preferred topology:

- **4 candidate nodes**;
- **2 infrastructure providers**;
- at least **3 geographic regions**;
- no shared process memory or filesystem;
- public HTTPS-reachable peer endpoints;
- identical candidate code commit and candidate profile identity;
- one controller may coordinate the experiment, but consensus state remains inside the individual nodes.

A minimum 3-node / 2-provider topology may be used for a preliminary pass, but the 2+2 provider layout is preferred because it permits a clean provider-vs-provider partition.

## Provider-portable package

The candidate branch now contains a provider-neutral N4 runtime package:

- `candidate-net-lab/n4-runtime-config.mjs` — fail-closed external runtime validation;
- `candidate-net-lab/n4-entrypoint.mjs` — non-activating provider entrypoint;
- `candidate-net-lab/Dockerfile.n4` — portable Node 22 container packaging the candidate core;
- `sovereign-forge/tests/n4-runtime-config.mjs` — rejects missing/weak local defaults and non-HTTPS public endpoints.

The N4 entrypoint requires an explicit provider node id, region, public HTTPS URL and a non-default runtime token. Secrets are never committed into the repository. The package always reports `activationAuthorized=false` and `publicConsensusChanged=false`.

Dedicated candidate CI run **34733289841** successfully built the N4 container and passed the runtime fail-closed invariants together with the complete profile-bound L3 suite. Therefore **provider portability is GREEN**; actual cross-provider evidence is still pending.

## Required external gates

1. **Identity gate** — all nodes report the same candidate network/profile/genesis identity and remain non-activating.
2. **Cross-provider propagation gate** — blocks produced on each provider are accepted by nodes on the other provider.
3. **Provider partition gate** — provider A and provider B are isolated and build separate branches.
4. **Equal-work policy gate** — equal-work branches are not replaced arbitrarily during controlled reconciliation.
5. **Higher-work convergence gate** — once one branch becomes higher-work, all reachable nodes converge deterministically.
6. **Provider-loss gate** — all nodes on one provider are unavailable; the surviving provider remains internally consistent.
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

## Current execution boundary

N2 already proves materially larger node/process/topology scale on one machine, and N3 already supplies real geographic WAN propagation evidence. The missing N4 fact is **a second independently hosted infrastructure failure domain running the candidate node**.

The portable image is now ready to place on such a provider. Provisioning a VM without a supported way to deploy/run the container would create cost without evidence, so infrastructure should only be created when the connected provider path can actually launch this image and expose its HTTPS endpoint.

Once a second provider runtime is available, the efficient topology is two nodes on the existing provider side and two nodes on the second provider, followed by the ten gates above. There is no value in reproducing the full 16-node N2 count across providers.

## Boundary to N5

N5 cannot be produced by spawning more services under the same operator. It requires at least one genuinely separate human/operator to deploy, configure and maintain a node independently. N5 therefore remains the genuine external ceiling even after N4 passes.
