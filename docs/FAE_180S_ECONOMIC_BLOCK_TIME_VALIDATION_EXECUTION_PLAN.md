# FAE Research — 180s Economic + Block-Time Validation

**Build Colony run:** `bc-fae-180s-ebtv-20260928-001`  
**Kind:** REAL_PLANNING_RUN  
**Frozen FAE source:** `48ba1df01075f7e6714d2e98d5ce8df827d1e5f2`  
**Branch:** `colony/fae-180s-economic-block-time-validation-001`  
**Authority:** research/candidate-write only; no consensus, activation, release, or mainnet authority.

## Mission

Attempt to falsify whether the **active 180-second public-testnet block interval** remains technically defensible. A favorable research result does not promote 180s, 300s, or any other candidate and cannot select an activation height.

The v2 300/600/900 line remains valid evidence for the properties it actually measured. This workstream reopens only the boundary that v2 did not answer directly: **the parameter that is actually active today, including the live v4 DAA and timestamp rules.**

## Critical methodological finding

The active public-testnet core is not running the ASERT-style DAA proxy analyzed in Economic + Block-Time v2.

The live v4 core currently has:

- target: 180 s;
- retarget interval: 20 blocks;
- expected retarget span: 19 × 180 s;
- retarget delta: `round(log2(expected/actual))`;
- per-retarget clamp: ±2 difficulty bits;
- difficulty range: 12..28;
- live future timestamp wall: +120 s;
- maximum transactions per block: 20.

Therefore:

> 300/600/900 DAA proxy results are directional context, not proof of active-180 DAA behavior.

F180-03 is mandatory and tests the exact active algorithm.

## Existing evidence ledger

| Evidence | 180s status | What it proves | What it does not prove |
|---|---|---|---|
| Economic + Block-Time v2 Lab | Directional | Block-time couples to economics, maturity, capacity, DAA density, propagation and payout semantics | Active 180s behavior |
| v2 L2 results | Directional | 300/600/900 ASERT-style proxy, propagation sensitivity and payout variance | Live v4 20-block DAA |
| v2 External Evidence Gate | Methodology reusable | Propagation admission, Wilson stale confidence, comparable-throughput discipline | A 180s PASS |
| v2 Pre-L3 Ceiling | Directional | Real three-region 300/600/900 propagation; rare-event limits; anti-evidence-manufacture ceiling | Natural stale/reorg rate at 180s |
| Difficulty + Timestamp II | Candidate/local directional | Arrival-clock hardening and clock-health separation | Live v4 +120s rule is safe |
| Active v4 core | Direct implementation | Exact active economics, 180s target, DAA, timestamp and capacity constants | Real-world network outcomes |
| Stability V1 | Direct failed historical run | Harness abort; pre-failure 0 stales/reorgs and ~128 ms P95 | Any partial PASS |
| Stability V2 | Direct failed historical run | ~208s outage/recovery divergence exceeded frozen 180s bound; 0 stales/reorgs do not erase failure | That 180s itself caused the outage |
| Stability V3 | Future separate gate | PREPARED_NOT_STARTED | Anything until complete |

## Frozen evidence rules

All external evidence records source, population/environment, period, metric definition, relevance to FAE, limitations, and whether comparison is direct or directional.

Simulation is always labelled simulation. Synthetic tests complement but never substitute for observed WAN/physical evidence. Missing evidence fails closed.

### Propagation

Reuse the precommitted absolute gates when evidence is comparable:

- median < 1 s;
- mean < 2 s;
- P95 < 5 s;
- at least 500 propagation samples;
- P99 must be reported when the underlying distribution permits it.

No new hard P99 threshold is invented after seeing results.

### Stale/fork confidence

Reuse the precommitted 95% Wilson bounds:

- steady upper bound < 1%;
- stress upper bound < 2%.

For **zero observed stales**, at least **381 steady trials** are needed to get the Wilson 95% upper bound below 1%, and **189 stress trials** below 2%. Zero events below those sample sizes is insufficient evidence, not PASS.

### DAA

Precommitted scenarios:

- steady hash rate;
- 0.1×, 0.2×, 0.5× losses;
- 2×, 5×, 10× gains;
- miner arrival/departure cycles;
- low-hashrate floor approach;
- timestamp-coupled adversarial windows;
- outage then recovery.

Hard failure includes reproducible non-convergence after the hash rate stabilizes, persistent pathological oscillation, in-envelope floor/ceiling lock, or a material reproducible timestamp strategy that creates directional easing advantage.

### Timestamp

Network success and clock health remain separate metrics. The active +120s rule is tested as it exists. Difficulty + Timestamp II is a reference, not silent activation of the 90s candidate rule.

### Recovery

The historical V2 value remains:

`208 s > frozen 180 s recovery/outage bound`

That run is **FAIL**. It is not automatically proof that the 180s block target is invalid; its causal contribution must be tested separately.

## Execution graph

```text
F180-00  Canonical boundary + Build Colony freeze
   |
   v
F180-01  Existing evidence inventory / comparability
   |
   +----------------+----------------+----------------+
   |                |                |                |
   v                v                v                v
F180-02          F180-03          F180-05          F180-09
Economics/UX     Live DAA          Prop/stale       External data
   |                |                |                |
   v                v                +------.         |
F180-06          F180-04                  |          |
Payout/econ      Timestamp/DAA             v          |
   |                |                    F180-08      |
   +---------.      |                    Recovery     |
             |      |                       |         |
             '----> F180-07 <---------------'         |
                    Decentralization                  |
                           |                           |
                           '------------.--------------'
                                        v
                                     F180-10
                              Comparative synthesis
                                        |
                                        v
                                     F180-11
                              Independent verification
                                        |
                    .-------------------+-------------------.
                    |                                       |
                    v                                       v
                 F180-13                                 external wait
              WAN/physical
                    |
                    v
                 F180-12
             Terminal research verdict
```

Independent surfaces are parallelized. Shared evidence contracts, synthesis, verification, and verdict remain serialized.

## Frontiers

| ID | Frontier | Evidence class | Now? |
|---|---|---|---|
| F180-00 | Boundary + execution freeze | deterministic/local | GREEN by this planning commit |
| F180-01 | Evidence inventory + comparability matrix | deterministic/local | yes |
| F180-02 | Active economics/capacity/UX baseline | deterministic/local | yes |
| F180-03 | Exact active-v4 DAA shock/oscillation lab | simulation + replay | yes |
| F180-04 | Timestamp/DAA coupling | local + simulation | after F180-03 |
| F180-05 | Propagation/stale/fork reconciliation | replay + statistics | yes |
| F180-06 | Mining economics/payout variance | local + simulation | after F180-02 |
| F180-07 | Decentralization sensitivity | simulation + external data | after F180-05/06 |
| F180-08 | Outage/partition/recovery replay | replay + simulation | after F180-03/05 |
| F180-09 | External public evidence review | external data | yes |
| F180-10 | 180/300/600 synthesis | synthesis | after evidence surfaces |
| F180-11 | Independent verification + ledger | verification | after synthesis |
| F180-13 | Fresh WAN/physical/natural-event evidence | external | not currently |
| F180-12 | Terminal verdict | serialized verdict | last |

## Terminal verdicts — frozen before results

Verdict precedence is:

1. **MATERIAL_RISK_FOUND**
2. **INSUFFICIENT_EVIDENCE**
3. **SUPPORTED_WITHIN_CURRENT_EVIDENCE**

`MATERIAL_RISK_FOUND` wins if a frozen hard gate has a reproducible material failure under direct/admissible 180s evidence or a software-only falsification survives independent verification.

`INSUFFICIENT_EVIDENCE` applies when no such failure is established but one or more evidence classes required for the claim remain statistically or operationally inadequate.

`SUPPORTED_WITHIN_CURRENT_EVIDENCE` requires no material hard-gate failure and sufficient admissible coverage of every evidence class required for that bounded claim.

None of these verdicts changes consensus.

## Durable Execution handoff

The workstream is bound to a separate Durable Execution portfolio:

`fae-180s-economic-blocktime-validation`

Target runtime:

- repository: `Waterfound/General-Execution`;
- runtime branch: `runtime/durable-asp-control`;
- verified runtime source: `a27a558d4ed0e28b925f0b424368a2f11e2f9b7`;
- authority creation: forbidden.

Durable Execution may persist checkpoints, consume bounded transitions and resume admissible work. It stops at a genuine human-authority gate, new spend, material destructive action, consensus/economic activation, mainnet authority, unavailable external evidence, or final completion.

> **Execution consumes authority. It does not create authority.**
