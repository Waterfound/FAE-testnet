# FAE_DP6_RP_B3_TECHNOLOGY_CALIBRATED_SPECIALIZED_PPA_EVIDENCE_GATE

Date: 2026-09-29
Authority: non-production research/evidence/modeling only
Repository: Waterfound/FAE-testnet
Branch: evidence/fae-dp6-rp-b3-20260929

## Terminal classification

STRONG_HEURISTIC_NEEDS_SPECIALIZED_BOUND_EVIDENCE

RP-B3 reached technical closure under the currently authorized analytical environment.

It successfully replaced several previously uncalibrated coefficients with technology-specific evidence or bounded implementation points.

It did not produce a defensible full specialist LCVW interval in currency.

The remaining blocker is not another FPGA/AWS datapoint.

It is a genuine tool/library/external-evidence gate for a frozen-DP6 standard-cell PPA calibration plus a transferable memory/package cost model.

ASIC Lab remains HOLD.

No AWS execution, physical build, AFI, F2, FPGA benchmark, physical attacker sweep, sustained/HFB, DP6 implementation change, alternative consensus algorithm, consensus/economics change, release, activation-height change, testnet activation or mainnet action occurred.

---

# 1. Smallest valid RP-B3

The current repository contains the frozen DP6 HLS/C++ implementation and FPGA integration/implementation TCL, but no committed generated DP6 Verilog/SystemVerilog netlist suitable for standard-cell ASIC synthesis.

The local runtime was checked for:

- yosys;
- openroad;
- abc;
- verilator;
- iverilog;
- nextpnr;
- magic;
- netgen.

None is installed.

No named standard-cell library/PDK or hard memory PHY macro is present in the current runtime.

Therefore a reproducible full-DP6 named-library gate-level PPA run cannot be honestly executed in this environment without introducing a new toolchain/library/netlist artifact.

The smallest admissible RP-B3 therefore consists of:

1. technology-calibrated independent PPA evidence for directly reusable DP6 primitives;
2. technology-calibrated memory density/latency/energy evidence for attacker memory families;
3. technology-calibrated controller/PHY implementation points;
4. explicit classification of what remains non-transferable;
5. exact gate request for the missing full-DP6 PPA experiment.

---

# 2. BlaMka ASIC calibration

Published USP/Lyra2 hardware evaluation reports ASIC synthesis of the 256-bit BlaMka G function using Synopsys Design Compiler and the SAED EDK 90nm library.

Generic BlaMka G implementation:

- area: 107,088 um2 = 0.107088 mm2;
- total power: 485 uW;
- max frequency: 214.592 MHz;
- throughput: 3.433 Gbit/s for the 256-bit G function.

Optimized variant:

- area: 142,911 um2 = 0.142911 mm2;
- total power: 637 uW;
- max frequency: 245.700 MHz;
- throughput: 3.145 Gbit/s.

These results are for one G function only, not Argon2 and not DP6.

The generic implementation is the more attacker-favorable area/throughput point.

Frozen DP6 Argon fill invokes:

128 G/AG functions per fill_block

over:

262,142 fill blocks.

Therefore:

33,554,176 BlaMka G functions/work.

At 3.433 Gbit/s / 256 bit per G:

13.410156 million G/s per published generic unit.

If this old 90nm primitive were replicated linearly only to service the Argon G workload:

- one unit corresponds to about 0.3997 Argon-work/s;
- area scales to about 0.268 mm2 per Argon-work/s;
- primitive dynamic power scales to about 1.214 mW per Argon-work/s;
- primitive energy scales to about 1.214 mJ per Argon work.

Epistemic interpretation:

PROVEN_BY_EVIDENCE:
a compact fixed-function BlaMka G implementation is feasible in a named 90nm standard-cell library.

STRONGLY_SUPPORTED:
BlaMka arithmetic by itself is not a strong economic floor for a competent attacker.

UNKNOWN:
full Argon2/DP6 ASIC area and energy.

The published point is an attacker-achievability point, not a future-ASIC lower bound.
A more advanced implementation may be smaller or more efficient.

---

# 3. On-die SRAM attacker calibration

## 7nm dense bitcell

A published 7nm FinFET SRAM demonstrates a 0.027 um2 high-density 6T bitcell.

Frozen DP6 full-memory context:

256 MiB = 2,147,483,648 bits.

Pure bitcell area at that published geometry:

approximately 57.98 mm2 per 256 MiB context.

This excludes:

- decoders;
- sense amplifiers;
- word/bit lines;
- redundancy;
- ECC;
- banking;
- routing;
- controller;
- I/O.

Therefore:

57.98 mm2/context is a technology-specific cell-array-only floor at that bitcell geometry.

It is not a universal future-node floor.

## 16nm macro density

A measured 16nm FinFET 1W1R two-port SRAM reports:

- density: 6.05 Mbit/mm2;
- read access: 313 ps;
- voltage: 0.8 V.

At identical macro density, 256 MiB would occupy approximately:

354.96 mm2/context.

Because this is a two-port macro and DP6 may choose a different organization, this is not a strict lower bound.

It is a demonstrated macro-density/latency point.

## Consequence

The highest-information conclusion is not:

"SRAM makes DP6 impossible."

It is:

a full-state on-die SRAM attacker pays a visibly large silicon-area price even before compute.

Therefore the strongest economic attacker is more plausibly:

external/stacked DRAM for full state + smaller SRAM/cache/hot structures,

unless future technology evidence shows a better SRAM/eDRAM point.

Classification:

- large area burden of full-state on-die SRAM: STRONGLY_SUPPORTED;
- exact optimal SRAM fraction: UNKNOWN;
- exact SRAM miner LCVW: UNKNOWN.

---

# 4. External memory energy calibration

## HBM2

MICRO-50 Fine-Grained DRAM analysis gives approximately 3.97 pJ/bit for HBM2 access energy, with most energy inside the DRAM/data path rather than the interposer I/O.

Applying this only as an attacker-favorable component-energy anchor to the already established 528-784 MiB logical traffic/work gives:

approximately 17.6-26.1 mJ/work.

This is not a DP6 whole-miner energy measurement.

Random fine-grained access, row activation, controller behavior and extra RW5 accesses can increase it.

## GDDR7

Micron's current GDDR7 product information lists, for a representative 384-I/O system:

- 24 GB frame-buffer example;
- 1,344-1,536 GB/s system bandwidth;
- average device power: 4.5 pJ/bit.

Applying 4.5 pJ/bit to the same logical traffic interval gives an attacker-favorable component-energy anchor of:

approximately 19.9-29.6 mJ/work.

Again, this is not achieved DP6 energy.

## HBM4

Micron HBM4 36GB 12H is in high-volume production in 2026 and specifies:

- >11 Gb/s pin speed;
- >2.8 TB/s per stack;
- >20% power-efficiency improvement over HBM3E.

An independent 2026 UCLA HBM architecture model projects an HBM4 configuration with:

- 64 GB;
- 2,048 GB/s;
- 2.6502 pJ/bit modeled energy;
- 74.1885 ns modeled worst-case latency;
- 108.8597 mm2 modeled memory-die area;
- 153.0775 mm2 modeled base-die area.

Because that HBM4 result is projection/modeling rather than measured DP6 silicon, classification is PLAUSIBLE, not PROVEN.

Using 2.6502 pJ/bit only as sensitivity produces:

approximately 11.7-17.4 mJ/work

for the established logical traffic interval.

## Consequence

The memory dynamic-energy term alone does not create a reassuring DP6 energy floor.

Existing historical commodity whole-system references are tens of joules/work, whereas attacker-favorable DRAM component-energy anchors are in tens of millijoules/work.

The comparison is not apples-to-apples and cannot be turned into a specialist advantage ratio.

But it falsifies a stronger defensive assumption:

"the memory transfer energy alone must be close to commodity whole-system energy."

Classification:

FALSIFIED.

---

# 5. PHY/controller calibration

## LPDDR4 PHY

A published 10nm FinFET all-digital 16-bit LPDDR4 PHY test chip reports:

- 4.4 Gbit/s/pin;
- 0.69 V operation;
- 0.57 mm2 including PLL.

This proves that high-speed DRAM PHY area can be sub-mm2 for a narrow interface at 10nm.

No linear scaling to GDDR/HBM width is assumed.

## 28nm DDR PHY examples

Published 28nm SoC/testchip evidence places complete DDR PHY blocks in the multi-mm2 range, with examples around 5.61-7.04 mm2.

These are architecture points, not DP6-specific bounds.

## Controller logic

A published GlobalFoundries 12LP+ LPDDR4 controller implementation reports roughly:

- 0.118 mm2 total cell area;
- 0.166 mm2 placed core footprint.

The same work separates DFI/PHY-interface conversion logic from a complete hard mixed-signal PHY.

Therefore:

controller digital logic can be compact;

complete PHY area/power remains interface- and technology-specific.

## HBM4

GUC demonstrated a functional 12 Gbit/s HBM4 controller+PHY platform on TSMC 3nm in 2026 and reports:

- 2.5x bandwidth vs prior HBM3E;
- 1.5x better power efficiency;
- 2x better area efficiency.

The primary release does not disclose absolute mm2 or W.

Trade reporting around Hot Chips 2026 quotes larger HBM4 PHY footprints/power, but because absolute numbers are secondary-source and architecture-specific, RP-B3 does not promote them to a hard DP6 coefficient.

Classification:

- memory controller logic area: BOUNDED BY IMPLEMENTATION POINT;
- narrow LPDDR PHY area/frequency: BOUNDED BY IMPLEMENTATION POINT;
- complete DP6 GDDR/HBM PHY area/power: UNKNOWN;
- complete DP6 memory-interface package cost: UNKNOWN.

---

# 6. Package/interposer and installed-memory cost

Academic/open cost models agree on the structure:

package/interposer cost depends on:

- die/interposer area;
- wafer/process cost;
- yield;
- bonding;
- assembly;
- substrate;
- test;
- number of chiplets/stacks.

However current public evidence does not provide an authoritative, transferable procurement/foundry quote that can serve as a conservative lower bound for a DP6 miner.

Similarly:

HBM/GDDR/DDR product specifications expose capacity, bandwidth and sometimes energy,

but not a high-volume installed-memory $/GB floor including PHY/controller/package.

Therefore:

- package/interposer absolute cost: UNKNOWN;
- installed HBM $/GB: UNKNOWN;
- installed GDDR $/GB: UNKNOWN;
- installed DDR $/GB for a custom mining product: UNKNOWN.

No dollar values are fabricated.

---

# 7. Process-node / voltage / frequency envelope

RP-B3 does not scale a 90nm BlaMka result to 7nm/3nm with a naive geometric factor.

That would create false precision.

The evidence establishes discrete technology points instead:

Compute:
- BlaMka G fixed-function: 90nm SAED, 214.592 MHz demonstrated synthesis point.

SRAM:
- 16nm macro: 313 ps at 0.8V.
- 7nm dense bitcell: 0.027 um2.

PHY:
- 10nm LPDDR4 PHY: 4.4 Gb/s/pin at 0.69V, 0.57 mm2.

HBM:
- HBM4 controller/PHY functional platform demonstrated at TSMC 3nm.
- 2026 HBM4 product availability >2.8 TB/s.

This proves large design-space freedom for a specialized miner.

The full-DP6 optimum frequency/voltage remains UNKNOWN.

The most adversarial architecture is therefore allowed to choose a lower frequency/voltage point if that minimizes joules/work or LCVW.

---

# 8. RW5 specialized PPA remains the central compute unknown

No independent frozen-RW5 ASIC implementation was found.

RW5 contains:

- fixed 32-op instruction set;
- dependent matrix accesses;
- multiply/mul-high;
- division/modulo;
- rotations;
- bit counting;
- conditionals;
- mutation;
- small live register state.

The strongest attacker may implement it as:

- microcoded engine;
- partially fixed-function datapath;
- shared rare units;
- many hardware contexts.

The FPGA/HLS resource counts cannot be converted to ASIC mm2.

Therefore:

RW5 ASIC area: UNKNOWN.
RW5 ASIC frequency: UNKNOWN.
RW5 ASIC energy/work: UNKNOWN.
RW5 contexts/engine optimum: UNKNOWN.

This is now the single most important compute-side coefficient gap.

---

# 9. Strongest plausible specialized architecture after calibration

The attacker envelope is narrowed to:

## Family A — capacity-first DDR/LPDDR

- large cheap external capacity;
- high latency;
- many resident contexts;
- shared compute engines;
- lower package complexity;
- lower bandwidth/random-I/O capability than HBM/GDDR.

Economic optimum:
UNKNOWN because installed $/GB and effective DP6 random service are not bounded.

## Family B — GDDR7-class

- 24GB-class conventional board memory example;
- ~1.3-1.5 TB/s vendor system bandwidth;
- ~4.5 pJ/bit vendor device energy;
- no interposer requirement;
- many contexts;
- shared fixed-function/microcoded compute.

This is a strong attacker family because it may avoid HBM packaging cost while retaining high bandwidth.

DP6 random-I/O efficiency:
UNKNOWN.

## Family C — HBM3E/HBM4-class

- 24-36GB+ capacity per stack commercially real;
- >1.2 to >2.8 TB/s;
- short/wide interface;
- high package/PHY complexity;
- lower component energy/bit;
- many contexts;
- custom controller/PHY and shared compute.

This is the strongest high-throughput attacker family.

Absolute package cost:
UNKNOWN.

## Family D — full on-die SRAM

- very low latency;
- removes external-memory interface bottleneck;
- but 256 MiB consumes at least ~58 mm2 of pure cells at the cited 7nm bitcell geometry;
- realistic macros are larger.

Likely role:
not the cheapest full-state store under current evidence.

Possible role:
hot structures/cache or a premium high-area design.

## Family E — hybrid

Strongest overall attacker:

external GDDR/HBM full-state memory
+
small on-die SRAM/cache
+
multiple resident contexts
+
fewer shared Argon/BlaMka engines
+
microcoded RW5
+
custom interconnect/controller/PHY
+
low-voltage/frequency optimization.

This remains the reference attacker.

---

# 10. Specialist energy interval

A complete specialist joules/work interval is NOT defensible.

What is defensible:

## Argon BlaMka primitive achievability point

Published 90nm generic implementation, linearly mapped to DP6 Argon G count:

~1.21 mJ/work.

This is not a floor and excludes most of the miner.

## Memory component sensitivity

HBM2-like:
~17.6-26.1 mJ/work for established logical traffic.

GDDR7 vendor-energy anchor:
~19.9-29.6 mJ/work.

Modeled HBM4:
~11.7-17.4 mJ/work.

These are component-only attacker-favorable sensitivities.

They omit:

- random-access amplification;
- RW5 extra accesses;
- BLAKE2/SHA;
- RW5 compute;
- controller/PHY;
- leakage;
- package/interconnect;
- PSU/cooling.

Therefore no summed full-miner interval is reported.

A naive sum would be false precision.

---

# 11. Specialist LCVW

Result:

SPECIALIST_LCVW_INTERVAL = UNKNOWN.

Reason:

the following coefficients remain first-order and unbounded:

- RW5 ASIC PPA;
- complete memory PHY power/area for the chosen family;
- effective DP6 random-I/O efficiency;
- installed memory/package cost;
- logic-die cost/yield;
- packaging/interposer cost/yield;
- board/power delivery;
- utilization/lifetime;
- electricity procurement;
- maintenance.

RP-B3 materially reduces technical uncertainty.

It does not reduce economic uncertainty enough to produce a currency/work interval.

---

# 12. Direction of evidence on the DP6 economic proposition

The central proposition became:

MORE_CONSTRAINED_AND_MILDLY_WEAKENED_BUT_NOT_FALSIFIED.

Why weaker:

1. fixed-function BlaMka has a demonstrated compact ASIC implementation point;
2. modern GDDR/HBM exposes very high bandwidth at low pJ/bit;
3. memory dynamic energy alone is orders of magnitude below historical commodity whole-system joules/work;
4. narrow DRAM PHY/controller logic can occupy modest silicon area;
5. a competent attacker has credible options besides the FPGA topology.

Why not falsified:

1. 256 MiB/context remains a real capacity burden;
2. dependent random service remains unbounded and may be costly;
3. full on-die SRAM has a large area burden;
4. RW5 ASIC PPA is unknown;
5. HBM/GDDR package/capex is unknown;
6. commodity canonical evidence is still pending;
7. no complete parity-correct specialist LCVW has been demonstrated below the commodity viability boundary.

---

# 13. New physical/AWS information gain

Nothing in RP-B3 raises the information value of another FPGA/AWS run enough to reopen the ASIC Lab.

Another AWS run would calibrate:

an FPGA implementation.

The decisive unknowns are now:

standard-cell RW5/DP6 PPA;
memory-interface PPA/cost;
package/capex;
commodity physical MCVW.

Therefore:

NEW_AWS_INFORMATION_GAIN = INSUFFICIENT_TO_REOPEN.

F2/benchmark/HFB may become useful later only after a technology-calibrated full-DP6 PPA interval exists and a specific calibration question is defined.

---

# 14. Genuine gate and minimum exact request

RP-B3 analytical work is closed under current authority.

The next frontier is:

RP-B3-T1 — Frozen-DP6 Named-Library Standard-Cell PPA Calibration

This is a genuine tool/library/external-evidence gate.

Minimum request:

Authorize or provide exactly one non-production ASIC PPA environment with:

1. Frozen DP6 RTL/netlist:
   - mechanically derived from the existing frozen DP6 semantics;
   - parity-bound to the canonical DP6 vectors;
   - no consensus/source change.

2. One named standard-cell technology/library:
   - legally accessible;
   - characterized for timing and power;
   - process/voltage/corner explicitly recorded.

3. One synthesis + STA + power flow:
   - e.g. Yosys/OpenROAD-compatible or equivalent commercial/academic flow;
   - local/non-production is sufficient;
   - no FPGA/AWS authority needed.

4. One named memory-interface model:
   - DDR/GDDR or HBM controller/PHY/package assumptions;
   - explicit area/power/latency/bandwidth/cost provenance;
   - no invented procurement price.

The requested authority is ONLY to generate technology-calibrated research PPA artifacts.

It does NOT include:

- AWS;
- FPGA build;
- AFI;
- F2;
- physical benchmark;
- physical attacker sweep;
- sustained/HFB;
- consensus/economics change;
- release;
- activation;
- mainnet.

If a full RTL/netlist cannot be produced without changing semantics, the run must fail closed.

---

# 15. Terminal disposition

Terminal classification:

STRONG_HEURISTIC_NEEDS_SPECIALIZED_BOUND_EVIDENCE

Coefficients moved from UNKNOWN to bounded/anchored:

- fixed-function BlaMka G area/power/frequency/throughput at SAED 90nm;
- on-die SRAM dense-cell area at 7nm;
- 16nm SRAM macro density/read-latency point;
- HBM2 access-energy point;
- GDDR7 vendor energy/bandwidth/capacity point;
- HBM4 commercial capacity/bandwidth availability;
- modeled HBM4 latency/energy/die-area sensitivity;
- 10nm LPDDR4 PHY area/frequency/voltage point;
- 12LP+ DRAM controller logic area point.

Still UNKNOWN:

- full DP6 ASIC mm2;
- full DP6 frequency/voltage optimum;
- RW5 ASIC area/power;
- complete HBM/GDDR PHY area/power for a DP6 miner;
- effective DP6 random-I/O efficiency;
- installed memory cost;
- package/interposer cost;
- logic die/yield cost;
- specialist capex;
- full specialist J/work;
- specialist LCVW.

Exact next frontier:

RP-B3-T1 — Frozen-DP6 Named-Library Standard-Cell PPA Calibration.

ASIC Lab:

HOLD remains mandatory.

New AWS:

do not reopen.

Evidence before status.
Memory suggests. Evidence decides.
Explore with strong heuristics. Commit on robust premises.
