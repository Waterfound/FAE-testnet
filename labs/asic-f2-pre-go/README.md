# FAE ASIC Lab — F2 PRE-GO package

Status: **PRE_GO_READY_RENTAL_NOT_AUTHORIZED**.

This package closes the free/local preparation immediately before a paid FPGA experiment. It preserves FAE-DP6 v0.7 semantics and contains no production authority.

Local gate completed on 2026-09-22:
- HLS-port canonical full-state vector: PASS.
- Independent final-hash vectors for nonces 1200–1215: **16/16 PASS**.
- 256 MiB matrix allocated and exercised by the local portability test.
- AWS F2 real-hardware flow constrained to Vivado/HDK; direct Vitis AFI generation is not assumed.

The next step consumes paid cloud infrastructure and therefore remains blocked on explicit GO.
