# Difficulty + Timestamp II — measured clock-health WAN gate

Status: **Lab-only / no consensus authority**.

This experiment runs the arrival-clock version on the existing four-runner
WAN topology. A/B/C execute the shadow peers; D observes their public endpoints.
The final observer requires the arrival-policy marker from all three peers.

The additional collector reads each host's existing synchronization service.
It does not set time, start/replace a time service, change NTP configuration,
inject wall-clock offsets or query arbitrary external time servers.

## Frozen measurement contract

- Four distinct runner allocations and kernel boot IDs, roles A/B/C/D.
- Every record carries the exact Git SHA and workflow run ID.
- Before node/tunnel setup, each host performs a bounded read-only readiness phase.
- Readiness requires two consecutive synchronized PASS samples one second apart, with a maximum 30-second wait.
- Readiness evidence is preserved separately as `clock-readiness.json`; failure to establish readiness cannot pass the final clock gate.
- The WAN experiment may still proceed after an incomplete readiness phase so network evidence remains independent from clock-health evidence.
- After readiness, collect immediately before node/tunnel setup, every 10 seconds, and after completion.
- At least two measured records with explicit start/end and at least 20 seconds of coverage.
- Maximum adjacent sampling gap: 45 seconds; maximum command-probe duration: 15 seconds.
- Maximum adjacent wall-clock vs monotonic elapsed-time difference: 1 second.
- Synchronization-service state must be synchronized at every measured sample.
- Reported diagnostic error envelope must be present and at most 30 seconds.
- Missing reports, collector failures, incomplete capture or excess bounds cannot pass.
- Network result and clock-health result are separate. Final verification requires both.

Chrony reports are interpreted as absolute remaining system correction plus root
dispersion plus half the absolute root delay. This is conditional on its upstream
time source and measurement assumptions, as described in the
[Chrony tracking documentation](https://chrony-project.org/doc/4.0/chronyc.html).

For systemd-timesyncd, record its synchronized state, reported offset and root
distance. Their sum is a diagnostic envelope of the reported sample, **not an
independent bound on current UTC error**. These fields describe the service's
measurements; repeated reads do not prove that a new upstream measurement was
made on every read. See the
[timedatectl documentation](https://www.freedesktop.org/software/systemd/man/latest/timedatectl.html).

Both backends therefore retain `independent_utc_proof: false`. This gate measures
host clock health during the WAN run. It does not claim an independent UTC
reference, quantified sample freshness at the upstream source, independent human
operation, provider/region diversity, or a six-hour soak.

## Reproduction and evidence

Workflow: `Full Target Shadow Clock Health WAN`.

It uses the existing bounded WAN/recovery scripts with the explicit
`FAE_WAN_CLOCK_HEALTH=1` flag. The original workflow remains usable without the
collector. Before the WAN scripts start, the dedicated `preflight` action waits
read-only for the frozen readiness condition and writes `clock-readiness.json`.
The ordinary collector then begins the strict measured capture. Each role retains
`clock-health.jsonl` with raw service output, normalized diagnostics, wall and
monotonic counters, and identity metadata.

An aggregation job downloads all four artifacts and recomputes both readiness and
measured assessments from the raw records. It binds readiness to the same role,
boot ID and runner allocation as the measured capture, then checks D's network
result and A/B/C policy markers.

`clock-health-result.json` reports per-host readiness state, sample counts,
duration, largest reported envelope, sampling gaps, wall/monotonic changes and
all incomplete conditions. No missing number is converted to zero. Source code,
raw evidence and aggregate result remain separately identifiable.

Historical fixtures establish that the arrival-clock implementation operates
over WAN with these host diagnostics. Near-future boundary behavior remains
covered by the controlled local arrival suite; old historical fixtures do not
by themselves measure near-boundary WAN disagreement.
