# FAE live end-to-end verification gate

Status: **open until both automated and physical-device gates pass**.

This gate is intentionally separate from ordinary CI. It verifies the deployed public testnet rather than only local code.

## A. Automated live gate — assistant/CI owned

Run `.github/workflows/live-e2e.yml` or:

```bash
node tests/live-e2e-readonly.mjs
```

Required PASS conditions:

- Canonical Vercel production serves byte-identical `index.html`, wallet/mining/status/trust assets from the checked-out Git commit.
- Active and authoritative-candidate APIs report `fairyelf-public-testnet-v4`.
- Active status/state are internally coherent.
- Candidate and active chain height, tip and difficulty agree pre-activation.
- Supply cap remains 12,000,000 FAE and halving era remains 600,000 blocks.
- `pplns_coinbase_activation_height` remains `null` until explicit ratification.
- Candidate pre-activation direct-PoW template is consensus-equivalent to the active template.
- `/template/pplns` fails closed with `409 pplns_coinbase_activation_required` while activation is null.
- Malformed transaction and block submissions are rejected without accepted state transition.

`LIVE_E2E_READONLY_PASS` is necessary but not sufficient to close this gate.

## B. Physical browser transaction/mining gate — user + assistant evidence

Use **testnet funds only**. Never send seed words, private keys, recovery JSON or passphrases to ChatGPT.

Required observations:

1. On device A, open the canonical production site and create a fresh disposable testnet wallet. Record only its public `faet1...` address.
2. Mine until one new block is accepted to that address. Record the accepted block height/hash and the balance shown after refresh.
3. On device B, create another disposable wallet. Record only its public address.
4. From A send a small amount of testnet FAE to B. Record only the txid, amount and public addresses.
5. Mine/observe the next block that includes the transaction. Confirm A history shows sent/confirmed, B shows received/confirmed, and balances agree after refresh.
6. Refresh/reopen both browsers and confirm the same public chain height/tip is observed. Wallet persistence/recovery must behave as expected; do not expose private recovery material in evidence.

## C. Coordinator/direct-PoW physical fallback gate — user + assistant evidence

This gate is performed only in the dedicated controlled coordinator test environment. **Do not activate PPLNS on the canonical public testnet to run it.**

Required observations:

1. Mac coordinator online: iPad/browser accepts its signed descriptor/work path and mines through the coordinator test path.
2. Stop the Mac coordinator: browser must fail closed on coordinator work and continue through direct PoW rather than stop mining or trust another identity silently.
3. Restart the same coordinator with persistent data: identity/ledger continuity is restored.
4. Restart/reconnect once more: no share-ledger rollback, silent identity replacement or TOFU reset is accepted.

## D. Independent-node/recovery gate

Before this live task is fully CLOSED, validate the deployed candidate behavior with at least two independently running node processes and preferably three network locations:

- sync from known canonical history;
- disconnect/reconnect;
- clean restart from persistent state;
- short partition and convergence to deterministic cumulative-work winner;
- detached transaction recovery/repropagation;
- no chain regression after restart.

The repository already has deterministic local simulations for these behaviors. This section requires real process/network evidence, not only simulation.

## Completion rule

Close `FAE – verificação live completa/end-to-end` only when:

- automated live gate = PASS;
- wallet → mining → transaction → confirmation = PASS;
- coordinator outage → direct-PoW fallback → persistent recovery = PASS;
- independent-node restart/reconnect/convergence = PASS;
- no P0/P1 failure remains unresolved.

A failure does **not** justify silently weakening consensus or activating PPLNS. Repair, redeploy, and repeat the failed section.
