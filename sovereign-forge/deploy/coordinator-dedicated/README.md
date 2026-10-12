# FAE Share Coordinator — dedicated-server candidate deployment

This directory deploys the non-custodial Authoritative share-coordinator candidate on a generic Linux dedicated server. It is intentionally provider-neutral.

## Safety state

- The coordinator holds no payout private key and has no consensus authority.
- Payouts remain direct coinbase outputs when/if PPLNS is activated.
- The configured upstream MUST be the separate Authoritative candidate API.
- With `PPLNS_COINBASE_ACTIVATION_HEIGHT=null`, `/work` must fail closed with HTTP 409 and the browser continues to have direct-PoW fallback.
- Do not configure the production browser to use this coordinator until the external canary passes.

## Host requirements

- Linux x86_64/arm64 with Docker Engine and Docker Compose v2.
- Persistent local storage for Docker volumes.
- Public IPv4/IPv6 and a DNS name pointing to the server.
- Inbound TCP 80/443 and UDP 443; do not expose coordinator port 3190 publicly.
- Provider policy must explicitly allow the intended blockchain/mining-related workload.

## Deploy

1. Copy `.env.example` to `.env`.
2. Set `FAE_COORDINATOR_DOMAIN` to a DNS name whose A/AAAA record points at the server.
3. Keep `FAE_CANDIDATE_API_URL` on `fae-public-testnet-v4-authoritative-candidate` while activation is null.
4. Run:

```sh
docker compose pull
docker compose build --pull coordinator
docker compose up -d
```

Caddy obtains and renews TLS automatically. The coordinator is only reachable through Caddy; port 3190 is internal to Docker.

## Canary before browser configuration

From a checkout of this repository:

```sh
FAE_COORDINATOR_URL=https://YOUR_DOMAIN node sovereign-forge/deploy/coordinator-dedicated/canary.mjs
```

Expected state before activation:

- HTTPS 200 on `/health` and `/status`.
- network `fairyelf-public-testnet-v4`.
- `pplns_coinbase_activation_height: null`.
- `mining_enabled: false`.
- `holds_payout_private_key: false`.
- `/work` returns HTTP 409 with `activation required`.

## Persistence proof

Record `coordinator_id` from the canary, then restart the stack:

```sh
docker compose restart coordinator
```

Run the canary again. The `coordinator_id` must be identical. The Docker volume `coordinator-data` contains the persistent Ed25519 identity and hash-chained `shares.ndjson` ledger.

## Upgrade rule

Deploy new images with the existing `coordinator-data` volume. Never delete or recreate that volume during an ordinary upgrade. Keep activation null until a separately ratified activation-height deployment and pre-activation live canary are complete.
