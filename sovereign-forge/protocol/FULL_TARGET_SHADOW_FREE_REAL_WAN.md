# Full-Target Shadow: Free Real-WAN Multi-Host Validation

Status: **lab-only / no consensus authority**

This protocol closes the next empirical gap after the one-machine failure-domain ceiling without requiring paid infrastructure. It runs the existing Full Target Shadow peer implementation across separately provisioned GitHub-hosted runner VMs and exposes only the peer HTTP port through short-lived public tunnels.

The transport policy is deliberately provider-fallback capable:

```text
auto = Cloudflare Quick Tunnel -> localhost.run
```

Cloudflare remains the preferred ephemeral tunnel. If its bootstrap or public endpoint readiness fails, the harness may fall back to a free `localhost.run` reverse-SSH tunnel. The effective provider is recorded in every endpoint/evidence packet and independently checked by observer D.

## Evidence class

A successful run establishes:

- real multi-host execution on separately allocated GitHub-hosted VMs;
- explicit distinct-kernel evidence from unique Linux boot IDs for A/B/C/D;
- real public Internet transport between the hosts through independent public tunnel endpoints;
- a fourth runner that independently observes A/B/C through those public endpoints;
- deterministic interruption of the reorg after common-ancestor discovery, once during headers and once during block bodies;
- durable `SIGKILL` recovery with no partial adoption;
- fresh-session recovery to the greater-work branch;
- rejection of a reachable lower-work rollback;
- post-restart reconnect and accelerated partition/reconnect churn;
- public-tunnel provider identity that is stated by A/B/C and independently recomputed by D.

It **does not** establish:

- multi-provider compute independence — all compute VMs are GitHub-hosted runners;
- region/provider diversity guarantees;
- an independent human operator;
- a 6-hour or 24-hour time-equivalent soak;
- mainnet or testnet consensus authority.

Using Cloudflare and localhost.run in the same run demonstrates transport-provider portability, not multi-provider *compute* independence.

## Why this is not a one-machine simulation

The workflow allocates four separate jobs:

```text
A — weak branch host       GitHub-hosted VM
B — strong branch host     GitHub-hosted VM
C — recovering node        GitHub-hosted VM
D — independent observer   GitHub-hosted VM
```

A, B and C each expose their peer server through a separate temporary public endpoint. Depending on transport availability, an endpoint may be a `trycloudflare.com` Cloudflare Quick Tunnel or a free localhost.run endpoint such as `lhr.life`. C does not read A or B state files. D does not read C's files or loopback control endpoint: it checks A/B/C only through their public URLs.

Two independent allocation signals are required before D may attest a PASS:

- A/B/C must have distinct GitHub runner allocation names and D must have a fourth allocation;
- A/B/C/D must expose four distinct Linux `/proc/sys/kernel/random/boot_id` values.

Linux hostname text is intentionally not used as a uniqueness primitive because GitHub-hosted runner VMs may reuse the same hostname string. A boot ID is generated for a Linux kernel boot and gives us a stronger explicit separation check than job naming alone.

## Public tunnel transport

### Primary: Cloudflare Quick Tunnel

When `cloudflared` is available, `auto` first attempts a bounded Quick Tunnel bootstrap. The endpoint is accepted only after its public `/status` route is readable.

### Fallback: localhost.run

If Cloudflare cannot bootstrap a usable endpoint, `auto` falls back to localhost.run using the free no-key reverse-SSH path:

```text
ssh -T \
  -o ServerAliveInterval=15 \
  -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes \
  -R 80:127.0.0.1:<peer-port> \
  nokey@localhost.run
```

The endpoint is again accepted only after the public `/status` route is readable. The SSH process must remain live for the duration of the host job.

The harness supports three explicit policies through `FAE_WAN_TUNNEL_PROVIDER`:

```text
cloudflare
localhost-run
auto
```

`auto` is the normal policy on `main`. A provider transition is allowed only during endpoint bootstrap. Once an endpoint has been published into the rendezvous, later tunnel death is fail-closed; the protocol does not silently replace a live test endpoint mid-reorg.

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
- short-lived public test endpoints and their declared transport provider;
- runner allocation and kernel boot identifiers used for separation evidence;
- machine-readable phase markers and PASS/FAIL attestations.

No wallet secrets, private keys, production credentials or consensus authority are placed there. The issue is closed by the finalizer after the run.

## Required sequence

### 0. Endpoint establishment

A, B and C each start the shadow validation node and establish a public tunnel under the selected transport policy. They publish their role, runner allocation identity, Linux boot ID, public endpoint, transport provider, tip and cumulative work. D confirms the three A/B/C allocations, three URLs and all four A/B/C/D boot IDs are distinct, and independently infers each tunnel provider from its endpoint URL.

### 1. Weak branch observed independently

C synchronizes to A over A's public tunnel and persists the weak branch. C pauses. D independently fetches A and C via their public URLs and must confirm:

- C tip == A tip;
- C work == A work;
- C secure-context binding == policy id.

Only D's PASS allows C to continue.

### 2. Headers interruption across the real WAN

C routes B synchronization through the existing lab fault proxy. The proxy target is B's public URL, so upstream traffic crosses the public tunnel/WAN regardless of whether B is currently exposed by Cloudflare or localhost.run. Transport degradation remains enabled and secure response ordinal 2 is truncated.

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
four distinct Linux boot IDs for A/B/C/D
three declared providers consistent with the three public URLs
B cumulative work > A cumulative work
C tip == B tip
C work == B work
A remains on weak tip/work
C secure-context binding == C policy id
```

D then posts the final PASS marker. A, B and C may exit only after that external observation.

## Empirical evidence

### First clean public-WAN PASS

Workflow: `Full Target Shadow Free Real WAN`

Run: `34752998631`

This established the original real-WAN A/B/C/D protocol using Cloudflare Quick Tunnels. It passed headers interruption, block-body interruption, hard-crash recovery, fresh-session recovery, lower-work rollback rejection, reconnect and four accelerated churn cycles. This run predates the stricter Linux boot-ID requirement.

### Strong VM-separation confirmation

Run: `34753446338`

This confirmation required four distinct runner allocations and four distinct Linux kernel boot IDs for A/B/C/D. D independently observed the weak state and final strong state through public endpoints. The same Network Recovery & Reorg invariants passed.

### Forced localhost.run strong-branch PASS

Run: `34753968117`

To prove that the fallback is not merely dormant code, the validation branch forced **B, the greater-work branch**, to use localhost.run while A and C used Cloudflare:

```text
A: cloudflare-quick-tunnel
B: localhost-run
C: cloudflare-quick-tunnel
```

Observed work:

```text
A weak work:   3416064
B strong work: 3670016
C final work:  3670016
```

The final controller evidence reported:

- headers interrupted across C -> proxy -> localhost.run -> B: PASS;
- block bodies interrupted across the same real-WAN path: PASS;
- `SIGKILL` durable weak-state recovery: PASS;
- fresh-session adoption of the stronger B branch: PASS;
- lower-work rollback rejection: PASS;
- reconnect: PASS;
- accelerated churn cycles: 4 PASS.

The independent D attestation reported:

- four distinct runner/VM allocations: PASS;
- four distinct Linux boot IDs: PASS;
- declared tunnel-provider identity consistent with endpoint URLs: PASS;
- weak state independently observed: PASS;
- stronger-work branch selected: PASS;
- secure-context binding: PASS;
- real public tunnels: PASS;
- `tunnel_provider_fallback_capable`: **true**;
- multi-provider compute proof: **false**;
- time-equivalent soak: **false**.

All jobs and the finalizer completed successfully. This run establishes that the real reorg/recovery path itself works when the strong peer is exposed through the zero-cost fallback provider.

## Cost boundary

This harness was designed specifically to avoid paid host provisioning. It uses GitHub-hosted standard runners for the public repository plus ephemeral public tunnels.

The normal transport policy currently uses:

- Cloudflare Quick Tunnels as the primary tunnel path;
- localhost.run free reverse-SSH tunnels as fallback.

No paid VM, persistent server, external database or paid tunnel is required by the protocol. If GitHub, Cloudflare or localhost.run changes its public/free usage policy, the workflow's zero-direct-infrastructure-cost assumption must be revalidated.

## Authority boundary

Everything in this protocol remains shadow/lab-only. The local control marker, WAN harness names, public-tunnel coordination, Cloudflare/localhost.run code and real-WAN workflow must remain absent from authoritative v4 core/peer entry points and the v6 candidate authority path.

A PASS from this protocol strengthens empirical network-recovery evidence. It does not activate consensus changes and does not authorize mainnet or testnet activation.
