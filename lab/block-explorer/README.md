# FAE – Block Explorer Lab

Status: **BE-04 — PUBLIC_PREBIND VERIFIED / HTTPS node binding blocked**

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
