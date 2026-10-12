# Browser client migration

`mining.js` is the exact consensus-facing miner module captured from the current production testnet deployment during canonicalization.

The current live browser deployment also contains `index.html`, `core.js`, `wallet-crypto.js`, `wallet.js`, and `bip39-en.js`. Those files still need to be moved from the deployment artifact into Git history before the browser frontend itself can be called fully canonical/reproducible.

## Node choice requirement

The live `core.js` currently points to one Supabase API URL. The canonical browser client must replace that hard-coded origin with a selectable node endpoint (with a known public default) so miners/wallets can choose independently operated nodes. Until that is deployed, the standalone node is independently runnable but the public browser UI is not yet multi-node by default.

## Prepared node-selection module

`node-config.js` implements the canonical endpoint-selection primitive. Before deployment, `core.js` should load this file first and replace its hard-coded API constant with:

```js
const API=window.FAENodeConfig.current();
```

A settings control can then call `FAENodeConfig.set(url)`, which verifies `/status` and the network id before persisting the endpoint. This is intentionally not wired into the current production HTML yet because the remaining production browser files are not in Git history.
