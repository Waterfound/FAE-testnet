# FAE — Sovereign Standalone Mining
## Security and No-Secret Review

Reviewed executable candidate: `305e4ff670649b6c86dafc2bde7d3a74a63c0172`  
Disposition: **PASS within Element 58 authority**

## Trust boundary

The standalone miner is a miner, not a full validating node or Wallet.

It trusts the **selected node** for current template/tip state, while locally validating the template shape, reward-address binding, transaction commitment and Proof-of-Work calculation before submission. An operator who wants node sovereignty can point the miner at their own independent FAE node.

This preserves:

```text
Browser != Miner != Wallet != Node
```

## Secret-material review

The CLI has no parameter for:
- seed phrase or mnemonic;
- private key;
- recovery phrase;
- wallet passphrase;
- vault material;
- signing authority.

Persisted configuration uses an explicit allow-list containing only:
- selected node endpoint;
- public reward address;
- hash chunk size;
- tip-poll cadence;
- reconnect bounds;
- rate-report cadence;
- optional cooperative CPU yield.

Unknown config fields are rejected. Secret-bearing field names are rejected. Saved config is written with restrictive mode `0600` where the platform honors POSIX modes.

Result: **no spending authority is required or persisted.**

## Endpoint review

- Node credentials embedded in URLs are rejected.
- Query/hash material in the configured base endpoint is rejected.
- Remote endpoints require HTTPS.
- Plain HTTP is permitted only for loopback/localhost operation.
- Node 5xx responses are treated as temporary unavailability and enter bounded reconnect.
- Non-stale protocol rejection is not silently retried as success.

## Template/work review

Before mining, the standalone core validates:
- active network identity;
- exact reward-address binding;
- height;
- previous hash shape;
- timestamp integer shape;
- target/difficulty representation;
- reward integer representation;
- transaction ID list, uniqueness and size;
- transaction count;
- transaction-root commitment.

Proof of Work:
- canonical object serialization;
- double SHA-256;
- nonce bound into the header object;
- leading-zero-bit target interpretation;
- locally recomputed hash before submission.

Before submit, the miner checks the selected node's current `height + tip_hash` again. Stale or unprovable freshness causes work replacement instead of a current-work submission.

## Operational review

The hashing loop is cooperative and bounded by chunks, allowing:
- SIGINT/SIGTERM handling;
- periodic authoritative tip checks;
- hashrate observability;
- optional utilization throttling with `--yield-ms`.

Process restart does not trust prior in-memory work. It reacquires current node status and a fresh template.

## Cross-implementation parity

Tests independently compute the same mining digest with:
- Node `createHash`;
- WebCrypto `subtle.digest`;
- the standalone mining core.

They also compare leading-zero interpretation and submission construction.

The protected browser/Forge source was not modified, and its repository hash checks remained green.

## Residual boundary

A malicious or incorrect selected node can provide a chain/template view that differs from another node. The miner intentionally does not duplicate full-node chain validation; doing so would collapse Miner and Node into one component and expand Element 58 into a node redesign.

Mitigation is architectural and explicit: choose a trusted node or operate an independent node.

No residual finding in this review requires consensus, Wallet, infrastructure, or algorithm changes.
