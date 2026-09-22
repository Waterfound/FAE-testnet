# FAE ASIC Lab — AWS F2 paid execution plan

## Frozen authority boundary
This experiment targets **FAE-DP6 v0.7 frozen semantics** only. It has no wallet, testnet/mainnet connection, block submission, or consensus authority.

## Why F2 / why this flow
Target the smallest F2 runtime (`f2.6xlarge`, one VU47P). Use the current AWS FPGA Developer AMI and the `aws/aws-fpga` **f2** branch. The real-hardware path is **HLS (optional front end) -> RTL/IP -> Vivado/HDK -> AFI -> F2 runtime**. Do not depend on direct Vitis AFI generation.

## Paid stages — fail closed
1. **Build-only stage**: start the current FPGA Developer AMI on an x86-64 build instance; run `scripts/preflight_f2.sh`, then `vitis_hls -f hls/run_hls.tcl`. Stop immediately on csim/csynth failure, parity mismatch, pathological resource use, or unsatisfied timing.
2. **HDK integration stage**: integrate the exported HLS IP into the AWS F2 HLx/HDK shell, first using HBM. Build an AFI only after simulation and design checks pass.
3. **Runtime parity stage**: start `f2.6xlarge`, load the AFI, run the frozen canonical vector and then nonces 1200–1215. Any mismatch rejects the implementation and blocks benchmarking.
4. **Adversarial sweep**: test only configurations that preserve full parity. Sweep practical clock targets and independent lane counts that fit timing/resources; compare HBM and DDR only if the implementation makes both meaningful. The fastest admissible specialized configuration becomes the attacker candidate.
5. **Sustained stage**: only after the sweep, run >=1800 s continuously; 2100 s target for direct comparability with prior Official C. Capture throughput, timing, AFI/build hashes, FPGA/resource reports, host/runtime identifiers, rental duration/cost, and any available trustworthy physical telemetry.
6. **Terminate** all paid instances and delete unnecessary temporary volumes after evidence has been copied.

## Interpretation guardrail
A slow naive HLS baseline is **not** evidence of ASIC resistance. The paid campaign is admissible only after an attacker-oriented configuration sweep. Likewise, F2 hourly rental price is experiment cost and must not be substituted for HFB hardware acquisition cost. If trustworthy measured power and acquisition/replacement economics are unavailable, report `OPEN_PHYSICAL_RISK` rather than manufacturing a HOLD.

## Stop conditions
- parity failure;
- DP6 source/hash mismatch;
- HLS/HDK flow cannot implement 256 MiB nonce-private state without changing semantics;
- timing/resource failure that cannot be resolved by implementation mapping alone;
- spend cap would be exceeded;
- any requirement to connect wallet/testnet/mainnet or modify consensus.
