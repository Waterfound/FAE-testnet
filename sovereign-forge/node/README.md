# FAE independent node

`fae-node.mjs` is a Node.js 22 reference node for `fairyelf-public-testnet-v4`. It uses only Node core modules.

## Run

```bash
cd node
npm ci
npm start
```

Default API: `http://127.0.0.1:8787`.

The node persists state to `./data/fae-state.json`.

## Default synchronization

For migration from the current public testnet, the reference node defaults to:

- public block feed: `fae-chain-feed-v1`
- migration upstream for transaction/block relay: `fae-public-testnet-v4`

The upstream is **not** treated as a synchronization truth source. The chain is reconstructed from `/feed` data and revalidated locally. `FAE_PEERS` is empty by default and is reserved for actual independent nodes that expose `/feed`.

This lets a new independent process reconstruct and validate the public chain rather than trusting a database dump.

Disable all external sync and relay:

```bash
FAE_SYNC=0 FAE_UPSTREAM_API= npm start
```

Relevant settings:

- `FAE_UPSTREAM_API` — temporary public-testnet relay target; empty disables it.
- `FAE_PEERS` — comma-separated independent node URLs used for relay and verified chain sync.
- `FAE_BOOTSTRAP_FEEDS` — comma-separated chain-feed endpoints used only as candidate data for full local validation.
- `FAE_SYNC=0` — disables periodic synchronization.

## Operate a peer cluster

Set comma-separated peer node URLs:

```bash
FAE_PEERS="https://node-a.example,https://node-b.example" \
FAE_BOOTSTRAP_FEEDS="https://node-a.example" \
npm start
```

Each node exposes `/feed`, so any other node can reconstruct and independently validate its chain.

## API

- `GET /status`
- `GET /state`
- `GET /feed?from=1&limit=250`
- `GET /template?address=faet1...`
- `GET /balance?address=faet1...`
- `GET /spendable?address=faet1...`
- `GET /transactions?address=faet1...`
- `GET /peers`
- `POST /submit-tx`
- `POST /submit-block`

## What “independent” means here

A node stores its own chain/UTXO state and recomputes hashes, difficulty, PoW, signatures and value conservation itself. A feed is input data, not trusted truth: an invalid chain is rejected.

Peer discovery is currently operator-configured rather than automatic. That is sufficient to run several independent nodes now, but automatic peer discovery, anti-eclipse protections and production-grade reorg/mempool recovery remain mainnet-hardening work.

## Docker

From the repository root:

```bash
docker compose up -d --build
```

The node persists its independently validated state in the `fae-node-data` volume and exposes port `8787`.
