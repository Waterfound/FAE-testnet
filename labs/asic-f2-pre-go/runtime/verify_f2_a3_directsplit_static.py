#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import sys

EXPECTED_HLS_BLOB = "ea1ab21fbf359adc35955c42ea8e137707c37b6d"
CANDIDATE = pathlib.Path("labs/asic-f2-pre-go/hdk/integrate_fae_f2_2lane_200mhz_a3_directsplit.tcl")
HLS = pathlib.Path("labs/asic-f2-pre-go/hls/fae_dp6_hls.cpp")

REQUIRED_SNIPPETS = [
    "delete_bd_objs [get_bd_cells axi_cdma_0]",
    "delete_bd_objs [get_bd_cells axi_smc_cdma]",
    "CONFIG.NUM_SI {3}",
    "[get_bd_cells smartconnect_ddr4]",
    "[get_bd_cells smartconnect_hbm]",
    "fae_dp6_hls_0/m_axi_gmem0",
    "fae_cc_mem00/M_AXI] [get_bd_intf_pins smartconnect_ddr4/S01_AXI",
    "fae_dp6_hls_1/m_axi_gmem0",
    "fae_cc_mem10/M_AXI] [get_bd_intf_pins smartconnect_ddr4/S02_AXI",
    "fae_dp6_hls_0/m_axi_gmem1",
    "fae_cc_mem01/M_AXI] [get_bd_intf_pins smartconnect_hbm/S01_AXI",
    "fae_dp6_hls_1/m_axi_gmem1",
    "fae_cc_mem11/M_AXI] [get_bd_intf_pins smartconnect_hbm/S02_AXI",
    "CONFIG.CLKOUT1_REQUESTED_OUT_FREQ {200.000}",
    "CONFIG.PRIM_IN_FREQ {250.000}",
    "xilinx.com:ip:axi_protocol_converter:2.1",
    "CONFIG.SI_PROTOCOL {AXI4}",
    "CONFIG.MI_PROTOCOL {AXI4LITE}",
    "fae_cc_ctrl0/M_AXI] [get_bd_intf_pins fae_pc_ctrl0/S_AXI",
    "fae_pc_ctrl0/M_AXI] [get_bd_intf_pins fae_dp6_hls_0/s_axi_control",
    "fae_cc_ctrl1/M_AXI] [get_bd_intf_pins fae_pc_ctrl1/S_AXI",
    "fae_pc_ctrl1/M_AXI] [get_bd_intf_pins fae_dp6_hls_1/s_axi_control",
    "assign_bd_address -offset 0x00000000 -range 0x00001000",
    "assign_bd_address -offset 0x00001000 -range 0x00001000",
    "assign_bd_address -offset 0x1000000000 -range 0x1000000000",
    "assign_bd_address -offset 0x0200000000 -range 0x20000000",
    "assign_bd_address -offset 0x0220000000 -range 0x20000000",
    "validate_bd_design",
    "A3_UNEXPECTED_FAE_MEM_MERGE",
    "A3_UNEXPECTED_AXI_SMC_CDMA",
    "A3_DDR_NUM_SI_NOT_3",
    "A3_HBM_NUM_SI_NOT_3",
]

FORBIDDEN_SNIPPETS = [
    "create_bd_cell -type ip -vlnv xilinx.com:ip:smartconnect:1.0 fae_mem_merge",
    "connect_bd_intf_net [get_bd_intf_pins fae_mem_merge/M00_AXI]",
    "change DP6",
    "set_property CONFIG.PROTOCOL {AXI4LITE} $p",
    "set_property CONFIG.MAX_BURST_LENGTH {1} $p",
    "[get_bd_intf_pins fae_cc_ctrl0/M_AXI] [get_bd_intf_pins fae_dp6_hls_0/s_axi_control]",
    "[get_bd_intf_pins fae_cc_ctrl1/M_AXI] [get_bd_intf_pins fae_dp6_hls_1/s_axi_control]",
]


def git_blob(path: pathlib.Path) -> str:
    return subprocess.check_output(["git", "hash-object", str(path)], text=True).strip()


def sha256_file(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report")
    ns = ap.parse_args()

    text = CANDIDATE.read_text()
    checks: dict[str, object] = {}

    checks["candidate_exists"] = CANDIDATE.is_file()
    checks["hls_blob"] = git_blob(HLS)
    checks["hls_blob_frozen"] = checks["hls_blob"] == EXPECTED_HLS_BLOB

    missing = [s for s in REQUIRED_SNIPPETS if s not in text]
    forbidden = [s for s in FORBIDDEN_SNIPPETS if s in text]
    checks["required_snippets_missing"] = missing
    checks["forbidden_snippets_present"] = forbidden

    # Exactly two compute lanes, each with one DDR path and one HBM path.
    lanes = sorted(set(re.findall(r"fae_dp6_hls_([01])/m_axi_gmem[01]", text)))
    checks["lanes"] = lanes
    checks["exact_two_lanes"] = lanes == ["0", "1"]

    # Preserve public control apertures and host-visible DDR base.
    checks["control_offsets_preserved"] = (
        "0x00000000" in text and "0x00001000" in text
    )
    checks["ddr_base_preserved"] = "0x1000000000" in text

    # Lane-local HBM placement is intentionally split.
    checks["hbm_lane0_offset"] = "0x0200000000"
    checks["hbm_lane1_offset"] = "0x0220000000"
    checks["hbm_split_present"] = all(
        x in text for x in ("0x0200000000", "HBM_MEM00", "0x0220000000", "HBM_MEM01")
    )

    # Fail-closed static assertions embedded in TCL.
    checks["control_protocol_conversion_explicit"] = (
        text.count("xilinx.com:ip:axi_protocol_converter:2.1") == 1
        and "foreach n {ctrl0 ctrl1}" in text
        and "CONFIG.SI_PROTOCOL {AXI4}" in text
        and "CONFIG.MI_PROTOCOL {AXI4LITE}" in text
        and "fae_pc_ctrl0/S_AXI" in text
        and "fae_pc_ctrl0/M_AXI" in text
        and "fae_pc_ctrl1/S_AXI" in text
        and "fae_pc_ctrl1/M_AXI" in text
        and "A3_CTRL_PROTOCOL_CONVERTER_MISSING_" in text
        and "A3_CTRL_PC_MI_NOT_AXI4LITE_" in text
    )

    checks["self_checks_present"] = all(
        marker in text
        for marker in (
            "A3_UNEXPECTED_FAE_MEM_MERGE",
            "A3_UNEXPECTED_AXI_SMC_CDMA",
            "A3_DDR_NUM_SI_NOT_3",
            "A3_HBM_NUM_SI_NOT_3",
        )
    )

    checks["candidate_sha256"] = sha256_file(CANDIDATE)
    checks["semantics_change_claimed"] = False
    checks["paid_build_launched"] = False
    checks["vivado_validate_bd_design_executed"] = False
    checks["boundary"] = (
        "PASS here proves source-level topology invariants only. It does not claim Vivado "
        "validate_bd_design, routability, timing closure, AFI eligibility, runtime parity, or throughput."
    )

    passed = (
        checks["hls_blob_frozen"]
        and not missing
        and not forbidden
        and checks["exact_two_lanes"]
        and checks["control_offsets_preserved"]
        and checks["ddr_base_preserved"]
        and checks["hbm_split_present"]
        and checks["control_protocol_conversion_explicit"]
        and checks["self_checks_present"]
    )

    report = {
        "schema": "fae.asic.f2.a3_directsplit.static_source_validation.v1",
        "status": "PASS" if passed else "FAIL",
        "checks": checks,
        "next_gate": (
            "Run the R4 protocol-converter candidate through AWS HLx/Vivado validate_bd_design and require zero BD 41-237 control metadata mismatches. "
            "Do not start a paid physical implementation until that static provider validation passes."
        ),
    }

    encoded = json.dumps(report, sort_keys=True, indent=2) + "\n"
    if ns.report:
        pathlib.Path(ns.report).write_text(encoded)
    sys.stdout.write(encoded)
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
