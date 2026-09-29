# FAE_DP6_RP_B1_SPECIALIZED_ATTACKER_BOUND_AND_COMMODITY_VIABILITY

Date: 2026-09-29
Authority: analytical/evidence-only
Repository: Waterfound/FAE-testnet
Evidence branch: evidence/fae-dp6-rp-b1-20260929
Base branch: colony/fae-asic-a3-r4-control-repair-001
Base head at start: 002748748268cda1fb4ad8ff401880536f6b3c12

## Terminal classification

STRONG_HEURISTIC_NEEDS_SPECIALIZED_BOUND_EVIDENCE

## Scope and inherited state

This artifact continues FAE_DP6_ROBUST_PREMISE_REVIEW without repeating it from zero.

Inherited epistemic state:

- DP6 implementation reality: PROVEN_BY_EXISTING_EVIDENCE.
- DP6 structural memory/dependency pressure: STRONGLY_SUPPORTED.
- DP6 ASIC economic resistance at acceptable advantage: PLAUSIBLE, not demonstrated.
- Commodity-device relative advantage: UNKNOWN.
- Marginal value of full RW5 complexity: UNKNOWN.
- Current FPGA/HLS implementation as a sufficient ASIC economic proxy: FALSIFIED.
- Expensive physical ASIC/FPGA campaign after R3-T1: HOLD pending robust-premise work.

The R3-T1 provider result became available during RP-B1 and is admitted as additional implementation evidence:

- candidate R3-T1-LOCAL166P667;
- physical route complete;
- local compute clock requested 166.667 MHz;
- WNS +0.023269 ns;
- TNS 0;
- WHS +0.009551 ns;
- THS 0;
- routing errors 0;
- Developer_CL produced but AFI creation not authorized;
- dp6_semantics_preserved=true;
- robust_asic_premise_proven=false.

Evidence:
labs/asic-f2-pre-go/runtime/F2_A3_R4_CONTROL_REPAIR_R3T1_PHYSICAL_PROVIDER_RESULT.json

The already-persisted disposition remains correct:
physical timing closure is not economic ASIC-resistance proof.

No AWS execution, AFI, F2 runtime, physical benchmark, physical attacker sweep, sustained/HFB, implementation change, DP7, consensus/economics change, release, activation-height selection or mainnet action occurred in RP-B1.

Principles preserved:

- Memory suggests. Evidence decides.
- Explore with strong heuristics. Commit on robust premises.
- Every new expensive iteration must begin with an explicit hypothesis, a bounded change and a predicted information gain.

---

# 1. Diagnostic Intelligence localization

The central uncertainty is no longer whether DP6 can be implemented.

R3-T1 further closes that question.

The central uncertainty is:

Can a parity-correct specialized miner implement DP6 with a levelized cost per valid work low enough to make ordinary commodity participation structurally irrelevant?

The evidence separates the question into four variables that must not be conflated:

1. source-imposed work and memory constraints;
2. implementation-dependent hardware efficiency;
3. specialist levelized cost per valid work;
4. commodity marginal and levelized cost per valid work.

Diagnostic classification:

- Source-imposed 256 MiB state/context under a full-memory strategy: PROVEN_BY_EXISTING_EVIDENCE.
- Source-imposed intra-work data dependency: PROVEN_BY_EXISTING_EVIDENCE.
- Source-imposed large Argon2 compute burden: PROVEN_BY_EXISTING_EVIDENCE.
- Source-imposed RW5 million-step dependency chain: PROVEN_BY_EXISTING_EVIDENCE.
- Requirement that N resident contexts require N complete compute lanes: FALSIFIED.
- Claim that intra-work seriality alone imposes a low aggregate throughput ceiling: FALSIFIED.
- Custom ASIC area/power floor: UNKNOWN.
- Financial cost floor: UNKNOWN.
- Commodity economic threshold as a single universal multiple: UNKNOWN.
- cause_proven remains false for any claim that one implementation bottleneck proves the economic root cause of specialization resistance.

---

# 2. RP-B1-A — Specialized Advantage Metric

## 2.1 Valid-work denominator

All economic comparison must use valid work, not displayed hash rate and not raw attempts.

For hardware class h define:

Q_h = sustained valid works per second

where invalid, rejected, duplicated and inadmissible work do not count.

## 2.2 Levelized cost per valid work

Let:

Y = seconds per accounting year.

u_h = useful mining utilization fraction over the accounting period.

K_h,j = acquisition cost of component j attributable to the mining system, including when applicable compute silicon, memory, package/interposer, board, power delivery, cooling equipment and host.

a_h,j = annualization factor for component j. If financing/cost-of-capital is deliberately excluded, a_h,j may reduce to 1 / useful_life_years. Otherwise a capital-recovery factor may be used.

F_h = annual fixed maintenance/operational cost.

E_h = measured or defensibly modeled joules per valid work.

p_h = electricity price in currency/kWh.

chi_h = cooling/power-delivery multiplier applied to device energy when appropriate.

V_h = other variable maintenance/wear/operational cost per valid work.

Then:

LCVW_h =
  [sum_j (a_h,j * K_h,j) + F_h] / [Y * u_h * Q_h]
  + chi_h * p_h * E_h / 3.6e6
  + V_h

This is the canonical RP-B1 comparison quantity.

It is intentionally not reducible to work/s.

Two devices with equal throughput can have different LCVW because of capex, utilization, memory/package cost, energy, cooling and lifetime.

Two devices with equal work/W can also have different LCVW because one may require expensive dedicated hardware while the other is already owned.

## 2.3 Existing-owned commodity device

For a device that already exists primarily for another purpose, the purchase cost is economically sunk unless mining materially accelerates replacement.

Define incremental marginal cost per valid work:

MCVW_i =
  chi_i * p_i * E_i / 3.6e6
  + incremental_wear_i
  + incremental_variable_opex_i

If mining materially shortens device life, the resulting accelerated depreciation belongs in incremental_wear_i and must not be silently treated as zero.

## 2.4 Specialized advantage

For specialized miner s and commodity class i:

A_total(s,i) = LCVW_i,new / LCVW_s

A_owned(s,i) = MCVW_i / LCVW_s

Interpretation:

- A_total > 1 means the specialist has lower total levelized cost than a purpose-bought commodity implementation.
- A_owned > 1 means the specialist is cheaper even than the already-owned commodity device's marginal mining cost.

The second condition is more destructive to the FAE participation objective.

## 2.5 Why a single work/s ratio is inadmissible

A work/s ratio misses:

- specialized capex;
- memory and packaging;
- utilization;
- lifetime;
- electricity geography;
- cooling;
- low-frequency/high-efficiency operation;
- device ownership status;
- maintenance;
- invalid/stale work.

Therefore no work/s multiple is an economic specialization threshold by itself.

---

# 3. RP-B1-B — Strongest plausible specialized attacker

## 3.1 Architecture

The strongest currently plausible parity-correct attacker is a multi-context full-memory miner.

It does not change DP6 and uses no cryptanalytic shortcut.

It contains:

- C writable DP6 contexts, approximately 256 MiB logical state each;
- a shared external or in-package memory pool implemented with DDR, GDDR, HBM, or a mixed hierarchy;
- E_A Argon2/Blamka compute engines, with E_A potentially much smaller than C;
- E_R RW5 microcoded/fixed-function engines, with E_R potentially much smaller than C;
- shared SHA-256/BLAKE2 support;
- small per-context register/transcript/program state;
- a ready-context scheduler;
- memory banking and address mapping selected for DP6 access behavior;
- custom interconnect rather than the AWS shell/SmartConnect/HLS topology;
- low-frequency or undervolted operating points if they improve performance/W or cost/work;
- selective replication of only the blocks that improve area x throughput;
- full removal of FPGA LUT/routing/HLS overhead where custom silicon makes that possible.

The critical architecture is:

many memory contexts + fewer shared compute engines

not:

one 256 MiB memory context + one complete replicated compute lane.

## 3.2 Seriality within one work

DP6 source fixes:

ARGON_BLOCKS = 262144
ARGON_BLOCK_BYTES = 1024
ARGON p = 1
ARGON t = 1

A context therefore contains a sequential Argon chain in which the next block depends on the previous block and a data-dependent reference.

RW5 fixes:

PROGRAMS = 8
STEPS = 131072 per program

therefore:

S_RW5 = 8 * 131072 = 1,048,576 steps/work.

Every RW5 step ends with a matrix index derived from current chain/register state, reads matrix value mv, uses mv in the next chain/register update, and writes a mutated value back.

Therefore at least one matrix read is causally required before the next step can be completed.

This is genuine intra-work seriality.

## 3.3 Parallelism across works

Different nonce/work contexts have no source-level cross-context dependency.

Therefore a specialized miner may hold K contexts and schedule a different context while another waits for a dependent memory response.

A simplified optimistic-attacker latency ceiling is:

Q_latency <= K / (S_RW5 * L)

where L is effective dependent-memory round-trip latency and compute cost is ignored.

This equation is not a prediction of achieved throughput.
It is a falsification tool for the claim that seriality of one work necessarily limits aggregate throughput.

Using 50/100/150 ns as prior-art DRAM-latency sensitivity anchors, not DP6 measurements:

- K=1 gives approximately 19.07 / 9.54 / 6.36 work/s.
- K=16 gives approximately 305.18 / 152.59 / 101.73 work/s.
- K=64 gives approximately 1220.70 / 610.35 / 406.90 work/s.
- K=128 gives approximately 2441.41 / 1220.70 / 813.80 work/s.

Because compute and memory bandwidth are omitted, these are ceilings, not expected performance.

But they prove the important structural point:

intra-work seriality is not an aggregate low-throughput invariant when many independent contexts are allowed.

## 3.4 Context capacity examples

Raw memory capacity only, before ECC/controller/reserved-space overhead:

- AWS F2 16 GiB HBM: 64 x 256 MiB contexts.
- 24 GB HBM3E placement: about 89 x 256 MiB contexts.
- 36 GB HBM3E placement: about 134 x 256 MiB contexts.

These are not claims that the corresponding systems can run that many contexts at full speed.
They demonstrate that 256 MiB does not imply one memory package per compute lane or one complete compute engine per context.

---

# 4. RP-B1-C — Specialized Economic Bound

## 4.1 Mathematically/source-derived unavoidable quantities

### Memory state

For a full-memory strategy:

M_context ~= 256 MiB writable state/context.

A time-memory tradeoff may reduce resident memory at additional compute/time cost.
Therefore 256 MiB is a full-memory floor, not a universal lower bound against all recomputation strategies.

### Argon2 block work

There are 262142 fill_block calls after the two initial blocks.

Each fill_block executes:

16 AROUND invocations
x 8 AG invocations/AROUND
x 4 Blamka operations/AG
= 512 Blamka operations.

Therefore source-derived Argon2 fill includes:

262142 * 512 = 134,216,704 Blamka operations/work.

Each Blamka includes a 32-bit x 32-bit multiplication plus additions.

This is a substantial compute requirement independent of the current FPGA mapping.

### RW5 compute

At minimum:

1,048,576 RW5 steps/work.

Every step executes the common chain update and one mulh64 call after the opcode-specific body, plus a 64-bit multiply by a constant and register/memory transforms.

Opcode-specific arithmetic can add multiplication, division/modulo, popcount, clz/ctz, rotations and further memory accesses.

### Full-memory logical traffic

If the immediately previous Argon block is retained close to the compute engine, each newly generated block still requires at minimum:

- one 1 KiB data-dependent reference read;
- one 1 KiB block write.

Including all block writes, the Argon full-memory logical traffic floor is approximately:

511.998 MiB/work.

If the previous block is also fetched from the main state store, the corresponding traffic is approximately:

767.996 MiB/work.

RW5 has one mandatory 64-bit read and one mandatory 64-bit write per step:

1,048,576 * 16 bytes = 16 MiB/work.

Therefore a useful source-derived full-memory traffic interval before opcode-specific extra RW5 accesses is:

approximately 528 MiB/work to 784 MiB/work.

The lower endpoint assumes effective retention of the previous Argon block and 8-byte RW5 memory granularity.
Real physical transfers can be higher due to transaction granularity, row effects, write policy, ECC and controllers.

The mandatory RW5 traffic floor is only about 3.1% of the approximately 512 MiB Argon traffic floor.

Therefore a claim that RW5 obtains most of its anti-specialization value merely by adding bulk memory bandwidth pressure is not supported.

Its value, if material, must come primarily from dependency, mutation, heterogeneous compute, branch behavior or time-memory-tradeoff effects.

## 4.2 Bandwidth sensitivity

If B is effective usable memory bandwidth and D_work is bytes transferred per valid work:

Q_bandwidth <= B / D_work.

Using only the 528-784 MiB source-derived interval:

AWS F2 HBM, 460 GiB/s:
approximately 601-892 work/s bandwidth-only ceiling.

Micron HBM3E, >1.2 TB/s per placement:
approximately 1460-2167 work/s bandwidth-only ceiling using 1.2 TB/s as the anchor.

Micron GDDR7, >1.5 TB/s typical 384-bit system:
approximately 1825-2709 work/s bandwidth-only ceiling using 1.5 TB/s as the anchor.

These are intentionally optimistic attacker ceilings and ignore compute, random-access efficiency, bank conflicts and controller overhead.

Their epistemic value is negative/falsificatory:

bulk bandwidth alone does not impose a low enough structural throughput ceiling to establish commodity fairness.

## 4.3 Memory-side combined sensitivity

Illustrative memory-only ceilings, ignoring DP6 compute:

| Memory anchor | Raw 256 MiB contexts | RW5 latency-only ceiling @50ns | @100ns | @150ns | Bandwidth-only ceiling from 528-784 MiB/work |
| --- | ---: | ---: | ---: | ---: | ---: |
| F2 HBM 16 GiB / 460 GiB/s | 64 | 1221 | 610 | 407 | 601-892 work/s |
| HBM3E 24 GB / 1.2 TB/s | ~89 | 1698 | 849 | 566 | 1460-2167 work/s |
| HBM3E 36 GB / 1.2 TB/s | ~134 | 2556 | 1278 | 852 | 1460-2167 work/s |

The values are ceilings, not forecasts.

They demonstrate that a competent attacker can plausibly provision enough memory contexts that memory latency becomes hideable across works before capacity itself becomes prohibitive.

The unknown then moves to:

- compute engine PPA;
- random-access memory efficiency;
- energy;
- memory/package cost;
- scheduler efficiency;
- achievable utilization.

## 4.4 Time-memory tradeoff evidence

RFC 9106 characterizes Argon2 as memory-hard and Argon2d as data-dependent and suitable for cryptocurrency/PoW settings.

Its security discussion states that the best-known ranking trade-off attack on t-pass Argon2d reduces the time-area product by a factor of 1.33.

The same RFC states that, for a time-bounded defender, one pass maximizes attacker costs for Argon2d/Argon2id under the referenced attack-cost model.

This strengthens the Argon2 core premise relative to an unsupported assumption that t=1 is inherently a weak time-memory configuration.

However this result does not establish DP6 economic fairness.

A full-memory specialized miner need not use a time-memory tradeoff at all.
It can pay for memory and seek advantage in compute specialization, package choice, energy, utilization and scale.

## 4.5 Financial lower bound

No defensible absolute US$/valid-work lower bound can be derived from current evidence.

The missing variables are not minor:

- memory acquisition cost by technology and volume;
- package/interposer cost;
- compute die area and yield;
- controller/PHY area;
- board/power-delivery cost;
- achieved frequency/voltage;
- joules/work;
- cooling;
- utilization;
- lifetime;
- maintenance;
- scale procurement;
- electricity price.

No evidence-backed value currently closes these variables tightly enough.

Therefore the correct result is:

FINANCIAL_SPECIALIZED_COST_FLOOR = UNKNOWN.

The output is a parameterized sensitivity model, not a fabricated dollar estimate.

---

# 5. RP-B1-D — Commodity Viability Contract

## 5.1 Difficulty equilibrium

Let P_w be economic payout per valid work after difficulty equilibrium.

For a competitive specialized mining sector, entry tends to push:

P_w approximately toward LCVW_s plus required risk/profit margin.

As specialized cost falls, network difficulty/aggregate work can rise until payout per work falls correspondingly.

A commodity owner cannot rely on the old pre-specialization payout.

## 5.2 Purpose-bought commodity hardware

A newly purchased commodity miner is competitive on total economics only if:

LCVW_i,new <= P_w.

If specialists set P_w near LCVW_s, this becomes approximately:

A_total(s,i) <= 1.

This is the strictest case.

## 5.3 Already-owned household device

An already-owned device can remain economically rational even if it is worse on total levelized cost, because acquisition cost is sunk.

Its break-even condition is:

MCVW_i <= P_w.

Using P_w approximately equal to LCVW_s:

MCVW_i <= LCVW_s.

With:

A_total(s,i) = LCVW_i,new / LCVW_s

the maximum total specialized advantage consistent with simple marginal break-even is:

A_max,i = LCVW_i,new / MCVW_i.

Define:

kappa_i = 1 - MCVW_i / LCVW_i,new

where kappa_i is the fixed/sunk share of new-device levelized cost from the perspective of an already-owned device.

Then:

A_max,i = 1 / (1 - kappa_i).

Pure mathematical sensitivity:

| Fixed/sunk share kappa | Break-even A_max for already-owned device |
| ---: | ---: |
| 0% | 1.00x |
| 25% | 1.33x |
| 50% | 2.00x |
| 66.7% | 3.00x |
| 80% | 5.00x |
| 90% | 10.00x |

This exposes why an arbitrary universal 3x or 5x threshold is inadmissible.

A 3x threshold implicitly resembles a model where roughly two thirds of commodity levelized cost is sunk/fixed.
A 5x threshold resembles roughly four fifths.

Those may or may not match real FAE devices.

They must be measured/derived.

## 5.4 Material viability is stronger than break-even

Positive marginal profit does not guarantee meaningful participation.

Define household margin fraction:

h_i = (P_w - MCVW_i) / P_w.

A true material-viability policy could require:

h_i >= h_min

or a minimum expected return/time or minimum network participation share.

No canonical h_min, income floor, or minimum commodity network-share objective was located in current evidence.

Therefore RP-B1 does not invent one.

## 5.5 Derived ranges equivalent to A_max

Because the FAE objective covers four heterogeneous device classes, a single scalar A_max is not currently defensible.

The contract is a vector:

A_max,i = LCVW_i,new / MCVW_i

for each required class i.

Define:

A_SAFE:
For every required commodity class, the observed/modelled specialist cost keeps the class above its canonical marginal-viability/headroom requirement, and all physical thermal/lifecycle criteria pass.

A_UNCERTAIN:
Some classes pass and some fail, energy sources are incomparable, specialist LCVW interval crosses one or more A_max,i boundaries, or h_min/participation objective remains unspecified.

A_FAILURE:
The conservative specialist-cost interval lies below the canonical marginal-viability boundary for any required class if the policy remains "each required class must pass", or the eventual canonical material-participation requirement is violated.

Current state:

A_SAFE: not established.
A_FAILURE: not established.
A_UNCERTAIN: current.

## 5.6 Electricity and geography

For commodity class i:

energy variable cost/work =
E_i * p_i * chi_i / 3.6e6.

For specialist s:

energy variable cost/work =
E_s * p_s * chi_s / 3.6e6.

Therefore even equal joules/work do not imply equal cost/work.

A specialized operator may have:

- lower p_s through geography or contracts;
- higher utilization;
- better cooling;
- bulk maintenance;
- longer effective duty cycle.

Conversely, an already-owned household device may carry little or no acquisition cost attributable to mining.

These asymmetries must remain explicit.

---

# 6. Existing commodity reference evidence

The current ASIC baseline contains historical/reference values:

Same-laptop browser control:
- 3.079401 work/s;
- estimated whole-system power 73.2 W;
- approximately 23.77 J/work;
- replacement-cost reference US$1000;
- explicitly provisional and not a substitute for HFB home-device median.

RTX 2070 Max-Q historical run:
- 2.489987 work/s;
- whole-system power approximately 104.511 W;
- approximately 41.97 J/work;
- HOLD / NO HFB COLLAPSE OBSERVED.

These measurements remain HISTORICAL_REFERENCE for RP-B1.
They do not satisfy the four-class canonical Representative Device contract.

The old 3x WARN and 5x collapse thresholds remain historical operational heuristics.
RP-B1 does not elevate them into a canonical economic A_max.

---

# 7. RP-B1-E — RW5 Complexity Ablation

## A — Argon2 core

### Claims

Argon2d is memory-hard and uses data-dependent addressing:
STRONGLY_SUPPORTED by external standard/prior art and directly instantiated in DP6.

DP6 Argon2 p=1,t=1 requires 256 MiB and a sequential block chain:
PROVEN_BY_EXISTING_EVIDENCE.

DP6 Argon2 full-memory path imposes approximately 512 MiB minimum logical state traffic/work under previous-block retention:
PROVEN_BY_SOURCE_MODEL.

Argon2 fill performs 134,216,704 Blamka operations/work:
PROVEN_BY_SOURCE_MODEL.

Blamka multiplication increases circuit depth relative to original BLAKE2-style addition/rotation structure:
STRONGLY_SUPPORTED by RFC 9106 design rationale.

Argon2d t=1 has useful time-area tradeoff resistance:
STRONGLY_SUPPORTED by RFC 9106, which reports best-known t-pass Argon2d ranking tradeoff AT reduction factor 1.33.

Argon2 alone proves acceptable FAE specialized economics:
UNKNOWN.

## B — Full DP6 = Argon2d + RW5

### Proven incremental properties

RW5 adds 1,048,576 state-dependent steps/work:
PROVEN_BY_EXISTING_EVIDENCE.

RW5 adds one mandatory dependent matrix read and one matrix mutation/write per step:
PROVEN_BY_EXISTING_EVIDENCE.

RW5 therefore adds at least 16 MiB logical matrix traffic/work at 8-byte access granularity:
PROVEN_BY_SOURCE_MODEL.

RW5 adds heterogeneous integer operations, branches, multiply/mul-high, division/modulo, rotations, bit-count operations and extra random accesses:
PROVEN_BY_EXISTING_EVIDENCE.

RW5 mutates the Argon-generated state:
PROVEN_BY_EXISTING_EVIDENCE.

### Claims under attack

"RW5 materially frustrates context interleaving across independent works":
FALSIFIED as a structural claim.

Reason:
there is no cross-work dependency.
A scheduler can interleave independent nonce contexts during dependent-memory stalls.
RW5 can increase the number of contexts needed or scheduler complexity, but cannot structurally forbid interleaving.

"RW5 materially frustrates fixed-function/microcoded compute specialization":
PLAUSIBLE, not demonstrated.

Reason:
the instruction mix is heterogeneous and dynamically sequenced, but the ISA is fixed at 32 opcodes, the live integer state is small, and a specialized microcoded engine can contain all required functional units.

"RW5 materially increases unavoidable memory capacity":
FALSIFIED.

Reason:
it reuses the same approximately 256 MiB matrix and does not require another similarly sized independent state.

"RW5 materially increases unavoidable memory traffic":
STRONGLY_SUPPORTED in existence, but magnitude is not yet shown to be economically decisive.

The strict mandatory lower-bound increment is 16 MiB/work, only about 3.1% over the approximately 512 MiB Argon traffic floor.
Opcode-specific memory accesses and physical transaction granularity increase this, but the economic effect is unbounded.

"RW5 mutable-state behavior improves resistance to memory recomputation/time-memory tradeoffs":
PLAUSIBLE.

The mutation makes naive recomputation harder because later values depend on prior writes.
No current proof or quantitative bound converts this into an ASIC economic advantage limit.

"RW5's operations hurt specialized hardware less than GPUs/mobile":
UNKNOWN.

"RW5's operations hurt GPUs/mobile more than specialized hardware":
UNKNOWN.

Both directions require representative-device and specialized-PPA evidence.

## C — Simpler dependent-memory construction

No alternative was implemented.

Counterfactual:

A simpler construction could retain:

- Argon2d 256 MiB state;
- Argon2d data-dependent references;
- Blamka compute/circuit depth;
- a smaller dependent-memory walk.

Whether it retains most of the FAE commodity-participation property is:

PLAUSIBLE but UNKNOWN.

The key finding is that a large part of the currently proven hard cost already exists before RW5:

- 256 MiB state;
- ~512 MiB full-memory traffic floor;
- ~134.2 million Blamka operations;
- Argon2d tradeoff resistance.

Therefore the marginal economic value of full RW5 cannot be inferred from total DP6 difficulty.

## Ablation ratio

Requested quantity:

anti-specialization benefit attributable to RW5
divided by
complexity + validation + device cost attributable to RW5.

Numerator:
not quantitatively established.

Denominator:
strictly positive and partially observed in HLS/physical timing work, where RW5 register/dynamic-access paths have appeared among timing hotspots; commodity-side cost remains unknown.

Result:

RW5_MARGINAL_VALUE_RATIO = UNKNOWN.

This is not evidence that RW5 is useless.
It is evidence that its incremental value has not yet been isolated.

---

# 8. RP-B1-F — Representative Device dependency

Current canonical state still has no admitted physical four-class portfolio.

Required classes:

- consumer_discrete_gpu — RTX-class;
- thin_light_integrated — Apple Silicon thin/light;
- compact_handheld_consumer — Steam Deck-class;
- mobile_tablet_arm — iPad/mobile ARM.

The existing acceptance contract remains valid and should not be rewritten post-result.

## Physical outputs needed to close RP-3

For every class:

### Performance
- independently derived valid work/s;
- attempt deltas;
- accepted/invalid/stale events;
- timestamps;
- sustained retention;
- no reliance on miner-displayed hashrate alone.

### Duration
Pure mining:
- 600 s warmup;
- 1200 s measurement;
- 3 repetitions.

Normal-use coexistence:
- baseline;
- 300 s warmup;
- 900 s measurement;
- 3 repetitions.

The existing physical-autopilot package records approximately 9180 timed seconds/device for the complete fixed campaign.

### Energy
To close economic asymmetry, energy must not merely be present; it must be comparable.

Preferred for cross-device economic comparison:
WALL_POWER for all classes where technically obtainable under controlled charging/battery conditions.

If BATTERY_DELTA or COMPONENT_TELEMETRY is used for a class, it remains valid within its measurement class but must not be mixed with wall-power efficiency as if directly identical.

Required derived metric when compatible:
J / valid work.

If energy is UNAVAILABLE:
technical participation may still pass,
but RP-B1 economic efficiency for that class remains open.

### Thermals/stability
- sustained throughput retention >= 0.70 under the frozen contract;
- no critical OS thermal warning;
- no shutdown;
- no hidden manual restart.

### Normal-use coexistence
- interactive p95 latency ratio <= 2 relative to baseline;
- zero failed scripted interactions;
- recovery <= 120 s.

### Lifecycle
For mobile/tablet and compact handheld:
- at least 5 genuine hidden/visible lifecycle transitions;
- synthetic lifecycle transitions receive no credit.

## RP-3 decision changes

Commodity evidence would strengthen DP6 only if all required classes pass participation/stability and the energy evidence is sufficient to estimate MCVW_i or defensible bounds for it.

A required class that is technically unable to sustain mining, thermally collapses, or has marginal energy cost above the specialist equilibrium payout would materially weaken the commodity-participation thesis.

Representative-device success alone cannot prove specialized resistance.
It supplies the commodity side of the inequality.

---

# 9. RP-B1-G — Information value of future AWS/physical frontiers

## Another timing build

Exact hypothesis:
another implementation refinement closes timing better or at a higher frequency.

Current uncertainty reduced:
FPGA implementation margin only.

Cheaper method:
not needed for the current question; R3-T1 already closed timing.

Predicted information gain for DP6 economic premise:
very low.

Can change DP6 economic decision:
no, absent a new specialized-bound hypothesis.

Classification:
NO_LONGER_JUSTIFIED.

## AFI creation

Exact hypothesis:
none by itself; AFI is an enablement artifact.

Current uncertainty reduced:
none economically.

Cheaper method:
not applicable; no need to enable F2 until a decisive runtime question exists.

Predicted information gain:
near zero.

Can change DP6 economic decision:
no by itself.

Classification:
REDUNDANT_AT_PRESENT.

## F2 parity/runtime

Exact hypothesis:
a future timing-closed dual-lane/control candidate is runtime-live and parity-correct.

Current uncertainty reduced:
implementation liveness/correctness.

Cheaper method:
static/source validation cannot prove runtime OCL/control liveness.

Predicted information gain:
high for implementation correctness, low for ASIC economics.

Can change DP6 decision:
only indirectly if a later physical experiment has already been justified by RP-B2.

Classification:
CONDITIONALLY_REQUIRED.

## FPGA benchmark

Exact hypothesis:
the current FPGA candidate's achieved work/s and energy lie in a measured interval.

Current uncertainty reduced:
FPGA implementation performance.

Cheaper method:
the current economic question can be attacked analytically without it; present HLS is already rejected as a sufficient ASIC proxy.

Predicted information gain:
low for specialized ASIC bound.

Can change DP6 decision:
not under current model.

Classification:
REDUNDANT_AT_PRESENT.

## Physical FPGA attacker sweep

Exact hypothesis:
another configuration in the same FPGA/HLS family is a faster parity-correct FPGA attacker.

Current uncertainty reduced:
best FPGA configuration within that family.

Cheaper method:
architecture/PPA modeling is more directly targeted to the missing ASIC bound.

Predicted information gain:
low-to-moderate for FPGA, low for competent custom ASIC.

Can change DP6 decision:
not enough by itself.

Classification:
NO_LONGER_JUSTIFIED for the existing sweep design.

## Sustained run

Exact hypothesis:
a selected competitive candidate sustains throughput and energy without thermal/runtime collapse.

Current uncertainty reduced:
long-run stability.

Cheaper method:
must first establish that the candidate is economically informative.

Predicted information gain now:
low.

Can change DP6 decision now:
no.

Classification:
REDUNDANT_AT_PRESENT.

## HFB

Exact hypothesis:
a specialized candidate versus admitted commodity portfolio remains inside the derived viability contract on cost/work and efficiency.

Current uncertainty reduced:
system-level economic comparison.

Cheaper method:
not fully, once both sides of the model are actually bounded.

Predicted information gain:
potentially high later, currently low because specialist bound and commodity evidence are incomplete.

Can change DP6 decision:
yes after RP-B2 + Representative Device admission.

Classification:
CONDITIONALLY_REQUIRED.

## Summary

REQUIRED now:
none of the listed AWS frontiers.

The Robust Premise anti-loop rule therefore remains active.

---

# 10. Project Assurance bounded adversarial challenge

Question:

Can a competent specialized miner escape the apparent DP6 cost structure while remaining fully parity-correct?

## Attack 1 — Memory capacity escape

Strategy:
use external DDR/GDDR/HBM rather than 256 MiB dedicated on-die SRAM per compute engine.

Result:
SURVIVES AS PLAUSIBLE ATTACK.

Reason:
full DP6 requires per-context state, but nothing in the source requires a dedicated memory package or dedicated compute engine per context.

Modern public memory examples show tens of GB per placement/system, enough for many raw 256 MiB contexts.

DP6 thesis impact:
memory capacity alone is not a robust economic bound.

## Attack 2 — Bandwidth escape

Strategy:
provision high-bandwidth GDDR/HBM and amortize it across contexts.

Result:
SURVIVES AS PLAUSIBLE ATTACK.

Reason:
source-derived full-memory traffic of ~528-784 MiB/work is large but public memory bandwidth anchors yield idealized bandwidth ceilings in the hundreds to thousands of work/s before compute.

DP6 thesis impact:
bandwidth alone is not a low aggregate-throughput invariant.

## Attack 3 — Latency escape

Strategy:
interleave independent work contexts while one context waits for dependent memory.

Result:
STRUCTURAL ESCAPE EXISTS.

Reason:
RW5 is serial within one work but independent between nonce contexts.

No cross-context dependency prevents scheduling.

DP6 thesis impact:
a specialized bound cannot assume one memory latency is paid on the wall clock with no overlap across works.

## Attack 4 — Compute-sharing escape

Strategy:
share fixed-function/microcoded Argon2/RW5 functional units across many resident contexts.

Result:
PLAUSIBLE.

Reason:
DP6 has a fixed known operation set.
RW5 uses a 32-op ISA and small live state.
Expensive units such as divide/mod can be shared if their dynamic frequency permits.

Unknown:
actual initiation intervals, area and energy.

DP6 thesis impact:
N contexts = N full compute lanes is inadmissible.

## Attack 5 — FPGA/HLS overhead escape

Strategy:
remove FPGA LUT/routing, shell, AXI/control, HLS scheduling and FPGA frequency constraints in custom silicon.

Result:
STRONGLY_SUPPORTED AS A PLAUSIBLE ADVANTAGE SOURCE.

R3-T1 proves the FPGA can close timing; it does not create an ASIC lower bound.

DP6 thesis impact:
current F2 throughput cannot serve as a lower bound on competent specialized efficiency.

## Attack 6 — Low-frequency efficiency escape

Strategy:
operate more modestly clocked specialized engines near a favorable voltage/frequency point and maximize work/J rather than per-lane work/s.

Result:
PLAUSIBLE.

DP6 thesis impact:
peak clock difficulty does not imply poor specialist cost/work.

## Attack 7 — Memory-energy escape

Strategy:
use modern GDDR/HBM with high throughput and efficient interfaces.

Result:
PLAUSIBLE.

Public GDDR7 information quotes multi-TB/s-class system bandwidth and component-level pJ/bit figures, but those are not a full DP6 random-access energy model.

DP6 thesis impact:
no whole-system joule/work floor is established.

## Attack 8 — Amortization/utilization escape

Strategy:
run specialist hardware near continuous utilization while household devices mine intermittently.

Result:
STRONGLY_SUPPORTED ECONOMIC POSSIBILITY.

DP6 thesis impact:
even modest hardware advantage can grow in LCVW terms through utilization.

## Attack 9 — Commodity-threshold escape

Strategy:
compare specialist total cost against household total replacement cost even though household capex is sunk, or conversely ignore accelerated wear.

Result:
MODEL ERROR IDENTIFIED.

Correct comparison needs both LCVW_new and MCVW_owned.

DP6 thesis impact:
a universal 3x/5x threshold is not derivable without capex-share and participation policy.

## Attack 10 — RW5 marginal-value escape

Strategy:
attribute most anti-specialization protection to Argon2 and implement RW5 efficiently in a microcoded engine.

Result:
PLAUSIBLE.

Evidence:
Argon2 already contributes the dominant proven memory traffic and a very large multiplication count.
RW5 adds mandatory serial random accesses and mutation but does not add another large memory-capacity requirement.

DP6 thesis impact:
RW5 may be valuable, but its incremental economic benefit remains unbounded.

---

# 11. Prior-art transfer boundaries

## RFC 9106 / Argon2

Directly transferable:

- Argon2 is memory-hard.
- Argon2d uses data-dependent memory access and is suitable for PoW-style settings.
- Blamka-style multiplication is intended to increase ASIC circuit depth while retaining CPU pipelining benefits.
- best-known Argon2d time-area ranking tradeoff is reported as factor 1.33.
- one pass can be rational in the referenced time-bounded defender model.

Not directly transferable:

- a specific ASIC cost for FAE;
- a specific DP6 energy ratio;
- a claim that 256 MiB guarantees commodity fairness.

## RandomX design rationale

Useful prior-art challenge:

RandomX explicitly targets device binding rather than memory hardness alone.

Its designers intentionally use a fast-mode dataset of about 2080 MiB and describe 256 MiB as small enough to be concerning for on-chip specialized implementation in their threat model.

RandomX also deliberately targets CPU architectural features and uses randomized execution to limit custom-hardware advantage.

Directly transferable:
none of its quantitative security ratios.

Transferable design lesson:
memory hardness alone and device binding are distinct objectives.

DP6 must establish its own economics.

## Modern GDDR/HBM

Directly transferable:

- large writable memory capacities and very high bandwidth are commercially real architectural options.

Not directly transferable:

- price;
- random DP6 efficiency;
- total ASIC power;
- package yield;
- achievable DP6 throughput.

---

# 12. Economic lower-bound result

The strongest currently defensible specialized bound is structural:

1. Full-memory state:
   approximately 256 MiB per resident context.

2. Argon full-memory logical traffic:
   approximately 512-768 MiB/work depending previous-block locality.

3. Mandatory RW5 traffic:
   at least 16 MiB/work at logical 8-byte granularity, plus opcode-specific accesses.

4. Total source-derived full-memory logical traffic before extra RW5 accesses:
   approximately 528-784 MiB/work.

5. Argon compute:
   134,216,704 Blamka operations/work.

6. RW5:
   1,048,576 serial state-dependent steps/work plus common multiply/mul-high and opcode-specific work.

7. Memory time-area tradeoff:
   Argon2d has meaningful known resistance under published models, but a full-memory attacker need not trade memory for time.

What is not bounded:

- compute die mm2;
- memory/package dollars;
- joules/work;
- work/s/mm2;
- work/s/W;
- US$/work;
- context/engine optimum;
- yield;
- volume economics.

Terminal economic result:

NO_DEFENSIBLE_FINANCIAL_LOWER_BOUND_YET.

This prevents Robust-enough promotion.

---

# 13. Attacker sensitivity matrix

| Variable | Attacker-favorable direction | DP6 structural resistance | Current evidence | Decision sensitivity |
| --- | --- | --- | --- | --- |
| Memory/context | cheap 256 MiB full state | fixed full-memory footprint | PROVEN footprint, cost UNKNOWN | HIGH |
| Memory technology | DDR/GDDR/HBM/in-package | random/data-dependent traffic | options commercially plausible | HIGH |
| Contexts/engine | many contexts per engine | per-context state + serial dependency | interleaving structurally allowed | VERY HIGH |
| DRAM latency | 50-150 ns-style range | dependent read each RW5 step | prior-art anchor only | HIGH |
| Bandwidth | 0.46-1.5+ TB/s class | ~528-784 MiB logical traffic | public products exist | HIGH |
| Argon compute | fixed-function Blamka | ~134.2M Blamka/work | source-derived | HIGH |
| RW5 compute | microcoded 32-op engine | 1.048M dependent steps | source-derived | HIGH |
| Divide/mul sharing | share rare/expensive units | dynamic instruction sequence | plausible, frequency unmeasured | MEDIUM |
| Clock | lower f for better V/F | long dependency chain | no ASIC PPA | HIGH |
| Voltage | undervolt | correctness/timing margin | no ASIC PPA | HIGH |
| Utilization | specialist near continuous | household often intermittent | economic variable | VERY HIGH |
| Electricity | specialist cheaper geography | commodity owner locality | not canonicalized | VERY HIGH |
| Packaging | amortize HBM/GDDR/controller | 256 MiB/context remains | cost unknown | VERY HIGH |
| TMTO | reduce memory, recompute | Argon2d AT resistance | external prior art supports resistance | MEDIUM |
| RW5 mutation | may raise recomputation cost | mutable dependent state | source-proven, quantitative effect unknown | HIGH |

The model is most sensitive to:

- specialist compute PPA;
- memory/package cost;
- contexts per compute engine;
- specialist energy/work;
- utilization/electricity;
- commodity MCVW_i.

---

# 14. Cheapest decisive evidence still missing

The cheapest decisive evidence is not another AWS build.

Exact next frontier:

RP-B2 — Specialized Miner PPA Envelope & Full-Memory Cost Floor

Scope:

- keep frozen DP6 semantics;
- no alternative implementation for deployment;
- no DP7;
- no physical provider execution;
- derive an ASIC-style PPA envelope for Argon2 and RW5 from source-level operation/dependency counts;
- explicitly model C contexts versus fewer E compute engines;
- model DDR, GDDR and HBM cases;
- estimate/random-access efficiency ranges rather than peak-bandwidth-only values;
- model low-frequency/low-voltage points;
- obtain or bound memory/package/silicon economics from independent evidence where available;
- produce specialist LCVW_s as a conservative interval or prove that a financial interval remains impossible;
- compare that interval to the vector commodity viability contract.

A useful RP-B2 output is not "ASIC predicted at X work/s".

It is:

under attacker-favorable but physically credible assumptions, the minimum plausible LCVW_s interval is [lower, upper], with named assumptions and sensitivity.

If the lower end already violates commodity viability, the premise is weakened.

If even attacker-favorable lower bounds remain inside A_SAFE, the premise can be promoted toward robust-enough and a bounded physical confirmation can be specified.

---

# 15. Promotion criteria from STRONG_HEURISTIC_ONLY

DP6 may be promoted to ROBUST_ENOUGH_TO_RESUME_BOUNDED_PHYSICAL_VALIDATION only when all of the following are true:

1. Specialized-bound closure:
RP-B2 produces a conservative specialist cost/PPA interval whose attacker-favorable region is bounded tightly enough to compare with commodity viability.

2. Commodity-side closure:
the four-class Representative Device portfolio is physically admitted, or an explicitly justified subset/evidence rule is canonically changed by separate authority; RP-B1 does not change it.

3. Comparable economics:
energy and throughput evidence are sufficient to calculate or bound MCVW_i for the required classes.

4. Viability objective:
material viability is frozen as a deterministic economic condition, not selected after seeing specialist results.

5. Cross-over test:
the conservative specialist interval remains on the viable side of every required commodity boundary under the frozen operating/electricity assumptions.

6. RW5 non-harm:
there is no evidence that RW5's added complexity disproportionately destroys commodity performance enough to erase its anti-specialization benefit.

7. Physical-test relevance:
every resumed expensive test has:
- explicit hypothesis;
- bounded candidate/change;
- predicted information gain;
- a stated decision boundary it can cross.

R3-T1 timing PASS alone satisfies none of criteria 1-6.

---

# 16. Explicit falsification criteria

The DP6 economic premise is materially weakened if any of the following is demonstrated:

1. A parity-correct specialized architecture has a conservative LCVW_s interval below the marginal viability cost of one or more required commodity classes under the canonical participation policy.

2. Context interleaving plus shared compute produces a credible specialist PPA/cost envelope that overwhelms the intended commodity economics.

3. Memory/package cost for 256 MiB contexts is shown to be a small enough fraction of specialist LCVW that memory hardness does not materially limit scale.

4. Specialized joules/work are low enough, combined with plausible specialist electricity pricing/utilization, to push equilibrium payout below required commodity MCVW.

5. Representative Device evidence shows a required class cannot sustain DP6 within thermal/normal-use constraints.

6. RW5 produces substantial commodity penalty while RP-B2 shows little corresponding specialist penalty.

7. A simpler counterfactual is shown analytically to retain essentially the same specialized cost floor while avoiding most RW5 complexity, making the full DP6 complexity premise unjustified.

8. New tradeoff evidence substantially defeats the current Argon2d/RW5 memory-cost assumptions.

No such decisive falsification has yet been proven.

---

# 17. Project Assurance conclusion

Central adversarial question:

Can a competent specialized miner escape the apparent DP6 cost structure while remaining fully parity-correct?

Answer:

YES, multiple plausible escape mechanisms exist from the naive cost model:

- external/in-package memory instead of per-lane dedicated SRAM;
- many contexts with fewer compute engines;
- cross-context latency hiding;
- fixed-function/microcoded compute;
- removal of FPGA/HLS/routing overhead;
- high utilization;
- low-frequency efficient operation;
- electricity/scale advantages.

What is not proven is whether these escapes are sufficient to cross the FAE commodity-viability boundary.

Therefore the adversarial review does not classify DP6 as failed.

It does show that the current evidence cannot promote it to robust-enough.

---

# 18. Remaining unknowns

Primary:

- ASIC-style Argon2 engine area/power/throughput.
- ASIC-style RW5 engine area/power/throughput.
- efficient contexts-per-engine ratio.
- effective random-access bandwidth under DP6, not peak sequential bandwidth.
- memory controller/PHY/package cost.
- energy/work at specialist optimum.
- specialist total capex and lifetime.
- specialist utilization and maintenance.
- canonical household electricity envelope.
- commodity incremental wear/depreciation.
- physical Representative Device Q and E.
- material-viability headroom/share policy.
- quantitative RW5 incremental benefit.

Secondary:

- whether a simpler dependent-memory construction would preserve most of the desired economics.
- whether FPGA measurements can later serve as calibration once an ASIC PPA model exists.

---

# 19. Terminal disposition

Terminal classification:

STRONG_HEURISTIC_NEEDS_SPECIALIZED_BOUND_EVIDENCE

Reason:

RP-B1 successfully defines the correct economic metric, the strongest plausible attacker, the source-derived structural floors, the commodity viability equations, the Representative Device dependency and the information value of future AWS.

It does not obtain a defensible specialist financial lower bound.

That missing bound is logically upstream of further FPGA benchmarking.

Representative Device physical evidence remains a parallel external dependency, but even perfect commodity evidence would not close the DP6 thesis without a specialist cost bound.

Therefore the primary next frontier is specialized-bound evidence.

Exact next frontier:

RP-B2 — Specialized Miner PPA Envelope & Full-Memory Cost Floor

Expensive ASIC/FPGA campaign:

remain HOLD.

R3-T1:

admitted as PHYSICAL_PASS_TIMING_CLOSED and as stronger implementation evidence only.

No additional physical frontier is justified by RP-B1 itself.

Evidence before status.

Memory suggests. Evidence decides.

Explore with strong heuristics. Commit on robust premises.

---

# 20. Evidence references

Internal evidence:

- Waterfound/FAE-testnet, colony/fae-asic-a3-r4-control-repair-001
- labs/asic-f2-pre-go/hls/fae_dp6_hls.cpp
- labs/asic-f2-pre-go/BASELINE.json
- labs/asic-f2-pre-go/runtime/F2_SINGLE_LANE_BASELINE_RESULT.json
- labs/asic-f2-pre-go/runtime/F2_ATTACKER_SWEEP_A1_HBM0_RESULT.json
- labs/asic-f2-pre-go/runtime/F2_ATTACKER_SWEEP_A2_2LANE_RESULT.json
- labs/asic-f2-pre-go/runtime/F2_ATTACKER_SWEEP_A2B_2LANE_200MHZ_R2_RESULT.json
- labs/asic-f2-pre-go/runtime/F2_A3_R4_CONTROL_REPAIR_R3_TIMING_DIAGNOSIS.json
- labs/asic-f2-pre-go/runtime/F2_A3_R4_CONTROL_REPAIR_R3T1_PHYSICAL_PROVIDER_RESULT.json
- labs/asic-f2-pre-go/runtime/FAE_DP6_ROBUST_PREMISE_REVIEW_HOLD.json
- lab/representative-device-evidence-readiness/acceptance-contract.json
- Waterfound/Systems architecture/DEVELOPMENT_DOCTRINE.md
- Waterfound/Systems architecture/PRINCIPLES.md
- Waterfound/Systems architecture/AUTHORITY_MODEL.md
- Waterfound/General-Execution durable evidence for A3-R4/R3-T1.

External/prior-art references:

- RFC 9106, Argon2 Memory-Hard Function for Password Hashing and Proof-of-Work Applications:
  https://www.rfc-editor.org/info/rfc9106/

- RandomX design rationale:
  https://github.com/tevador/RandomX/blob/master/doc/design.md

- AWS F2 architecture/specifications:
  https://aws.amazon.com/blogs/aws/now-available-second-generation-fpga-powered-amazon-ec2-instances-f2/

- Micron HBM3E:
  https://www.micron.com/products/memory/hbm/hbm3e

- Micron GDDR7:
  https://www.micron.com/products/memory/graphics-memory/gddr7

Prior-art values are used as attacker-plausibility anchors and design rationale only.
They are not treated as direct DP6 ASIC measurements.
