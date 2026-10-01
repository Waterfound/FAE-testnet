# Element 58 — Sovereign Standalone Mining

Status: **PLANNED / NOT STARTED**

Class: **Mainnet-critical product sovereignty capability**

## Purpose

FAE mining must be a protocol/device capability, not a browser-bound feature.

The browser remains the easiest welcome surface, but it must never become required infrastructure for mining.

Canonical product principle:

```
Browser ≠ Miner ≠ Wallet ≠ Node
```

The long-term product must provide a **first-class non-browser mining product** capable of mining directly to a public FAE reward address against a selected FAE node, without requiring a browser Wallet, seed phrase, private key, or browser session.

## Required end state

A user must be able to operate a standalone/headless miner with semantics equivalent to:

```
fae-miner --node <FAE node endpoint> --address <faet1...>
```

or against a local independent node:

```
fae-node
fae-miner --node http://127.0.0.1:8787 --address <faet1...>
```

The exact CLI/API surface is not frozen by this Element. The invariant is the capability.

## Sovereignty invariants

1. Proof of Work executes on the mining device.
2. The miner needs only a valid public reward address to mine.
3. Seed phrases and private keys are not required for mining.
4. A dedicated mining machine may never possess spending keys.
5. The miner can select an independently operated FAE node.
6. The browser is an adapter/welcome surface, not protocol authority.
7. Mining implementation must share consensus semantics with the canonical mining core rather than fork into a browser-only protocol path.
8. Non-browser mining must remain possible if the public browser frontend, Vercel, ChatGPT, Supabase, or any single operator disappears.
9. Mining to an existing address must not silently create a Wallet.
10. No implicit identity creation is required to participate in mining.

## Architectural direction

Preferred decomposition:

```
Canonical Mining Core
├── Browser adapter
├── CLI / headless adapter
└── future native adapter(s)
```

Adapters may differ in product UX and device integration, but must not diverge in consensus-relevant work semantics.

## Existing foundation

Current FAE source already contains:

- a standalone Node.js reference node;
- `GET /template?address=faet1...`;
- `POST /submit-block`;
- independent-node operation;
- browser-side local Proof of Work;
- direct reward-to-address semantics;
- explicit security rule that private keys remain on the user's device and Proof of Work remains on the mining device.

Therefore this Element is not a new consensus design. It is the productization and hardening of an already-supported sovereign architecture.

## Main implementation gaps

The Element is complete only when the project has evidence for, at minimum:

- a first-class standalone/headless miner entry point;
- selectable node endpoint;
- reward-address-only operation;
- no Wallet/private-key dependency;
- canonical parity with browser mining semantics;
- deterministic test vectors / parity tests;
- node failover/reconnect behavior appropriate to the final network model;
- clean shutdown/restart;
- observable hashrate/work-rate and accepted/rejected work;
- durable configuration without secret material;
- platform packaging appropriate to supported general-purpose devices;
- security review proving no custody/signing dependency was introduced;
- documentation sufficient for an independent operator to mine without the browser.

## Relationship to existing Elements

This is a distinct capability because browser-independent mining is a sovereignty property, not merely a browser UX enhancement.

It intersects with:

- **Element 15 — Browser PoW Mining**: the browser remains one mining adapter;
- **Element 24 — Independent Node**: standalone miners must be able to target independent nodes;
- **Element 51 — Mining + Wallet Production UX**: reward-address selection and user-facing mining state must remain coherent across adapters.

The Element must not collapse those responsibilities into one application.

## Explicit non-goals

This Element does not by itself authorize:

- a mining-algorithm change;
- DP6 activation;
- consensus/economic changes;
- custodial mining;
- pool centralization;
- automatic Wallet creation;
- mainnet release or activation.

## Future frontier

Suggested workstream title:

**FAE — Sovereign Standalone Mining**

The workstream should begin only when portfolio capacity is available under the existing Active / Secondary / Passive discipline.

Until then, this Element remains **PLANNED / NOT STARTED** and should not displace currently active mainnet-readiness work.
