# Full-Target Shadow: Free Real-WAN Multi-Host Validation

Status: **lab-only / no consensus authority**

This protocol closes the next empirical gap after the one-machine failure-domain ceiling without requiring paid infrastructure. It runs the existing Full Target Shadow peer implementation across separately provisioned GitHub-hosted runner VMs and exposes only the peer HTTP port through short-lived public test tunnels.

## Evidence class

A successful run establishes:

- real multi-host execution on separately allocated GitHub-hosted VMs;
- explicit distinct-kernel evidence from unique Linux boot IDs for A/B/C/D;
- real public Internet transport between the hosts through independent public endpoints;
- a fourth runner that independently observes A/B/C through those public endpoints;
- deterministic interruption of the reorg after common-ancestor discovery, once during headers and once during block bodies;
- durable `SIGKILL` recovery with no partial adoption;
- fresh-session recovery to the greater-work branch;
- rejection of a reachable lower-work rollback;
- post-restart reconnect and accelerated partition/reconnect churn.

It **does not** establish:

- multi-provider compute independence — all compute VMs are GitHub-hosted runners;
- guaranteed region/provider diversity;
- an independent human operator;
- a 6-hour or 24-hour time-equivalent soak;
- mainnet or testnet consensus authority.

## Host topology and separation proof

The workflow allocates four separate jobs:

```text
A — weak branch host       GitHub-hosted VM
B — strong branch host     GitHub-hosted VM
C — recovering node        GitHub-hosted VM
D — independent observer   GitHub-hosted VM
```

A, B and C publish separate short-lived public endpoints. C never reads A or B state files. D never reads C's files or loopback control endpoint; it checks A/B/C only through their public URLs.

Two independent allocation signals are required before D may attest a PASS:

- A/B/C must have distinct GitHub runner allocation names and D must have a fourth allocation;
- A/B/C/D must expose four distinct Linux `/proc/sys/kernel/random/boot_id` values.

Linux hostname text is intentionally not used as a uniqueness primitive because hosted runner VMs may reuse the same hostname string.

## Zero-cost public tunnel layer

The harness uses a fail-closed, two-provider bootstrap strategy:

1. Cloudflare Quick Tunnel is the preferred path and is attempted up to three times during endpoint bootstrap.
2. If Cloudflare cannot create a usable endpoint, the harness may fall back to a free Pinggy HTTP tunnel over SSH.
3. A candidate endpoint is accepted only after its public `/status` endpoint returns valid shadow-node JSON.
4. Once an endpoint is accepted, the provider is not silently swapped during the recovery protocol. Mid-run failure therefore remains visible as a failure instead of being hidden by transport substitution.

The observer records the provider actually used by each A/B/C endpoint. Tunnel-provider diversity is not counted as multi-provider **compute** evidence.

The Pinggy fallback has a separate public-HTTP smoke test. That smoke validates only fallback transport functionality; it is not itself multi-host Network Recovery evidence.

## Lab-only control plane

C requires deterministic orchestration but reuses the same shadow peer implementation. `fae-full-target-shadow-validation-node.mjs` exposes an optional control plane only when `FAE_SHADOW_CONTROL_PORT` is non-zero.

The control plane:

- binds to loopback only and rejects non-loopback configuration;
- exposes `/control/status` and `/control/sync`;
- calls the same `node.syncPeer()` used by the existing validation node;
- is never exposed by the public tunnel;
- is labeled `lab-only-local-control-no-consensus-authority`.

## Coordination

An ephemeral GitHub issue is created for each run. It contains only the run id, short-lived public endpoints, runner/boot identifiers and machine-readable phase markers. It contains no wallet secrets, private keys, production credentials or consensus authority and is closed by the finalizer.

## Required sequence

1. **Endpoint establishment** — A/B/C publish role, runner allocation, boot ID, public endpoint, tip and work. D requires distinct allocations, URLs and four distinct boot IDs.
2. **Weak state** — C synchronizes to A over the public WAN and persists A. D independently confirms C tip/work == A tip/work.
3. **Headers interruption** — C reaches B through the lab fault proxy and the secure headers response is truncated. C must remain fully on A.
4. **Block-body interruption + hard crash** — block bodies are truncated; C must remain on A, is `SIGKILL`ed and must restart from the complete weak durable state.
5. **Fresh-session recovery** — the route is restored with delay/jitter/fragmentation/chunk pacing but no truncation. C must atomically adopt greater-work B.
6. **Rollback resistance** — reachable lower-work A must return `validated_but_not_preferred` and cannot roll C back.
7. **Restart while B route is absent** — C restarts with durable B state while only A is exercised and still rejects rollback.
8. **Reconnect + accelerated churn** — B is restored; C must report `already_current`. Four remove/recreate cycles, including another hard restart, preserve B.
9. **Independent final observation** — D fetches A/B/C through public endpoints and requires B work > A work, C == B, A still weak and secure-context binding intact.

The churn pass is accelerated stress, not a 6h/24h soak.

## Empirical PASS 1 — runner-allocation real WAN

Run `34752998631` completed successfully before the boot-ID requirement was introduced.

Observed runner allocations:

- A: `GitHub Actions 1000000890`
- B: `GitHub Actions 1000000889`
- C: `GitHub Actions 1000000891`
- D: `GitHub Actions 1000000888`

Observed work:

```text
A weak work:   3416064
B strong work: 3670016
C final work:  3670016
```

Headers interruption, block-body interruption, hard-crash recovery, fresh-session recovery, rollback rejection, reconnect and four churn cycles all passed. This run remains valid real-WAN evidence but predates the stronger kernel boot-ID requirement.

## Empirical PASS 2 — boot-ID-hardened real WAN

Run `34754320552` completed successfully with the stronger separation gate.

Observed allocations and boot IDs:

- A: `GitHub Actions 1000001012` — `6dabebf5-5da3-4f9b-8dd8-ee008c34e4ef`
- B: `GitHub Actions 1000001010` — `d718f65e-d48d-442d-9b07-348671ca6171`
- C: `GitHub Actions 1000001011` — `e98c9400-0d74-429c-a412-c6490172bbda`
- D: `GitHub Actions 1000001013` — `96e869b2-dd97-46dc-b9ef-2f29ba7c666e`

All four boot IDs were distinct. D independently observed the weak state before faults and the final state after recovery.

Final controller evidence:

- headers interrupted: PASS;
- block bodies interrupted: PASS;
- `SIGKILL` durable recovery: PASS;
- fresh-session greater-work recovery: PASS;
- lower-work rollback rejected: PASS;
- reconnect: PASS;
- accelerated churn cycles: 4 PASS;
- A work: `3416064`;
- B/C final work: `3670016`.

Independent D attestation:

- distinct runner VMs: PASS;
- distinct kernel boot IDs: PASS;
- public endpoint consistency: PASS;
- weak state independently observed: PASS;
- stronger-work branch selected: PASS;
- secure-context binding: PASS;
- real public tunnels: PASS;
- multi-provider compute proof: **false**;
- time-equivalent soak: **false**.

All authority, A, B, C, D and finalizer jobs completed successfully. This is the current strongest zero-direct-infrastructure-cost real-WAN Network Recovery evidence.

In this run all three A/B/C endpoints happened to bootstrap successfully through Cloudflare, so the Pinggy fallback was available but was not invoked by this multi-host run.

## Empirical fallback-provider smoke

Run `34754459563` explicitly exercised the Pinggy path and completed successfully.

The public Pinggy endpoint returned the shadow node `/status` over the Internet and the smoke recorded:

```text
scenario: pinggy-fallback-public-http-smoke
provider: pinggy-free-http
public_status_verified: true
consensus_authority: false
```

This proves that the fallback provider works for the transport shape required by the harness. It does **not** upgrade the evidence to multi-provider compute or replace the A/B/C/D recovery proof.

## Cost boundary

The harness is designed to avoid paid host provisioning: GitHub-hosted standard runners provide ephemeral compute for the public repository, while Cloudflare Quick Tunnel is the primary temporary endpoint provider and Pinggy is a zero-account fallback. No paid VM, persistent server or external database is required by this protocol.

Provider free-use policies can change. Cost assumptions must therefore be revalidated before future runs are treated as zero-direct-infrastructure-cost.

## Authority boundary

Everything here remains shadow/lab-only. The local control marker, WAN harness names, Cloudflare/Pinggy tunnel logic and validation workflows must remain absent from authoritative v4 core/peer entry points and the v6 candidate authority path.

A PASS strengthens empirical network-recovery evidence. It does not activate consensus changes and does not authorize mainnet or testnet activation.
