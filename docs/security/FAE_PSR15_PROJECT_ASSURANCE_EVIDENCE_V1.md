# FAE PSR-15 — Project Assurance White-Box Attack Campaign

Status: candidate complete pending campaign, canonical, cross-Lab verification and exact-source integration  
Source baseline: `a0be46e22e5ecf3400922f9fa3f267c35bd46916`  
Project Assurance method: `Waterfound/Red-Team@095a9c2eb5b2b3bdec0132238120583ef28a6d8c`

## Premise

The attacker is assumed to know 100% of the FAE source.

The campaign does not treat source secrecy, private repository visibility, scanner results or candidate labels as protection.

## Execution model

The exact PR HEAD is checked out read-only. The campaign runner:

1. requires a clean tracked Git tree;
2. records the exact commit and tree;
3. executes 16 attacks mapped to attack surfaces and invariants;
4. passes a deliberately reduced environment to child cases rather than forwarding credentials;
5. stores output hashes/byte counts rather than raw stdout/stderr in the evidence report;
6. verifies that HEAD/tree/tracked status are unchanged afterward;
7. converts every failing baseline-blocking attack into an `OPEN_BLOCKER`;
8. has no automatic waiver path.

The permanent Red-Team target pin is not changed. PSR-15 borrows the frozen Project Assurance method but attacks the exact FAE candidate directly.

## New white-box composition probes

The campaign adds explicit tests that existing isolated gates do not express as one composition contract:

- forged persisted UTXO/mempool state must disappear under semantic replay;
- consensus, HTTP, secure-channel, peer-directory and peer-guard resource ceilings must remain present;
- active core/browser code must not acquire direct authority from PQ/shadow/lab surfaces;
- PQ/MTS authority flags, release fences and latest-main cross-Lab semantics must hold together;
- supply-chain provenance must remain exact-source-bound and scanners remain signals only.

## Replayed attack stack

The same campaign also reruns the hostile frontier, fuzz/property corpus, differential implementation, authoritative v4 core, timestamp red-team, P2P security, eclipse/diversity, crash recovery, Mining Tip Sync lifecycle stress, repo hygiene, release provenance, cross-Lab integration and both Lab boundary guards.

## Findings

A failed attack is not averaged away by other green cases.

[
\text{one baseline-blocking failure} \Rightarrow \text{OPEN_BLOCKER}
]

No scanner or aggregate score may waive it.

## Authority

PSR-15 remains authority-free. It cannot change consensus, economics, wallet format, deployment, release status or mainnet authority.

## Exit

PSR-15 becomes GREEN only when the exact candidate has:

- dedicated Project Assurance campaign SUCCESS with zero blockers;
- canonical verification SUCCESS;
- cross-Lab integration SUCCESS;
- exact-source anti-stale binding at merge.

Any finding is routed to PSR-16 for fix/regression closure.
