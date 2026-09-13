# FAE Lab — Network Recovery & Reorg V1

Date: 2026-09-13  
Scope: profile-bound 300-second candidate, local recovery and process integration.  
Source baseline: `864c00f8dd49d16f1d03cc81b49f6766b849e37f` from PR #28.  
Public consensus activation authority: **FALSE**.

## Reproduced gap

The candidate lab node held its chain and mempool only in process memory. The existing
16-process restart test checked catch-up from available peers. It did not establish
durable restart with no peers or retention of unconfirmed transactions.

The new process regression failed against the baseline after a SIGKILL at height 201:

`acknowledged chain must survive restart without any peer: 0 !== 201`

The baseline sync path also reconstructed detached transactions locally without
repropagating them to the source of the winning chain. Same-tip sync did not retry
pending transactions after restart.

## Implemented behavior

- `FAE_L3_STATE_FILE` enables durable snapshots for the candidate lab process.
  Each process must have its own file on storage that survives its restart.
  `/status.recovery.enabled` explicitly reports whether persistence is configured.
- A mutation is published in memory and acknowledged only after the validated
  snapshot has been written. A disk-write failure preserves the published state;
  a subsequent retry can proceed.
- Snapshots bind network, profile, genesis, initial target and transaction domain.
  Recovery reconstructs UTXOs, confirmations, fees and coinbase maturity from the
  validated block log, then revalidates pending signatures and dependencies.
- Pending dependency order is preserved. Historical mempool sequence values do
  not reorder a child ahead of its parent.
- The existing durable store provides checksummed generations, file and directory
  synchronization, temporary-file recovery and a previous-snapshot backup. Recovery
  still validates consensus and transactions even if a checksum matches.
- Reorg publication persists the winning chain and recovered mempool together.
  Recovered transactions are relayed in parent-before-child order, including to the
  source peer. Same-tip sync retries pending delivery after restart or peer loss.
- If all existing snapshots are invalid, startup fails explicitly. It does not
  silently replace an existing broken database with genesis.

The lab retains its prior ephemeral mode when `FAE_L3_STATE_FILE` is unset. Its
fixture reset/load controls remain lab controls. This change does not deploy a node,
change live v4 source, activate a profile or alter economics, DAA, fork choice or the
200-block coinbase maturity rule.

## Verification

Local verification: Node v24.19.0; dedicated CI: Node 22.

| Case | Required observation |
|---|---|
| Snapshot reconstruction | Same UTXOs and pending dependency graph; invented cached balance has no effect |
| Invalid snapshot records | Foreign identity, invalid signature, duplicate and reversed dependencies are rejected |
| Truncated primary | Last valid backup is validated, recovered and healed |
| Complete newer temporary file | Newer valid generation is recovered before rename |
| No valid snapshot | Startup fails; matching checksum cannot admit an invalid signature |
| Winning conflicting spend | Detached parent and descendant are dropped; unrelated pending transaction survives |
| Shorter, higher-work branch | Now-immature coinbase spend and its descendant are absent after reorg and replay |
| Three-process recovery | Parent confirmed at 201, child pending; crash/restart, competing 202 branch, reorg, relay, another restart, same-tip retry, both reconfirmed at 203 |
| Disk-write failure | No success acknowledgement or published tip advance; retry and restart retain the eventual block |

The three-process case also rebuilds all three final snapshots and compares their
UTXOs, confirmation heights and tip hashes. It uses three separate child processes,
loopback HTTP, deterministic fixture wallets, unique temporary storage and bounded
proof-of-work. It includes three abrupt restarts; the disk-failure case adds one.
Fixture private keys are public test data and must never hold real funds.

Run the nine recovery cases:

```bash
node --test sovereign-forge/tests/network-recovery-v1.mjs sovereign-forge/tests/network-recovery-v1-process.mjs
```

Related compatibility checks also passed locally:

```bash
node sovereign-forge/tests/fae-v5-300-core-integration.mjs
node sovereign-forge/tests/fae-v5-300-profile-bound-launch.mjs
node candidate-net-lab/run-local-profile-core.mjs
```

## Evidence boundary and next work

This establishes N0 deterministic recovery cases and N1 local process integration.
It does not establish WAN recovery, multiple provider independence or power-loss
behavior of a remote volume. A SIGKILL leaves the host and filesystem running.

Recovering a previous backup can roll back to that last valid snapshot. Peer
reconciliation is still needed to recover newer chain data. If a transaction exists
in no surviving snapshot or peer, this mechanism cannot recover its missing bytes.
Relay is retried during successful same-tip sync; this lab adds no automatic network
scheduler or permanent broadcast-delivery guarantee.

Snapshots currently replay the full chain and pending set during validation. This
is a correctness-first lab implementation, not evidence of production storage
throughput or a bounded recovery time for a large chain.

The next useful extension is the same recovery sequence across separate hosts,
with interrupted connectivity during reorg and relay, recording snapshot generation,
tip, chainwork, mempool membership, and time to reconverge. Keep that evidence
separate from local results and from any future public activation decision.
