# FAE Sovereign Standalone Miner

This directory contains the software-only candidate for **Element 58 — Sovereign Standalone Mining**.

It is intentionally separate from the Wallet and browser UI.

## Security model

Mining needs only:

- a selected FAE node endpoint;
- a public `faet1...` reward address.

It does **not** need a seed phrase, recovery phrase, private key, wallet vault, wallet passphrase, signing authority, browser profile, or browser session.

The miner never creates a Wallet.

## Requirements

- Node.js 22 or newer.
- A reachable FAE node that serves the active public-testnet v4 `/status`, `/template`, and `/submit-block` contract.

## Run directly

Against a local node:

```sh
node standalone/fae-miner.mjs \
  --node http://127.0.0.1:8787 \
  --address faet1...
```

Against a selected remote node:

```sh
node standalone/fae-miner.mjs \
  --node https://node.example \
  --address faet1...
```

Remote plain HTTP is rejected. Loopback HTTP is allowed for one-machine operation.

## Local CLI installation

No package registry or release is required for the candidate:

```sh
npm install -g ./standalone
fae-miner --node http://127.0.0.1:8787 --address faet1...
```

This installs only a local command shim. It does not change protocol authority.

## Secret-free configuration

Configuration is opt-in:

```sh
fae-miner \
  --node https://node.example \
  --address faet1... \
  --save-config ~/.fae/miner.json
```

Then:

```sh
fae-miner --config ~/.fae/miner.json
```

Persisted fields are allow-listed:

- node endpoint;
- public reward address;
- hash chunk size;
- tip polling cadence;
- reconnect bounds;
- hashrate reporting cadence;
- optional cooperative CPU yield.

Unknown fields are rejected. Fields whose names imply seed, mnemonic, private key, passphrase, secret, signing authority, vault, or recovery material are rejected.

## Operational states

The CLI emits reality-grounded states:

- `CONNECTING`
- `TEMPLATE_READY`
- `MINING`
- `WORK_ACCEPTED`
- `WORK_REJECTED`
- `NODE_UNAVAILABLE`
- `RECONNECTING`
- `STOPPED`

Use `--json` for line-delimited machine-readable events.

## Stale work

The miner periodically compares the active template parent to the selected node's authoritative `height + tip_hash`.

Before block submission it revalidates freshness again. If freshness cannot be proven, the old work is not submitted as current work.

## Shutdown and restart

`SIGINT` (Ctrl-C) and `SIGTERM` request a cooperative local stop. The hashing loop yields between bounded chunks so shutdown can be observed without requiring a browser.

Restarting the CLI requests fresh node state and a fresh template; no in-memory mining state is trusted across process restarts.

## CPU behavior

The default miner uses one Node.js process and bounded hash chunks. `--yield-ms` can insert a delay after each chunk when the operator wants to trade hashrate for lower device utilization.

No GPU, accelerator, cloud service, proprietary backend, or specialized hardware is required by this product path.

## Independent-node operation

The canonical reference node lives in `sovereign-forge/node`. Its own README documents node configuration and synchronization.

For deterministic test evidence, the repository verifier starts that node in an isolated local mode, runs this standalone miner against it, accepts a real Proof-of-Work block, and verifies that the block reward is credited to the supplied public reward address.

## Authority boundary

This miner implements the already-active public-testnet v4 mining semantics. It does not select or activate DP6, alter the mining algorithm, change economics, deploy infrastructure, publish a release, or authorize mainnet.
