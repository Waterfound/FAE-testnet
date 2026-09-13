# Full-Target Shadow: Free Real-WAN Multi-Host Validation

Status: **lab-only / no consensus authority**

This protocol closes the next empirical gap after the one-machine failure-domain ceiling without requiring paid infrastructure. It runs the existing Full Target Shadow peer implementation across separately provisioned GitHub-hosted runner VMs and exposes only the peer HTTP port through short-lived Cloudflare Quick Tunnels.

## Evidence class

A successful run establishes:

- real multi-host execution on separately allocated GitHub-hosted VMs;
- real public Internet transport between the hosts through independent public tunnel endpoints;
- a fourth runner that independently observes A/B/C through those public endpoints;
- deterministic interruption of the reorg after common-ancestor discovery, once during headers and once during block bodies;
- durable `SIGKILL` recovery with no partial adoption;
- fresh-session recovery to the greater-work branch;
- rejection of a reachable lower-work rollback;
- post-restart reconnect and accelerated partition/reconnect churn.

It **does not** establish:

- multi-provider compute independence — all compute VMs are GitHub-hosted runners;
- region/provider diversity guarantees;
- an independent human operator;
- a 6-hour or 24-hour time-equivalent soak;
- mainnet or testnet consensus authority.

The compute provider and public tunnel provider are different systems, but that is not counted as multi-provider *compute* evidence.

## Why this is not a one-machine simulation

The workflow allocates four separate jobs:

```text
A — weak branch host       GitHub-hosted VM
B — strong branch host     GitHub-hosted VM
C — recovering node        GitHub-hosted VM
D — independent observer   GitHub-hosted VM
```

A, B and C each expose their peer server through a separate temporary `trycloudflare.com` endpoint. C does not read A or B state files. D does not read C's files or loopback control endpoint: it checks A/B/C only through their public URLs.

GitHub runner `RUNNER_NAME` allocations are used to prove job/VM separation. Linux hostname text is intentionally not used as a uniqueness primitive because GitHub-hosted runner VMs may reuse the same hostname string.

## Lab-only control plane

C requires deterministic orchestration but must reuse the production-shaped shadow peer implementation rather than inventing a second peer path. `fae-full-target-shadow-validation-node.mjs` therefore exposes an optional control plane only when `FAE_SHADOW_CONTROL_PORT` is non-zero.

The control plane:

- binds to loopback only and rejects non-loopback configuration;
- exposes `/control/status` and `/control/sync`;
- calls the same `node.syncPeer()` used by the existing validation node;
- is never exposed by the public tunnel;
- is labeled `lab-only-local-control-no-consensus-authority`.

## Coordination

An ephemeral GitHub issue is created for each run. It contains only:

- the run id;
- short-lived public test endpoints;
- machine-readable phase markers and PASS/FAIL attestations.

No wallet secrets, private keys, production credentials or consensus authority are placed there. The issue is closed by the finalizer after the run.

## Required sequence

### 0. Endpoint establishment

A, B and C each start the shadow validation node and a Quick Tunnel. They publish their role, runner allocation identity, public endpoint, tip and cumulative work. D confirms the three runner allocations and URLs are distinct.

### 1. Weak branch observed independently

C synchronizes to A over A's public tunnel and persists the weak branch. C pauses. D independently fetches A and C via their public URLs and must confirm:

- C tip == A tip;
- C work == A work;
- C secure-context binding == policy id.

Only D's PASS allows C to continue.

### 2. Headers interruption across the real WAN

C routes B synchronization through the existing lab fault proxy. The proxy target is B's public URL, so upstream traffic crosses the public tunnel/WAN. Transport degradation remains enabled and secure response ordinal 2 is truncated.

C must keep the exact weak live and durable state.

### 3. Block-body interruption + hard crash

The proxy is restarted with secure response ordinal 3 truncated. Headers may arrive and validate; block bodies are interrupted. C must still keep the exact weak state.

C is then killed with `SIGKILL` while that fault path is active and restarted from the same durable files. It must recover the complete weak state with no partial B suffix.

### 4. Fresh-session recovery

The proxy is restored with truncation disabled while delay, jitter, fragmentation and chunk pacing remain enabled. A fresh secure session must rediscover and validate the fork, then atomically adopt B because B has greater cumulative work.

### 5. Rollback resistance

C directly synchronizes with reachable lower-work A through A's public tunnel. The result must be `validated_but_not_preferred`, with C remaining on B.

### 6. Restart while B route is absent

C is hard-killed and restarted while its configured B route is absent. Strong durable state must survive. A remains reachable and must still be rejected as a rollback.

### 7. Reconnect + accelerated churn

The degraded proxy route to B is recreated. C must report `already_current`. Four additional remove/recreate cycles are executed, including another C hard restart, while preserving B tip/work.

This churn is deliberately labeled accelerated stress, not a 6h/24h soak.

### 8. Independent final observation

C publishes a final-ready marker but does not self-attest. D independently fetches A/B/C through the public endpoints and requires:

```text
B cumulative work > A cumulative work
C tip == B tip
C work == B work
A remains on weak tip/work
C secure-context binding == C policy id
```

D then posts the final PASS marker. A, B and C may exit only after that external observation.

## First clean empirical PASS

Workflow: `Full Target Shadow Free Real WAN`

Clean run: `34752998631`

Observed runner allocations:

- A: `GitHub Actions 1000000890`
- B: `GitHub Actions 1000000889`
- C: `GitHub Actions 1000000891`
- D: `GitHub Actions 1000000888`

Observed branch work:

```text
A weak work:   3416064
B strong work: 3670016
C final work:  3670016
```

The final controller evidence reported:

- headers interrupted: PASS;
- block bodies interrupted: PASS;
- hard-crash recovery: PASS;
- fresh-session recovery: PASS;
- lower-work rollback rejected: PASS;
- reconnect: PASS;
- accelerated churn cycles: 4 PASS.

The independent D attestation reported:

- distinct runner VMs: PASS;
- public endpoint consistency: PASS;
- weak state independently observed: PASS;
- stronger-work branch selected: PASS;
- secure-context binding: PASS;
- real public tunnels: PASS;
- multi-provider compute proof: **false**;
- time-equivalent soak: **false**.

All A/B/C/D jobs and the finalizer completed successfully.

## Cost boundary

This harness was designed specifically to avoid paid host provisioning. It uses GitHub-hosted standard runners for the public repository and Cloudflare Quick Tunnels for temporary public test endpoints. No paid VM, persistent server or external database is required by the protocol.

If either provider changes its public/free usage policy, the workflow's cost assumptions must be revalidated before it is treated as zero-direct-infrastructure-cost.

## Authority boundary

Everything in this protocol remains shadow/lab-only. The local control marker, WAN harness names, Quick Tunnel coordination and real-WAN workflow must remain absent from authoritative v4 core/peer entry points and the v6 candidate authority path.

A PASS from this protocol strengthens empirical network-recovery evidence. It does not activate consensus changes and does not authorize mainnet or testnet activation.
