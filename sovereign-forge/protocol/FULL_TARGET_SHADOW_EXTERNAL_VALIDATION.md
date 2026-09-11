# FAE Full-Target Shadow External Validation Gate

Status: **lab-only / no consensus authority**. This procedure does not activate ASERT, full-target headers, or any new consensus rule on the public testnet or mainnet.

## Purpose

This is the first gate that cannot be established by single-host CI alone. It validates the already-tested full-target shadow stack under real WAN scheduling, separate failure domains, independent clocks, process/container restarts, temporary network partitions, and an independent operator.

The validation image runs `lab/fae-full-target-shadow-validation-node.mjs`. It uses deterministic fixture version 1 with activation height 14:

- `trusted`: common H1-H12 checkpoint only.
- `weak-a`: H13-H15 valid branch with a long activation gap and lower cumulative work.
- `strong-b`: H13-H15 valid branch with a shorter activation gap and higher cumulative work.

Every correct installation independently derives the same fixtures and policy fingerprint. No private key, wallet seed, production/testnet database, or FAE funds are required.

## Required topology

Minimum gate: **3 publicly reachable hosts** A, B, and C.

Preferred gate: 3 hosts in at least **2 infrastructure providers and 3 regions**, plus a fourth observer or operator. At least one node should be launched by a person who did not write or modify the test code, using only this runbook.

All hosts should have:

- Docker capable of running a Node 22 image (or Node.js >=22 for non-Docker execution).
- Persistent storage mounted at `/data`.
- inbound TCP access to port 8788 from the other validation hosts and observer.
- NTP/time synchronization enabled. Record UTC time and synchronization state at the start and end.
- ability to stop/restart a container and temporarily block one peer path for the chaos stage.

Do **not** send node identity private-key files, host credentials, cloud credentials, wallet secrets, or seed phrases as evidence.

## Build

Pin all hosts to the same tested Git commit. From repository root:

```bash
docker build -f sovereign-forge/node/Dockerfile.full-target-shadow-validation \
  -t fae-shadow-validation:<COMMIT> sovereign-forge/node
```

Record `<COMMIT>` and the resulting image ID/digest in the evidence package.

## Stage 0 — isolated branches

Start A with `weak-a` and B with `strong-b`, initially with no peers:

```bash
# Host A
docker run -d --name fae-shadow \
  -p 8788:8788 -v fae-shadow-data:/data \
  -e FAE_SHADOW_LABEL=A \
  -e FAE_SHADOW_PROFILE=weak-a \
  -e FAE_SHADOW_SYNC=0 \
  fae-shadow-validation:<COMMIT>

# Host B
# Same command, but LABEL=B and PROFILE=strong-b.
```

Start C from `trusted`, pointing only at A:

```bash
docker run -d --name fae-shadow \
  -p 8788:8788 -v fae-shadow-data:/data \
  -e FAE_SHADOW_LABEL=C \
  -e FAE_SHADOW_PROFILE=trusted \
  -e FAE_SHADOW_PEERS=http://<A_PUBLIC_HOST>:8788 \
  -e FAE_SHADOW_SYNC=1 \
  -e FAE_SHADOW_SYNC_MS=15000 \
  fae-shadow-validation:<COMMIT>
```

Gate A: C must adopt A and reach height 15 with A's tip. Save C's evidence file before proceeding.

## Stage 1 — WAN reorg across activation

Preserve C's volume. Restart C with both A and B configured:

```bash
-e FAE_SHADOW_PEERS=http://<A_PUBLIC_HOST>:8788,http://<B_PUBLIC_HOST>:8788
```

Gate B: C must validate both peers and converge to B because `strong-b` has greater cumulative work. The reorg has common ancestor H12, starts below activation at H13, and resolves above activation at H15.

Expected properties in evidence:

- `policy_id` is identical across A/B/C.
- `secure_context_binding == policy_id`.
- final C `tip_hash == B.tip_hash`.
- final C `chain_work == B.chain_work` and is greater than A's.
- sync to A after convergence is not adopted as a rollback.

## Stage 2 — partition + restart chaos

After C has converged to B:

1. Temporarily block only the C↔B path, or stop B, for **15 minutes**. Leave A reachable.
2. Confirm C does not roll back to A.
3. Restart C while B remains unreachable, preserving C's `/data` volume.
4. Confirm C restarts on B's previously persisted tip and still rejects A as less preferred.
5. Restore B connectivity.
6. Confirm C and B agree without manual state repair.

Record the exact UTC start/end of the partition and every restart.

Do not alter production firewalls or system clocks if the test environment cannot be safely isolated; use provider security rules, container networking, or a dedicated validation host instead.

## Stage 3 — soak

Minimum acceptance soak: **6 continuous hours** after Stage 2.

Preferred confirmation soak: **24 continuous hours**.

During soak, keep periodic sync enabled. A successful soak has:

- no process crash or restart not intentionally injected;
- no policy mismatch among intended peers;
- no chain regression or spontaneous tip divergence;
- no loss of persisted state after an intentional restart;
- no successful adoption of lower-work A after C has converged to B;
- evidence polling gaps explainable by the injected partition or host maintenance only.

## Stage 4 — independent operator

A separate operator launches a fresh node D from profile `trusted`, using the same image/commit and only this document. D should peer with A and B.

Gate C: without copying C's state directory, D independently converges to B's tip/work and reports the same `policy_id` and secure context binding.

This validates operability and removes the assumption that the original developer's environment contains hidden setup state.

## External observer

A fourth machine may run:

```bash
FAE_SHADOW_URLS=http://A:8788,http://B:8788,http://C:8788 \
FAE_SHADOW_OBSERVER_MS=10000 \
FAE_SHADOW_OBSERVER_DURATION_MS=21600000 \
FAE_SHADOW_OBSERVER_FILE=./observer.jsonl \
node sovereign-forge/node/lab/full-target-shadow-evidence-collector.mjs
```

For the preferred 24-hour gate, use `86400000` milliseconds.

## Evidence to retain

For each node, retain:

- `/data/full-target-shadow-evidence.jsonl`;
- container/process stdout+stderr covering the whole test;
- final `GET /status` response;
- Git commit and container image ID/digest;
- provider/region (no account IDs or credentials);
- UTC start/end times;
- NTP synchronization status or equivalent clock-health evidence;
- the partition/restart timeline.

Also retain observer JSONL if used.

A PASS must be based on these artifacts, not only screenshots. Screenshots can supplement but do not replace machine-readable evidence.

## Important scope limits

This gate validates distributed operation of the **isolated shadow network**. It does not by itself activate or prove mainnet consensus readiness.

Public-testnet Difficulty/Timestamp telemetry also needs additional naturally produced testnet blocks beyond the current observed tip before the live-data sample can grow. That is a separate observation gate from this WAN validation.

Only after WAN + soak + chaos + independent-operator evidence passes should the project consider whether to move the candidate toward a testnet consensus-activation proposal. Mainnet activation remains a later and stricter decision.
