# FAE F2 HDK Integration Validation V5

Status: **PASS**

Date: 2026-09-22
Branch: `lab/asic-f2-pre-go-20260922`
Patch base: `ea93cb1a5bbc506af8063ef2ab2713ee1075d94e`
AWS evidence worker: `i-009adb3f8bd47e446`

## Result

Vivado 2025.2 accepted the FAE HLS IP inside the official AWS HLx IP repository and validated the modified F2 block design in a single session.

Marker:

```
FAE_HDK_PATCH_VALIDATE_PASS
```

Worker exit code: `0`.

## Integrated cells

- `fae_dp6_hls_0` — `xilinx.com:hls:fae_dp6_hls:1.0`
- `fae_mem_merge` — `xilinx.com:ip:smartconnect:1.0`
- existing `axi_smc_cdma` downstream router preserved
- existing `smartconnect_hbm` preserved

## Interfaces

- `fae_dp6_hls_0/s_axi_control` — AXI slave
- `fae_dp6_hls_0/m_axi_gmem0` — AXI master
- `fae_dp6_hls_0/m_axi_gmem1` — AXI master
- `gmem0/gmem1 -> fae_mem_merge -> axi_smc_cdma`

## Address map

OCL:
- FAE control: `0x0000_0000`, range `0x1000`

Both FAE memory master spaces:
- DDR: `0x10_0000_0000`, range 64 GiB
- HBM00: `0x2_0000_0000`, 512 MiB
- HBM01: `0x2_2000_0000`, 512 MiB
- ...
- HBM15: `0x3_E000_0000`, 512 MiB

The existing AWS PCIS DDR/HBM map remains present.

## Gate

This closes logical HDK/HBM block-design integration only. It does **not** yet prove implementation timing closure, AFI creation, or physical F2 runtime parity.

Next gate:
`Vivado/HLx implementation -> Developer_CL.tar -> AFI`.
