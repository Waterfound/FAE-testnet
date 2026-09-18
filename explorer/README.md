# FAE Explorer application

This directory is the standalone read-only FAE Block Explorer application introduced by BE-03.

> **Explorer observes FAE; it never authorizes FAE.**

## Architecture

```text
Independent Node
  -> verified /explorer/* GET surface
  -> explorer/api-client.mjs
  -> explorer/app.mjs
  -> explorer/index.html
```

The application is intentionally separate from the Wallet/Mining site. It imports no wallet, key, signing, mining, consensus, Supabase or node-runtime modules.

## Run locally

Serve the repository or this directory with any static HTTP server, then run an Independent Node on the API base configured in `config.json`.

The BE-03 default is:

```text
http://127.0.0.1:8787
```

That is a development default only. It is **not** evidence of a public deployment.

## Read-only routes consumed

- `GET /explorer/status`
- `GET /explorer/blocks`
- `GET /explorer/block`
- `GET /explorer/transaction`
- `GET /explorer/address`
- `GET /explorer/search`

The client module does not expose a generic request method and does not implement POST, transaction submission, block submission, signing or mining.

## Routing

The static application uses hash routes so it does not require server-side rewrite authority:

- `#/` — home;
- `#/block/<height-or-hash>`;
- `#/tx/<txid>`;
- `#/address/<faet1...>`;
- `#/search/<query>`.

## Fail-closed rules

The app refuses successful payloads whose network does not equal `fairyelf-public-testnet-v4`. It also requires the node's observed tip binding on every successful Explorer response.

A stale address cursor returned by the node is surfaced as a retry condition; the browser never attempts to reconcile or select a chain itself.

## Deployment boundary

BE-03 creates application source only. Public deployment remains **NOT_LIVE** until a later frontier binds a public Explorer deployment to an exact integrated revision and a verified HTTPS Independent Node endpoint.

Deleting `explorer/` must not change Wallet/Mining, node operation, consensus, economics or FAE network survival.
