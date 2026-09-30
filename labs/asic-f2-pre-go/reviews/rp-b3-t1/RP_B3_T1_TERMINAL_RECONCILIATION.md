# RP-B3-T1 — Terminal Reconciliation

## Evidence admitted

GitHub Actions run **36656132054**, artifact **11073562201**, source revision `1be683b465a061f0e666af8695d8b6604e615022`.

Artifact SHA-256:

`bd3a062c31614a1b089f42caae7c17929e9697f0d41f285c499c0cf036f5ddcb`

The job-level conclusion is failure only because the post-run branch persistence step failed. The PPA executor step and artifact upload step both completed successfully.

## Admission ordering

- C6 identity: **PASS**
- C6 equivalence: **PASS_EQUIVALENCE**
- ORFS/ASAP7 provenance: **PASS**
- slang acceptance of unchanged generated C6 RTL: **PASS**
- standard-cell technology mapping: **PASS**
- valid SDC/STA: **FAIL-CLOSED**
- placement/routing: **NOT ATTEMPTED**
- power: **NOT ADMITTED**

The first observable divergence after mapping was:

`constraint.sdc line 5: invalid command name remove_from_collection`

This is a harness/constraint compatibility boundary. It is not evidence of semantic failure or ASIC infeasibility.

## Technology-mapped area points

| View | Mapped cells | ODB instances | ASAP7 mapped standard-cell area |
| --- | ---: | ---: | ---: |
| Full DP6 | 589,290 | 565,842 | 79,597.7 µm² = **0.0795977 mm²** |
| Argon | 309,700 | 301,864 | 42,277 µm² = **0.042277 mm²** |
| RW5 | 78,221 | 69,164 | 9,316.05 µm² = **0.00931605 mm²** |

The 1 ns and 2 ns full labels produced the same mapping because the SDC was not admitted for timing. They are **not** frequency-sensitivity evidence.

Standalone submodule areas are not assumed to add exactly to full-DP6 area.

## Economic interpretation

This is meaningful adverse evidence against a defender-friendly assumption that specialized DP6 logic must itself be large.

The full mapped logic point is only about **0.0796 mm²** on the ASAP7 predictive platform. Against the previously established 7 nm dense-SRAM pure-bitcell sensitivity of ~57.98 mm² for one 256 MiB context, the memory cell array is about **728×** the mapped full-DP6 logic area.

This does **not** mean a real DP6 ASIC occupies 0.0796 mm². It excludes the principal memory, PHY/controller, package, placement/routing overhead, and has no valid timing or power result.

It does mean the resistance thesis cannot rely on logic-area burden.

## Terminal disposition

**Robust Premise disposition: `STRONG_HEURISTIC_ONLY`.**

RP-B3 classification remains:

`STRONG_HEURISTIC_NEEDS_SPECIALIZED_BOUND_EVIDENCE`

The evidence mildly weakens the central economic proposition but does not falsify it. Timing, power, random-access efficiency, memory/package cost, specialist capex and specialist LCVW remain unresolved.

**ASIC Lab: HOLD remains mandatory.**

**NEW_AWS_INFORMATION_GAIN: INSUFFICIENT_TO_REOPEN.**

Another AWS/FPGA run would not resolve the standard-cell timing/power or memory/package-economic gaps.

## Physical evidence

No new AWS/FPGA physical evidence is justified now.

The minimum eventual physical dependency relevant to the commodity side remains the already frozen **Representative Device** evidence contract across all four required device classes. It must not be replaced by another FPGA proxy.

## Next frontier

If further analytical execution is authorized despite the current instruction not to repeat PPA, the exact next frontier is:

**RP-B3-T2 — ASAP7 STA/Power Closure on unchanged C6**

Scope: one bounded non-production analytical execution using the unchanged parity-bound C6 and an OpenSTA-compatible SDC solely to obtain valid timing/power/placement evidence.

No DP6 semantic change, AWS FPGA, AFI, F2, physical benchmark, consensus/economics change, release or activation is implied.

Evidence before status.  
Fail closed.  
Memory suggests. Evidence decides.  
Absence of falsification is not proof of robustness.
