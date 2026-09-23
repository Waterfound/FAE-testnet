# FAE – Block Explorer Lab

Status: **BE-06 — PRE-CREATE GUARD INTEGRATED / ORACLE ACCOUNT EVIDENCE REQUIRED**

The Block Explorer is a separate read-only application in the FAE ecosystem.

> **Explorer observes FAE; it never authorizes FAE.**

## BE-01 objective

Freeze the smallest correct public read model before any Explorer UI or node-query implementation is written.

BE-01 is contract-only. It does **not** modify the wallet/mining frontend, Independent Node runtime, Supabase runtime, consensus, economics, deployment, or public testnet.

## Source binding

FAE source revision: `c9ca448b5d14b098d761d8e4f89268ab591d9de2`

Build Colony revision: `17979869a85c9f5adf2cef2ceb589a07fcef6239`

The active network remains `fairyelf-public-testnet-v4`: 180-second target, 10 FAE initial subsidy, 600,000-block halving era, 12,000,000 FAE maximum supply. The preferred 300s/14 FAE research candidate is not live authority.

## Read-model boundary

The contract in `read-model-v1.json` defines:

- network status and issued supply;
- block lookup by height/hash;
- transaction lookup by TXID;
- address balance plus **transfer and reward** events;
- universal search;
- tip-bound confirmation semantics;
- reorg-safe selected-chain semantics;
- fail-closed provenance/network behavior.

A 64-hex digest is intentionally ambiguous between block hash and TXID until both namespaces are queried.

## Reward semantics

The active testnet has `PPLNS_COINBASE_ACTIVATION_HEIGHT = null`. BE-01 therefore describes the current direct reward correctly while keeping the read model forward-compatible with validated `coinbase_outputs` if a future authoritative activation occurs.

The Explorer must never present a future candidate capability as live merely because support code exists.

## Index/cache decision

BE-01 authorizes **no Explorer database/indexer**.

The initial architecture is:

```text
independently validated FAE node state
    -> read-only Explorer query surface
    -> Explorer application
```

Any future cache/index must be derived disposable state and rebuildable from validated data.

## Deletion invariant

Deleting this Lab and its Lab-only workflow must have zero effect on active FAE wallet, mining, consensus, economics, node operation, or public-testnet survival.

## Exit gate

BE-01 is GREEN only if:

1. authority and read-model JSON validate;
2. the contract matches the bound active network constants;
3. PPLNS is not falsely marked live;
4. only read methods are authorized;
5. no secret/signing/mining/consensus authority enters the Explorer;
6. branch changes remain inside the BE-01 authorized write scope.

Passing BE-01 authorizes planning/execution of **BE-02 — Independent Node Explorer Query Surface**. It does not itself authorize those runtime writes.

## BE-01 verification

The exact contract candidate passed the dedicated Block Explorer Lab workflow, the canonical-source suite, CodeQL, recurring public-code assurance, and the pre-integration cross-Lab gate. BE-02 remains unauthorized until this contract is integrated into canonical `main` and the Block Explorer is registered in the cross-Lab combined verification set.

## BE-02 implementation boundary

BE-02 adds a read-only `/explorer/*` namespace to the Independent Node. Each query clones the current independently validated node state and derives its response from that coherent snapshot.

Implemented surface:

- `/explorer/status`;
- `/explorer/blocks`;
- `/explorer/block` by height or hash;
- `/explorer/transaction` by TXID;
- `/explorer/address` with transfer + reward events;
- `/explorer/search` with address, height and dual block-hash/TXID digest resolution.

Address cursors are bound to the observed tip hash. A tip change invalidates the old cursor with `tip_changed_retry`; the Explorer never tries to reconcile or choose a chain itself.

BE-02 does not add an indexer, database, cache authority, transaction submission, wallet operation, mining operation, or consensus rule.

## BE-02 verification result

The bounded BE-02 candidate passed the dedicated Explorer tests, real HTTP integration, Independent Node hardening, canonical-source verification, recurring Project Assurance, CodeQL, and pre-integration cross-Lab verification. Runtime write authority is now frozen. The remaining step is serialized integration into canonical `main` followed by exact combined-main verification.


## BE-03 application boundary

BE-03 creates the first standalone FAE Explorer application under `explorer/`.

The application is deliberately static and dependency-light:

```text
Independent Node validated state
    -> /explorer/* GET surface
    -> explorer/api-client.mjs
    -> explorer/app.mjs
    -> explorer/index.html
```

It does not import the Wallet/Mining site, access keys, sign or submit transactions, control mining, change the node, or create an Explorer database.

Implemented application behavior:

- visible **Read-only** and public-testnet identity;
- network status and core metrics;
- latest-block list;
- universal search;
- block detail;
- transaction detail;
- address balance/activity including reward and transfer events;
- tip-bound address pagination;
- hash routing requiring no server rewrite authority;
- fail-closed network identity and observed-tip validation;
- DOM rendering via `textContent`, not `innerHTML`.

`explorer/config.json` remains `deployment_state: NOT_LIVE` and points to a local development node by default. BE-03 does not authorize a public deployment.

## BE-03 verification result

The exact source candidate `fb643eb847a3c40aeb190e04b525d8b31987070d` passed:

- BE-03 application tests: **12/12**;
- BE-02 regression: **11/11**;
- BE-01 regression: **6/6**;
- Block Explorer boundary guard;
- cross-Lab pre-integration verification;
- recurring public-code assurance;
- CodeQL;
- canonical-source suite: **40/40 substantive gates**.

Application writes are now frozen. Integration into canonical `main` and exact combined-main verification are required before BE-04 or any deployment frontier can advance.


## BE-04 closeout

BE-04 reached the evidence ceiling available without allocating new persistent node infrastructure.

Verified public frontend:

- URL: `https://fae-block-explorer-e2z4q3.v2.appdeploy.ai/`;
- deployment state: `PUBLIC_PREBIND`;
- binding state: `UNBOUND`;
- hosted `api_base`: `null`;
- read-only: `true`;
- hosted snapshot version: `1789777122012`;
- published Explorer source revision: `eabddc8db3f79f4ac6a7544316809f3d879954fe`;
- provider QA: clean, with no reported frontend, network, or backend errors.

The public frontend is intentionally unable to query chain data until an eligible persistent HTTPS Independent Node is proven and bound.

The HTTPS node binding remains externally blocked because no eligible persistent node is currently available without consuming or weakening separate infrastructure evidence envelopes. This is not a software failure and does not authorize substituting an audit service, raw feed, cache, Wallet/Mining host, or hosting provider as FAE authority.

Therefore:

```text
BE-04 public frontend = VERIFIED
BE-04 HTTPS node binding = BLOCKED_PENDING_ELIGIBLE_PERSISTENT_NODE
Explorer LIVE = NOT_LIVE
```

No further BE-04 source work is justified until eligible node-hosting evidence changes.


## BE-05 software integration closeout

BE-05 tested whether the public Explorer could be bound to an already-existing eligible persistent Independent Node without consuming another workstream's infrastructure or inventing new spend authority.

Read-only provider discovery found no eligible existing host across the connected Render, Vercel, AppDeploy, DigitalOcean, AWS EC2, or accessible AWS Lightsail inventory. Render services remain suspended by billing and the Stability Soak V3 capacity remains protected. The only EC2 instances observed were terminated ASIC-F2 resources and are explicitly excluded from Explorer use.

The provider-neutral runtime boundary is now integrated into canonical `main`:

```text
candidate feeds / configured peers
    -> private-loopback FAE Independent Node
    -> BE-05 read-only gateway
    -> provider HTTPS termination
    -> public FAE Explorer
```

Integrated artifacts:

- `be05-provider-scan.json` — evidence that no existing eligible host was found;
- `be05-node-deployment-v1.json` — persistent runtime, durable-state, HTTPS and isolation contract;
- `be05-readonly-gateway.mjs` — exact allowlist for the six `/explorer/*` resources, GET/OPTIONS only, node loopback only;
- `be05-binding-probe.mjs` — executable HTTPS/network/tip/CORS/mutation-isolation acceptance probe;
- BE-05 contract, gateway and probe tests.

The Explorer remains `PUBLIC_PREBIND / UNBOUND`. No node was created, restarted, repurposed or billed by BE-05, and no public binding occurred.

The integrated revision `0561c96772a4d2faaf761777537eabe63febc737` passed exact post-merge verification across the Block Explorer Lab, cross-Lab integration gate, PSR-15 Project Assurance, recurring public-code assurance, CodeQL, and the canonical-source suite (40/40 substantive gates).

```text
BE-05 software package = COMBINED_MAIN_VERIFIED
integrated main = 0561c96772a4d2faaf761777537eabe63febc737
eligible persistent HTTPS host = NOT FOUND
deployment/binding authority = CLOSED
Explorer LIVE = NOT_LIVE
```

The next change in this boundary requires external evidence: either an eligible existing host appears, or a separately bounded authorization is granted to create one. Source-only work beyond this point would be return-decreasing and cannot manufacture deployment evidence.


## BE-06 preprovision closeout

BE-06 converted the BE-05 external-host blocker into an explicit zero-cost host acquisition gate without creating infrastructure.

Integrated at `e11679cce8697aeeecc89d78454adb123acef563`:

- provider-neutral host hardening contract;
- fail-closed host preflight;
- public-program eligibility evidence for Oracle Cloud and Google Cloud;
- BE-06 regression coverage.

Fresh read-only state evidence on 2026-09-23 observed **496 blocks, 35 transactions and 564 UTXOs** in the active FAE v4 Supabase tables. The corresponding PostgreSQL tuple footprint for blocks + transactions + UTXOs was **478,817 bytes**. This is not a process-RSS measurement, but it shows that current chain-data volume is not the dominant 1 GiB-host risk.

Provider disposition changed from the original public-doc ordering:

- **Google Cloud is the next probe**: the documented Free Tier provides one non-preemptible e2-micro VM in eligible US regions, but account eligibility, 1 GiB runtime headroom and fail-closed egress still require evidence.
- **Oracle Cloud remains a fallback candidate**: its Always Free capacity is materially larger, but Oracle explicitly documents idle-compute reclamation. BE-06 will not manufacture load merely to avoid reclamation; recovery/persistence must be proven honestly.

Therefore:

```text
BE-06 preprovision software = INTEGRATED
current-testnet footprint evidence = GREEN / READ-ONLY
eligible persistent host = NOT YET PROVEN
host provisioning authority = CLOSED
Explorer binding authority = CLOSED
Explorer LIVE = NOT_LIVE
```

The next valid transition requires account-specific zero-cost evidence and runtime/provider-risk acceptance. Source-only work cannot substitute for that external evidence.


## BE-06 pre-create guard closeout

The zero-cost provider pre-create safety boundary is now integrated into canonical `main` at `f4d47149f0b089f89754b2a2766b1f868da998e0`.

Integrated artifacts:

- `be06-provider-precreate-policy-v1.json` — provider-specific Oracle/Google admission contract;
- `be06-provider-precreate-guard.mjs` — fail-closed executable guard;
- `be-06-precreate-guard.test.mjs` — positive and adversarial fixtures;
- dedicated Block Explorer workflow coverage.

The guard deliberately distinguishes **safe to request creation authority** from **resource creation authorized** and from **persistent host eligible**. A passing configuration still creates nothing.

Exact integrated revision `f4d47149f0b089f89754b2a2766b1f868da998e0` passed:

- Block Explorer Lab: run `35861061648`;
- cross-Lab integration: run `35861061874`;
- recurring public-code assurance: run `35861061634`;
- CodeQL: run `35861061793`;
- canonical-source verification: run `35861061815`.

Current provider order is Oracle Cloud first, Google Cloud fallback. Oracle's larger Always Free envelope is compatible with the intended host, but account/home-region/quota/capacity evidence is still missing and the documented idle-reclamation condition must be handled by honest real-workload observation rather than synthetic load. Google remains a fallback because ordinary VM external IPv4 is billable under current pricing; an IPv6-only zero-cost path would require separate reachability/TLS/egress evidence.

```text
BE-06 hardening = INTEGRATED
BE-06 provider evidence model = INTEGRATED
BE-06 zero-cost pre-create guard = INTEGRATED + EXACT-MAIN VERIFIED
eligible persistent host = NOT YET PROVEN
host creation authority = CLOSED
spend authority = CLOSED
Explorer = PUBLIC_PREBIND / UNBOUND
Explorer LIVE = NOT_LIVE
```

At this point additional source-only work is return-decreasing. The next BE-06 evidence must come from the Oracle account itself. If that evidence passes the guard, a separate bounded authorization is still required before creating the candidate host.


### OCI estimator tier-pricing semantics

During account-specific BE-06 dry-run evidence collection, the OCI Console showed a monthly estimate of **R$10.45 for the boot volume** even though the tenancy had **200 GB Free Tier Block Volume available**, usage 0, the candidate boot volume was the default ~46.6 GB, and the resource remained in the GRU home region. Oracle's billing documentation states that Console estimates use the organization's rate card and **do not include tier unit pricing when applicable**. Therefore BE-06 must not require the raw estimator to display zero. It instead requires exact entitlement evidence for every nonzero estimate line. For this candidate the only nonzero line was boot volume, independently proven within the 200 GB Always Free entitlement. Resource creation remains separately unauthorized.
