# FAE_DP6_RP_B2_SPECIALIZED_MINER_PPA_ENVELOPE_AND_FULL_MEMORY_COST_FLOOR

Date: 2026-09-29
Authority: analytical / evidence-only
Repository: Waterfound/FAE-testnet
Branch: evidence/fae-dp6-rp-b2-20260929
Parent analytical artifact: FAE_DP6_RP_B1_SPECIALIZED_ATTACKER_BOUND_AND_COMMODITY_VIABILITY

## Terminal classification

STRONG_HEURISTIC_NEEDS_SPECIALIZED_BOUND_EVIDENCE

The result does not promote or weaken DP6 by appearance.

RP-B2 closes the source-level PPA envelope as far as current analytical authority allows, but it does not produce a defensible absolute ASIC area, energy, or financial lower bound.

The physical ASIC/FPGA campaign remains HOLD.

No AWS execution, physical build, AFI creation, F2 runtime, benchmark, physical attacker sweep, sustained/HFB, DP6 implementation change, alternative design, consensus/economics change, release, activation-height change or mainnet action occurred in RP-B2.

---

# 1. Why RP-B2 was the correct frontier

RP-B1 established:

- the correct economic metric is levelized cost per valid work, not work/s alone;
- the strongest plausible attacker uses many resident memory contexts plus fewer shared compute engines;
- seriality within one work does not imply low aggregate throughput;
- no defensible specialist financial floor existed.

Therefore the next admissible question was narrower:

What PPA/capacity/throughput floor can be derived from frozen DP6 source before a technology-specific specialized implementation is required?

RP-B2 answers that question.

---

# 2. Frozen source-derived work

The current frozen HLS/source establishes:

- context state: approximately 256 MiB per full-memory context;
- Argon blocks: 262,144 x 1 KiB;
- Argon fill calls after initialization: 262,142;
- 512 BlaMka operations per fill_block;
- total Argon BlaMka operations: 134,216,704 per valid work;
- RW5 programs: 8;
- RW5 steps/program: 131,072;
- RW5 steps/work: 1,048,576.

Every RW5 step contains a causally dependent matrix access whose result participates in the next state, followed by a mutation of the matrix.

Therefore:

mandatory RW5 dependent reads/work = 1,048,576

mandatory RW5 writes/work = 1,048,576.

At the source's 64-bit logical access granularity:

mandatory RW5 logical traffic = 16 MiB/work.

For full-memory Argon execution:

- if the immediately previous block is kept close to compute, the source requires approximately 512 MiB of principal-state traffic/work;
- if it is also fetched from the principal store, the corresponding source-derived figure approaches 768 MiB/work.

Thus the full-memory source-derived interval before opcode-specific extra RW5 accesses is approximately:

528 MiB/work to 784 MiB/work.

These are logical-work bounds, not physical bus-transfer predictions.

---

# 3. Technology-independent capacity-throughput floor

Let:

S = 1,048,576 mandatory dependent RW5 reads/work.

L_eff = effective latency between issuing a dependent read and having enough returned state to determine the next dependent address.

Q = valid work/s.

C = number of resident independent contexts available for latency hiding.

Because the next dependent address in one context cannot be determined before the current dependent access resolves, but independent works can be interleaved:

C >= Q * S * L_eff.

For a full-memory strategy with:

M_context = 256 MiB,

the memory-capacity throughput product is:

M_total / Q >= M_context * S * L_eff.

This is the strongest robust PPA-like floor produced by RP-B2.

It survives the attacker strategy:

many contexts + fewer compute engines.

The attacker can share compute.

It cannot make resident context state disappear without invoking a time-memory/recomputation tradeoff.

## Sensitivity

| Effective dependent latency | Contexts per 1 work/s | Resident memory per 1 work/s |
| ---: | ---: | ---: |
| 25 ns | 0.0262 | 6.71 MiB |
| 50 ns | 0.0524 | 13.42 MiB |
| 75 ns | 0.0786 | 20.13 MiB |
| 100 ns | 0.1049 | 26.84 MiB |
| 150 ns | 0.1573 | 40.27 MiB |
| 200 ns | 0.2097 | 53.69 MiB |

The latency values are sensitivity points, not claims about a specific HBM/GDDR implementation.

The equation, not any selected latency, is the robust result.

---

# 4. What context interleaving can and cannot escape

RP-B1 showed that context interleaving defeats a naive statement:

one dependent latency must serialize the entire miner.

RP-B2 sharpens that result.

Interleaving can trade memory capacity for aggregate throughput.

It cannot make the trade free.

For any selected L_eff, every additional sustainable work/s requires additional resident contexts according to:

dC/dQ >= S * L_eff.

Therefore the correct invariant is not latency alone.

It is:

capacity x inverse-throughput, parameterized by effective dependent latency.

Classification:

- intra-work dependent seriality: PROVEN_BY_EXISTING_EVIDENCE;
- inter-work parallelism: PROVEN_BY_SOURCE_STRUCTURE;
- "seriality alone forces low aggregate throughput": FALSIFIED;
- full-memory capacity-throughput product: PROVEN_BY_SOURCE_MODEL;
- economically decisive value of that product: UNKNOWN until installed memory cost and energy are bounded.

---

# 5. Current memory technology adversarial anchors

These sources are used to challenge the DP6 bound, not to claim achieved DP6 throughput.

## AWS F2 HBM

Existing FAE evidence uses AWS F2 with 16 GiB HBM and an advertised aggregate HBM bandwidth up to approximately 460 GiB/s.

Raw capacity supports 64 x 256 MiB contexts before reservation/controller overhead.

This remains an FPGA experimental anchor, not an ASIC economic proxy.

## Micron HBM3E

Public Micron specifications expose:

- 24 GB and 36 GB HBM3E capacities;
- greater than 1.2 TB/s bandwidth per placement;
- advanced stacked/TSV packaging.

This demonstrates that tens of GB of high-bandwidth stacked memory are commercially real.

## Micron HBM4

By 2026 Micron publicly reports HBM4 36 GB 12-high in high-volume production, with:

- greater than 2.8 TB/s per stack;
- greater than 20% better power efficiency than HBM3E;
- explicit compatibility with custom ASICs when the processor/package supports the interface.

A 36 GB stack has raw capacity for approximately 134 full 256 MiB DP6 contexts.

Using the RP-B2 latency equation only:

- at 50 ns sensitivity: ~2,558 work/s latency-only ceiling;
- at 100 ns: ~1,279 work/s;
- at 150 ns: ~853 work/s.

These are ceilings assuming compute is free and actual effective DP6 random latency equals the sensitivity value.

They are not performance predictions.

## Micron GDDR7

Micron publicly reports:

- 24 Gb production GDDR7 devices;
- >1.5 TB/s system bandwidth at the cited 384-bit/32 Gb/s configuration;
- improved power efficiency relative to GDDR6.

GDDR provides an attacker alternative that avoids HBM-style stacking/interposer requirements at the expense of a different board/controller/power envelope.

## Consequence

The thesis cannot rely on:

"256 MiB is too much memory for a specialized miner."

That claim remains falsified.

The defensible question is whether the required memory-capacity/latency/energy/cost product is high enough after specialization.

---

# 6. Bandwidth-throughput floor

Let D_work be effective bytes transferred per work.

The source-derived logical interval is at least approximately:

528 MiB <= D_work <= 784 MiB

before extra RW5 opcode-specific accesses and before physical transaction amplification.

Therefore:

B_eff >= Q * D_work.

Using vendor peak bandwidth only as attacker-favorable ceilings:

| Memory anchor | Peak bandwidth | Bandwidth-only Q ceiling from 784-528 MiB/work |
| --- | ---: | ---: |
| F2 HBM | 460 GiB/s | ~601-892 work/s |
| HBM3E | >1.2 TB/s | ~1,460-2,167 work/s |
| GDDR7 system | >1.5 TB/s | ~1,825-2,709 work/s |
| HBM4 | >2.8 TB/s | ~3,406-5,057 work/s |

These ceilings intentionally ignore:

- random-access losses;
- bank conflicts;
- command overhead;
- write turnaround;
- ECC;
- controller overhead;
- compute.

Therefore they cannot be used as achieved throughput.

They establish a negative result:

peak bulk bandwidth does not produce a low enough structural ceiling to prove commodity competitiveness.

---

# 7. Random dependent IOPS are a separate constraint

DP6 RW5 requires at least:

R_read >= 1,048,576 * Q dependent reads/s.

Examples:

| Q | Mandatory dependent reads/s |
| ---: | ---: |
| 1 work/s | 1.049 million |
| 10 work/s | 10.486 million |
| 100 work/s | 104.858 million |
| 1,000 work/s | 1.049 billion |

and an equal count of logical mutations/writes.

This distinction is important.

Peak TB/s is not equivalent to billion-scale small, data-dependent random operations/s.

The public vendor pages used here do not provide a DP6-like effective random-access service rate.

Therefore:

effective random-I/O efficiency under DP6 is one of the largest unresolved attacker variables.

Classification:

UNKNOWN.

---

# 8. Compute-rate floor

The source establishes:

Argon BlaMka/work = 134,216,704.

The common RW5 path executes one mulh64 per step.

The current portable source computes mulh64 using four 32x32 products, so it contains:

4,194,304 source-level 32x32 multiply operations/work

in the mandatory common RW5 path.

Ignoring the separate constant multiply and all opcode-specific multiplications, the minimum source-level count is therefore:

138,411,008 32x32-multiply-like operations/work.

This is a logical operation count.

It is not a gate count.

Required rates:

| Q | Argon BlaMka/s | RW5 steps/s | Min source 32x32-multiply-like rate/s |
| ---: | ---: | ---: | ---: |
| 1 | 0.134 G | 0.00105 G | 0.138 G |
| 10 | 1.342 G | 0.0105 G | 1.384 G |
| 100 | 13.422 G | 0.1049 G | 13.841 G |
| 1,000 | 134.217 G | 1.049 G | 138.411 G |

For an idealized unit producing one 32x32 product/cycle at 1 GHz, the multiplication-rate lower bound corresponds to about:

0.1384 multiplier-equivalent units per work/s.

Thus even 1,000 work/s implies on the order of 138 such idealized result/cycle units before opcode-specific work.

This is substantial but not obviously prohibitive for a custom accelerator.

Therefore compute operation count alone does not prove a large specialized economic floor.

---

# 9. FPGA evidence as PPA calibration boundary

Existing HLS synthesis evidence for the frozen implementation reports approximately:

- 310,980 LUT;
- 167,160 FF;
- 59 DSP;
- 13 BRAM18K;
- estimated HLS Fmax ~315.81 MHz.

R3-T1 subsequently achieved physical timing closure at requested local 166.667 MHz with:

- WNS +0.023269 ns;
- TNS 0;
- WHS +0.009551 ns;
- THS 0;
- zero routing errors.

This proves:

DP6 can be physically realized in the tested FPGA architecture.

It does not prove:

- ASIC mm2;
- ASIC joules/work;
- ASIC clock;
- ASIC voltage;
- ASIC package cost;
- ASIC memory cost;
- custom interconnect cost.

FPGA LUT/routing/HLS overhead is precisely what a competent specialized implementation is allowed to remove.

Therefore FPGA resource counts are an implementation upper/calibration anchor, not a specialist lower bound.

---

# 10. Parametric area / capex envelope

Let:

k_mem = installed memory + memory-interface + attributable package cost per byte.

a_mul = area/cost coefficient for a required multiply-capable datapath.

a_ctrl = controller/interconnect area/cost.

f = chosen compute clock.

eta_mul = sustained useful multiplier result rate per physical multiplier per cycle after dependencies/scheduling.

Then memory capex per throughput must satisfy, for a full-memory attacker:

K_mem / Q >= k_mem * M_context * S * L_eff.

The compute resource lower bound is parameterized by:

N_mul >= Q * N_mul_work / (f * eta_mul)

with:

N_mul_work >= 138,411,008 source-level 32x32-multiply-like operations/work

under the source decomposition used for this bound.

A complete area/capex model therefore has the structure:

K_fixed/Q >=
  k_mem * M_context * S * L_eff
  + k_compute * N_compute(Q,f,eta)
  + k_controller
  + k_package
  + k_power_delivery.

RP-B2 closes the symbolic structure.

It cannot assign robust values to the k coefficients from current evidence.

---

# 11. Parametric energy floor

Similarly define:

e_mem_read = energy attributable to one effective dependent memory read;
e_mem_write = energy attributable to one mutation/write;
e_mul32 = energy for one relevant 32x32 multiply-class operation;
E_other = remaining Argon/RW5/control/interconnect energy.

Then:

E_work >=
  E_argon_memory
  + S * (e_mem_read + e_mem_write)
  + 138,411,008 * e_mul32
  + E_other.

This equation is a valid decomposition.

It is not a numeric joules/work floor because current evidence does not establish technology-independent lower bounds for those energy coefficients.

Node, voltage, SRAM/DRAM choice, physical distance, controller design and operating frequency materially change them.

---

# 12. On-die SRAM challenge

The latency floor must also survive an attacker choosing faster but more expensive memory.

RandomX design rationale explicitly considers the possibility of hundreds of MiB or more of SRAM on advanced custom silicon and therefore uses a substantially larger fast-mining dataset as part of its device-binding approach.

That rationale is not directly transferable to DP6 economics.

It is a valid adversarial challenge:

a DP6 attacker can move along a frontier:

lower latency + higher memory area/capex

versus

higher latency + lower-cost external memory + more contexts.

Therefore no single DRAM latency value can be frozen as the attacker lower bound.

The specialized economic problem is an optimization over memory technologies.

---

# 13. BlaMka fixed-function prior art

Argon2's design explicitly adds 64-bit multiplication-derived BlaMka operations to increase ASIC circuit depth while retaining useful general-purpose performance characteristics.

Prior hardware work has implemented BlaMka/permutation logic in ASIC technology.

This strongly supports:

fixed-function BlaMka is technically feasible.

It does not establish:

the complete DP6 ASIC cost.

Therefore the defender may not count "heterogeneous arithmetic exists" as proof that specialization cannot implement it.

RW5 must be evaluated by incremental PPA, not by instruction diversity alone.

---

# 14. Financial full-memory cost floor

The requested question is:

Can RP-B2 now produce a conservative lower bound in currency/valid-work?

Result:

NO_DEFENSIBLE_ABSOLUTE_FINANCIAL_FLOOR_FROM_CURRENT_EVIDENCE.

The missing coefficients are economically first-order:

- wholesale installed DDR/GDDR/HBM cost;
- HBM interposer/package cost and yield;
- custom silicon die area/yield;
- memory PHY/controller area;
- custom RW5/Argon compute PPA;
- board and power-delivery cost;
- cooling;
- utilization;
- lifetime;
- maintenance;
- production scale;
- electricity price.

Public vendor pages establish availability and architecture, but do not supply a procurement/packaging/foundry quote usable as a conservative lower bound.

Any absolute $/work number generated now would be fabricated precision.

---

# 15. What RP-B2 does bound financially

Although an absolute dollar value is unavailable, the exact break-even variables are now localized.

For installed memory price k_mem expressed as currency/byte:

memory capex per unit throughput has a hard full-memory form:

K_mem/Q >= k_mem * 256 MiB * 1,048,576 * L_eff.

At L_eff = 100 ns:

memory capacity required per 1 work/s >= 26.84 MiB.

Thus:

K_mem/Q >= k_mem * 26.84 MiB.

At 50 ns:

>= k_mem * 13.42 MiB per work/s.

At 150 ns:

>= k_mem * 40.27 MiB per work/s.

This turns the remaining uncertainty into a small set of measurable coefficients rather than a vague claim.

---

# 16. Historical commodity energy reference only

Existing historical/reference evidence gives approximately:

same-laptop browser:
- 73.2 W;
- 3.079401 work/s;
- ~23.77 J/work.

RTX 2070 Max-Q:
- ~104.51 W;
- 2.489987 work/s;
- ~41.97 J/work.

These are not canonical four-class Representative Device evidence.

They can only expose sensitivity.

Ignoring wear and capex, at equal electricity price, a specialist would need energy/work below the corresponding commodity marginal-energy value to undercut energy-only mining cost.

If specialist electricity is cheaper, its allowed J/work rises proportionally.

Therefore electricity geography alone can materially shift the viability boundary.

---

# 17. Bounded Project Assurance attack on RP-B2

## Attack: reduce L_eff

Use SRAM/on-package cache or faster custom memory.

Effect:
capacity-throughput bound shrinks linearly with L_eff.

Counter-cost:
memory area/capex may rise.

Status:
MODEL SURVIVES; financial optimum remains UNKNOWN.

## Attack: increase context count

Add external/HBM/GDDR capacity and interleave more works.

Effect:
hides latency.

Counter-cost:
capacity and package scale with contexts.

Status:
MODEL SURVIVES; this is exactly captured by M_total/Q floor.

## Attack: share compute more aggressively

Time-multiplex Argon/RW5 units across contexts.

Effect:
reduces compute area/context.

Counter:
operation-rate floor remains.

Status:
MODEL SURVIVES; absolute area remains UNKNOWN.

## Attack: fully pipeline multipliers

Use deeply pipelined arithmetic and cross-context issue.

Effect:
reduces multiplier count needed for a target Q.

Counter:
operation-rate conservation remains.

Status:
MODEL SURVIVES; compute count does not force high cost by itself.

## Attack: exploit HBM4/GDDR7 bandwidth

Use >TB/s memory.

Effect:
bulk bandwidth is less likely to bind.

Counter:
dependent random access and memory capacity still matter.

Status:
DP6 BULK-BANDWIDTH DEFENSE WEAKENED AS A PRIMARY ARGUMENT, not the whole premise.

## Attack: avoid HBM package cost

Use GDDR/DDR with more board area and contexts.

Effect:
potentially lower memory/package cost.

Counter:
higher latency may require more capacity/contexts.

Status:
PLAUSIBLE tradeoff; no public cost optimum.

## Attack: use on-die SRAM

Use lower latency to slash context count.

Effect:
capacity-throughput floor falls.

Counter:
very high memory silicon area/cost.

Status:
PLAUSIBLE; exactly why k_mem and L_eff must be optimized jointly.

## Attack: lower voltage/frequency

Trade peak performance for J/work.

Effect:
may improve specialist energy economics.

Counter:
more engines/contexts may be needed for target Q.

Status:
PLAUSIBLE; requires technology PPA.

## Assurance conclusion

RP-B2 survives the adversarial review as a correct parametric model.

The DP6 economic thesis does not become robust because all decisive coefficients remain implementation/technology-specific.

---

# 18. Evidence classifications after RP-B2

PROVEN_BY_EXISTING_EVIDENCE:

- DP6 full implementation/parity reality.
- R3-T1 physical timing closure for the tested FPGA implementation.
- ~256 MiB full-memory state/context.
- 1,048,576 mandatory dependent RW5 steps/work.
- 1,048,576 mandatory dependent RW5 reads and mutations/work.
- 134,216,704 Argon BlaMka operations/work.
- source-derived ~528-784 MiB full-memory logical traffic interval before extra RW5 accesses.
- full-memory capacity-throughput equation conditional on L_eff.
- operation-rate conservation equations.

STRONGLY_SUPPORTED:

- a specialized miner can use many memory contexts with fewer shared compute engines.
- high-capacity, multi-TB/s HBM/GDDR is commercially available to custom accelerators.
- custom silicon can remove material FPGA/HLS/routing overhead.
- fixed-function/microcoded Argon/BlaMka computation is technically plausible.
- bulk peak bandwidth alone is unlikely to be the sole decisive DP6 limiter.

PLAUSIBLE:

- dependent random-I/O service rate becomes a dominant practical specialized bottleneck.
- RW5 mutation increases the cost of aggressive recomputation/TMTO.
- HBM/GDDR/DDR/SRAM each occupy different points on a latency-capex-energy frontier.
- a specialized miner may achieve materially better joules/work than commodity implementations.

UNKNOWN:

- optimal L_eff for the cheapest specialized architecture.
- random-access efficiency under DP6.
- contexts/compute-engine optimum.
- ASIC mm2.
- ASIC clock/voltage optimum.
- joules/work.
- installed memory/package cost.
- total specialist capex.
- specialist LCVW.
- whether specialist LCVW crosses the commodity viability vector.
- marginal economic value of RW5.
- canonical four-class commodity MCVW.

FALSIFIED:

- one full compute engine is required per 256 MiB context.
- seriality within one work alone imposes a low aggregate-throughput bound.
- current FPGA timing difficulty is a sufficient ASIC economic proxy.
- 256 MiB capacity by itself proves specialized-hardware resistance.
- peak work/s ratio alone is the correct economic comparison.

---

# 19. Information value of physical AWS after RP-B2

The result does not justify re-opening AWS.

Another timing build:
NO_LONGER_JUSTIFIED.

AFI creation:
REDUNDANT_AT_PRESENT.

F2 parity/runtime:
CONDITIONALLY_REQUIRED only if a later technology-calibrated model identifies that exact FPGA runtime result as a calibration point that can change the decision.

FPGA benchmark:
REDUNDANT_AT_PRESENT for the specialist economic bound.

Existing-family attacker sweep:
NO_LONGER_JUSTIFIED.

Sustained/HFB:
CONDITIONALLY_REQUIRED only after both:
- specialist cost/PPA interval is calibrated;
- canonical commodity physical evidence exists.

Therefore:

CURRENT_INFORMATION_GAIN_OF_NEW_AWS = INSUFFICIENT_TO_REOPEN.

---

# 20. Exact next frontier and authority boundary

RP-B2 has reached analytical technical closure under current authority.

The exact next specialized frontier is:

RP-B3 — Technology-Calibrated Specialized PPA Evidence Gate

Required purpose:

replace the unknown PPA coefficients with evidence.

The smallest useful form would be one of:

1. a non-production, frozen-DP6 RTL/gate-level synthesis/PPA study against a named standard-cell technology/library plus a named memory PHY/package model; or

2. independent specialist-hardware PPA evidence/quote sufficient to bound:
   - area;
   - power;
   - frequency;
   - memory-interface cost;
   - installed memory/package cost;
   - expected utilization;
   - capex.

This frontier is not executed in RP-B2.

It creates a new specialized implementation/modeling artifact beyond the source-only/read-only analytical envelope and therefore requires explicit new authority and an admissible tool/library/evidence source.

In parallel, the already-prepared Representative Device campaign remains the physical commodity-side dependency.

The two sides must ultimately meet:

specialist LCVW interval
versus
commodity A_max,i / MCVW_i vector.

---

# 21. Terminal disposition

Terminal classification:

STRONG_HEURISTIC_NEEDS_SPECIALIZED_BOUND_EVIDENCE

ASIC Lab:

HOLD remains mandatory.

Reason:

RP-B2 derived meaningful source-level capacity-throughput, bandwidth, random-I/O and operation-rate floors, but none converts into a defensible absolute cost/work without technology-specific PPA and procurement evidence.

New AWS physical evidence:

NOT JUSTIFIED NOW.

The missing evidence is not another FPGA routing/timing datapoint.

It is:

technology-calibrated specialized PPA/economic evidence

plus, in parallel:

canonical Representative Device physical evidence.

Exact next frontier:

RP-B3 — Technology-Calibrated Specialized PPA Evidence Gate

State:

GENUINE AUTHORITY / EXTERNAL-EVIDENCE GATE.

Evidence before status.

Memory suggests. Evidence decides.

Explore with strong heuristics. Commit on robust premises.

---

# 22. References

Internal:

- FAE_DP6_RP_B1_SPECIALIZED_ATTACKER_BOUND_AND_COMMODITY_VIABILITY
- FAE_DP6_RP_B2_SPECIALIZED_PPA_ENVELOPE_MODEL.json
- labs/asic-f2-pre-go/hls/fae_dp6_hls.cpp
- labs/asic-f2-pre-go/BASELINE.json
- labs/asic-f2-pre-go/build-colony/timing-hardening-001/hls-synthesis-verification/RESULT.json
- labs/asic-f2-pre-go/runtime/F2_A3_R4_CONTROL_REPAIR_R3T1_PHYSICAL_PROVIDER_RESULT.json
- labs/asic-f2-pre-go/runtime/FAE_DP6_ROBUST_PREMISE_REVIEW_HOLD.json
- lab/representative-device-evidence-readiness/acceptance-contract.json

External prior art / architecture anchors:

- RFC 9106, Argon2 Memory-Hard Function for Password Hashing and Proof-of-Work Applications
  https://www.rfc-editor.org/info/rfc9106/

- RandomX design rationale
  https://github.com/tevador/RandomX/blob/master/doc/design.md

- Micron HBM3E
  https://www.micron.com/products/memory/hbm/hbm3e

- Micron HBM4
  https://www.micron.com/products/memory/hbm/hbm4

- Micron GDDR7
  https://www.micron.com/products/memory/graphics-memory/gddr7

- J. F. Rossetti and W. V. Ruggiero, Hardware implementation for permutation function of multiplication-hardened sponge BlaMka, LASCAS 2017, DOI 10.1109/LASCAS.2017.7948054.

External evidence is used for architecture plausibility and prior-art calibration only.
It is not represented as direct DP6 ASIC measurement.
