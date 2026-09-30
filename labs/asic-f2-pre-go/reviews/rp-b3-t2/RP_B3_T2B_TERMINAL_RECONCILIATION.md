# RP-B3-T2B — Area / Timing / Power / Energy-Work Reconciliation

## Admitted execution

GitHub Actions run: **36742292802**

Source revision:

`3ea20ce42e867797eb781e25cfc268cc7d308741`

All three matrix jobs completed SUCCESS:

- full;
- argon;
- rw5.

Artifacts:

- full: `11113737060`, SHA-256 `5537c65fd79dd4d777cc05f6b5e91c0e3c72a7508754e4a0025b57eb96f3fb75`;
- argon: `11111282755`, SHA-256 `7306c9652291b25fa04902859458d7be7595c93b89ccc854c7143cd2f924b31f`;
- rw5: `11112226105`, SHA-256 `68e7dfb39a40ba413b15c01539ff0888cc0c91060fe1ffe4bc662df95df02724`.

Downloaded artifact hashes matched the GitHub artifact digests.

No STA/Power rerun was performed during reconciliation.

C6 remains unchanged and bound to:

`c0bf48c3864b72352ba57a2d6c17175c1c6a59dffae52c8fa73a5d346bc60a33`

Equivalence remains **PASS_EQUIVALENCE**.

## Platform

- OpenROAD-flow-scripts commit: `a12d46907510891a2e3d3310abdd19975d28db0e`;
- ASAP7 tree: `102f845a9d321d1a0f7db10434ad84e54c0334b5`;
- container: `openroad/orfs@sha256:fbba994b8e518c9678cfff25a7b7b80328394adfb71b6afafba8df3e5a1359ca`;
- Yosys: 0.68+post;
- frontend: slang;
- ASAP7 predictive 7 nm, BC, 25 C, 0.77 V, NLDM, RVT;
- target clock: 5500 ps = 181.818 MHz.

ASAP7 remains a predictive research platform and is not production-foundry evidence.

## Full DP6

At CTS:

- standard-cell area: **0.0856683 mm²**;
- allocated core: **0.227512 mm²**;
- allocated die/block: **0.231596 mm²**;
- macros: 0;
- minimum period: **3371.91 ps**;
- predictive fmax: **296.568 MHz**;
- setup TNS: 0;
- hold TNS: 0;
- worst setup slack against 5.5 ns target: **+2128.09 ps**;
- statistical power: **89.1599 mW**.

The final critical path is in:

`dp6_run_bytes -> argon2d_fixed -> blake2b_long -> b2update/b2compress`

rather than the RW5 datapath.

## Argon standalone

Synthesis calibration:

- standard-cell area: **0.048648 mm²**;
- fmax: **367.389 MHz**;
- statistical power: **33.3661 mW**.

Its critical path is BLAKE2b-side.

## RW5 standalone

Synthesis calibration:

- standard-cell area: **0.0104976 mm²**;
- fmax: **388.653 MHz**;
- statistical power: **9.26615 mW**.

RW5 therefore occupies about 12.3% of the full CTS standard-cell area as a standalone/non-additive comparison and has higher standalone fmax than the full design.

This does not make RW5 cheap per work: the frozen semantics still require 1,048,576 dependent RW5 steps/work and memory mutation.

It does show that **raw RW5 logic area and critical-path frequency are not the demonstrated specialization bottleneck**.

## Power boundary

No VCD or SAIF was supplied.

Power is therefore an OpenROAD statistical/predictive sensitivity, not measured DP6 workload power.

The full CTS result corresponds to approximately:

**490.38 pJ per target-clock cycle**

at 5.5 ns under that statistical activity model.

The defensible energy/work relation is therefore:

`E_logic/work = N_specialist_cycles/work × 490.38 pJ`

where `N_specialist_cycles/work` remains UNKNOWN for the optimized specialized attacker.

A numeric complete logic J/work value is not admitted.

## Integration with the inherited HBM4 attacker model

The inherited HBM4 component-energy sensitivity is:

**11.74–17.43 mJ/work**.

Under the full statistical logic power point, memory energy equals logic energy at approximately:

**23.9–35.5 million logic cycles/work**.

This is a sensitivity boundary, not a predicted schedule.

Using the inherited HBM4 modeled latency of 74.1885 ns and 36 GB / ~134.11 raw contexts:

- capacity/latency ceiling: ~**1724 work/s**;
- prior bulk-bandwidth ceiling: ~**3406–5057 work/s**.

Thus the current HBM4 model makes dependent-latency/context capacity more restrictive than peak bulk bandwidth before compute.

Neither number is achieved DP6 throughput.

## Replication envelope

The new full-DP6 logic area is small enough that compute replication is economically plausible from an area perspective.

At 134.11 raw memory contexts:

- one full standard-cell engine/context would linearly total ~**11.49 mm²** of cells;
- naively duplicating the 40%-utilization core footprint would total ~**30.51 mm²**;
- statistical logic power at the 5.5 ns point would linearly total ~**11.96 W**.

These values deliberately over-duplicate control/clock structures and omit the memory PHY/package.

They are a sensitivity envelope, not an optimized miner.

This evidence strengthens the attacker model of many resident contexts with shared or selectively replicated compute.

## Area interpretation

The previously admitted 7 nm SRAM bitcell sensitivity for one 256 MiB context was ~57.98 mm² of pure cells.

Compared with the full CTS standard-cell area, that is roughly **677× larger**.

Even against the allocated full logic core footprint, it is roughly **255× larger**.

Therefore the specialized economic bound is now clearly **memory-system dominated rather than raw logic-area dominated**.

## Economic disposition

The new evidence moves these coefficients from UNKNOWN to technology-calibrated/bounded:

- full DP6 logic area;
- Argon logic area;
- RW5 logic area;
- full/Argon/RW5 predictive timing;
- full critical-path family;
- predictive statistical logic power;
- logic energy per clock-cycle sensitivity.

Still UNKNOWN:

- optimized specialist cycles/work;
- workload-trace power;
- complete joules/valid-work;
- effective DP6 random-dependent access efficiency;
- memory-controller/PHY/package PPA;
- installed memory/package cost;
- production die/yield economics;
- board/cooling/power delivery;
- specialist capex;
- utilization/lifetime/maintenance;
- specialist LCVW;
- canonical commodity MCVW vector.

The central economic ASIC-resistance proposition is therefore:

**WEAKENED, NOT FALSIFIED, AND STILL INCONCLUSIVE.**

The logic-side specialized bound is closed.

The memory-system/economic bound is not.

## Terminal disposition

Robust Premise disposition remains:

**STRONG_HEURISTIC_ONLY**

Refinement:

`STRONG_HEURISTIC__LOGIC_PPA_BOUND_CLOSED__MEMORY_ECONOMIC_BOUND_OPEN`

No complete specialist LCVW interval is defensible.

ASIC Lab remains **HOLD**.

`NEW_AWS_INFORMATION_GAIN = INSUFFICIENT_TO_REOPEN`.

Another FPGA/AFI/F2 experiment does not resolve the remaining bound.

## Exact next frontier

**RP-B3-T3 — Specialized Memory-System / Random-I-O / Package Economic Bound**

This is currently a **genuine external-evidence gate**.

The minimum missing evidence is:

1. credible DP6-relevant or sufficiently transferable dependent-random HBM/GDDR service-rate efficiency;
2. a named controller/PHY/package area-power model for one attacker-favorable memory family;
3. defensible installed memory/package cost or an independent quote/cost model;
4. production-relevant yield/capex/utilization assumptions with provenance.

Representative Device evidence remains a separate commodity-side dependency and is not executed here.

No AWS, AFI, F2, physical build, physical benchmark, attacker sweep, sustained/HFB, DP6/DP7 change, consensus/economics change, release, activation or mainnet action occurred.

Evidence before status.  
Fail closed.  
Memory suggests. Evidence decides.  
Absence of falsification is not proof of robustness.
