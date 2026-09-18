# FAE – Block Explorer Lab

Status: **BE-01 — LAB_VERIFIED / integration candidate**

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
