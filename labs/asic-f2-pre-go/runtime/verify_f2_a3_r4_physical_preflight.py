#!/usr/bin/env python3
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(".")
HLS = ROOT / "labs/asic-f2-pre-go/hls/fae_dp6_hls.cpp"
INTEGRATE = ROOT / "labs/asic-f2-pre-go/hdk/integrate_fae_f2_2lane_200mhz_a3_directsplit.tcl"
IMPLEMENT = ROOT / "labs/asic-f2-pre-go/hdk/implement_fae_f2_2lane_200mhz_a3_r4.tcl"
RUNNER = ROOT / "labs/asic-f2-pre-go/runtime/run_f2_attacker_a3_r4_physical.sh"

EXPECTED = {
    str(HLS): "ea1ab21fbf359adc35955c42ea8e137707c37b6d",
    str(INTEGRATE): "b5554e0fde6564abc18a5945e435377d6adcc2f7",
    str(IMPLEMENT): "dc380777b1cf6bd332059e3ee5c672cf5207b718",
    str(RUNNER): "fea1786921a89532ddb222d450dcef866ad98ea4",
}

def blob(path: pathlib.Path) -> str:
    return subprocess.check_output(["git", "hash-object", str(path)], text=True).strip()

checks = {}
actual = {path: blob(pathlib.Path(path)) for path in EXPECTED}
checks["blob_match"] = {path: actual[path] == expected for path, expected in EXPECTED.items()}
checks["actual_blobs"] = actual

impl = IMPLEMENT.read_text()
runner = RUNNER.read_text()

required_impl = [
    "integrate_fae_f2_2lane_200mhz_a3_directsplit.tcl",
    "FAE_HDK_A3_R4_IMPLEMENTATION_START",
    "FAE_HDK_A3_R4_TIMING_CLOSED",
    "FAE_HDK_A3_R4_IMPLEMENTATION_PASS",
    'double($wns) < 0.0',
    'double($tns) != 0.0',
    'double($whs) < 0.0',
    'double($ths) != 0.0',
    "report_timing_summary",
    "report_route_status",
    "report_clock_utilization",
]
checks["implementation_missing"] = [x for x in required_impl if x not in impl]

required_runner = [
    'BRANCH="lab/asic-a3-r4-physical-20260927"',
    'EXPECTED_HLS_BLOB="ea1ab21fbf359adc35955c42ea8e137707c37b6d"',
    'EXPECTED_INTEGRATE_BLOB="b5554e0fde6564abc18a5945e435377d6adcc2f7"',
    'EXPECTED_IMPLEMENT_BLOB="dc380777b1cf6bd332059e3ee5c672cf5207b718"',
    ': "${FAE_EXPECTED_REPO_COMMIT:?FAE_EXPECTED_REPO_COMMIT is required}"',
    "sleep 28800",
    "timeout 28200 vivado",
    "shutdown -h now",
    "PhysicalBuildAuthorized=true",
    "AFICreationAuthorized=false",
    "ReleaseAuthorized=false",
    "MainnetAuthorized=false",
    "FailClosedTiming=true",
    "FAE_HDK_A3_R4_TIMING_CLOSED",
    "FAE_HDK_A3_R4_IMPLEMENTATION_PASS",
    "A3_R4_PHYSICAL_FAIL_CLOSED",
    "A3_R4_PHYSICAL_PASS",
]
checks["runner_missing"] = [x for x in required_runner if x not in runner]

prohibited_runner = [
    "aws ec2 create-fpga-image",
    "aws ec2 create_fpga_image",
    "create_fpga_image(",
    "release/mainnet",
]
checks["runner_prohibited_present"] = [x for x in prohibited_runner if x in runner]

checks["source_semantics_frozen"] = actual[str(HLS)] == EXPECTED[str(HLS)]
checks["physical_only_boundary"] = all(
    x in runner
    for x in (
        "AFICreationAuthorized=false",
        "ReleaseAuthorized=false",
        "MainnetAuthorized=false",
    )
)

passed = (
    all(checks["blob_match"].values())
    and not checks["implementation_missing"]
    and not checks["runner_missing"]
    and not checks["runner_prohibited_present"]
    and checks["source_semantics_frozen"]
    and checks["physical_only_boundary"]
)

report = {
    "schema": "fae.asic.f2.a3_r4.physical_preflight.v1",
    "status": "PASS" if passed else "FAIL",
    "checks": checks,
    "boundary": (
        "PASS authorizes no cloud action by itself. It proves only that the frozen "
        "R4 physical-build sources preserve the explicit timing and authority gates."
    ),
}
print(json.dumps(report, indent=2, sort_keys=True))
sys.exit(0 if passed else 1)
