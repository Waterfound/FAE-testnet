#!/bin/bash
set -Eeuo pipefail
export HOME=/root
export AWS_DEFAULT_REGION=us-east-1

BUCKET="fae-asic-lab-203842200752-20260922"
WORK="/opt/fae-a3-r4-controlrepair-r3t1-static"
LOG="/var/log/fae-a3-r4-controlrepair-r3t1-static"
BRANCH="colony/fae-asic-a3-r4-control-repair-001"
EXPECTED_HLS_BLOB="ea1ab21fbf359adc35955c42ea8e137707c37b6d"
EXPECTED_IP_SHA="c0bf48c3864b72352ba57a2d6c17175c1c6a59dffae52c8fa73a5d346bc60a33"
IP_KEY="evidence/i-0c43c11717fabb6e7/build-colony-hls-c6/artifacts/fae_dp6_hls_prj/sol_vu47p/impl/ip/xilinx_com_hls_fae_dp6_hls_1_0.zip"
CANDIDATE="labs/asic-f2-pre-go/hdk/integrate_fae_f2_2lane_166p667mhz_a3_r4_controlrepair_r3t1.tcl"

: "\${FAE_EXPECTED_REPO_COMMIT:?required}"
mkdir -p "$WORK" "$LOG"
exec > >(tee -a "$LOG/build.log") 2>&1

TOKEN="$(curl -fsS --retry 10 --retry-delay 2 -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 21600' http://169.254.169.254/latest/api/token)"
IID="$(curl -fsS --retry 10 --retry-delay 2 -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)"
PREFIX="evidence/$IID/a3-r4-controlrepair-r3t1-static"

sync_all() {
  set +e
  aws s3 sync "$LOG" "s3://$BUCKET/$PREFIX/" --sse AES256 --only-show-errors || true
  if [ -d "$WORK/project/fae-evidence" ]; then
    aws s3 sync "$WORK/project/fae-evidence" "s3://$BUCKET/$PREFIX/fae-evidence/" --sse AES256 --only-show-errors || true
  fi
  set -e
}
finish() {
  rc=$?
  set +e
  echo "$rc" > "$LOG/exit_code.txt"
  date -u +%Y-%m-%dT%H:%M:%SZ > "$LOG/finished_utc.txt"
  if [ -f "$LOG/vivado.log" ]; then
    grep -E 'FAE_A3_R4_CONTROL_REPAIR_R3T1_VALIDATE_PASS|A3_R4_CONTROL_REPAIR_R3T1_LOCAL_CLOCK_MHZ=|CRITICAL WARNING|WARNING: \[BD 41-|ERROR:' "$LOG/vivado.log" > "$LOG/markers.txt" 2>/dev/null || true
    grep -c 'BD 41-237' "$LOG/vivado.log" > "$LOG/bd_41_237_count.txt" 2>/dev/null || true
    grep -c 'BD 41-737' "$LOG/vivado.log" > "$LOG/bd_41_737_count.txt" 2>/dev/null || true
  fi
  sync_all
  shutdown -h now || true
}
trap finish EXIT

( sleep 3600; echo WATCHDOG_EXPIRED > "$LOG/stage.txt"; sync_all; shutdown -h now ) &
( while true; do sleep 60; sync_all; done ) &

echo BOOTSTRAP > "$LOG/stage.txt"
date -u +%Y-%m-%dT%H:%M:%SZ > "$LOG/started_utc.txt"
printf '%s\n' \
  "StaticValidationAuthorized=true" \
  "PhysicalBuildAuthorized=false" \
  "AFICreationAuthorized=false" \
  "F2RuntimeAuthorized=false" \
  "ReleaseAuthorized=false" \
  "MainnetAuthorized=false" > "$LOG/authority_boundary.txt"
sync_all

set +u
source /opt/Xilinx/2025.2/Vivado/settings64.sh
set -u

cd "$WORK"
git clone --depth 1 --branch f2 https://github.com/aws/aws-fpga.git aws-fpga
cd aws-fpga
set +u
source hdk_setup.sh
set -u
mkdir -p "$HOME/.Xilinx/Vivado"
printf '%s\n' 'set shell small_shell' 'source $::env(HDK_SHELL_DIR)/hlx/hlx_setup.tcl' > "$HOME/.Xilinx/Vivado/Vivado_init.tcl"

cd "$WORK"
git clone --branch "$BRANCH" https://github.com/Waterfound/FAE-testnet.git repo
cd repo
git checkout "$FAE_EXPECTED_REPO_COMMIT"
test "$(git rev-parse HEAD)" = "$FAE_EXPECTED_REPO_COMMIT"
git rev-parse HEAD > "$LOG/fae_repo_head.txt"
test "$(git hash-object labs/asic-f2-pre-go/hls/fae_dp6_hls.cpp)" = "$EXPECTED_HLS_BLOB"
git hash-object "$CANDIDATE" > "$LOG/candidate_blob.txt"

cd "$WORK"
mkdir -p hls_ip
aws s3 cp "s3://$BUCKET/$IP_KEY" hls_ip/fae_dp6_hls.zip --only-show-errors
test "$(sha256sum hls_ip/fae_dp6_hls.zip | awk '{print $1}')" = "$EXPECTED_IP_SHA"
mkdir -p "$HDK_SHELL_DIR/hlx/design/ip/fae_dp6_hls_1_0"
unzip -q hls_ip/fae_dp6_hls.zip -d "$HDK_SHELL_DIR/hlx/design/ip/fae_dp6_hls_1_0"

mkdir -p "$WORK/project"
cd "$WORK/project"
export FAE_EVIDENCE_DIR="$WORK/project/fae-evidence"
echo VIVADO_STATIC_RUNNING > "$LOG/stage.txt"
sync_all

set +e
timeout 3300 vivado -mode batch -notrace -source "$WORK/repo/$CANDIDATE" > "$LOG/vivado.log" 2>&1
VRC=$?
set -e
echo "$VRC" > "$LOG/vivado_rc.txt"
sync_all

if [ "$VRC" -ne 0 ]; then
  echo A3_R4_CONTROL_REPAIR_R3T1_STATIC_FAIL_CLOSED > "$LOG/stage.txt"
  sync_all
  exit "$VRC"
fi
grep -q '^FAE_A3_R4_CONTROL_REPAIR_R3T1_VALIDATE_PASS

if grep -q 'BD 41-237' "$LOG/vivado.log"; then
  echo A3_R4_CONTROL_REPAIR_R3T1_STATIC_FAIL_BD_41_237 > "$LOG/stage.txt"; sync_all; exit 41
fi
if grep -q 'BD 41-737' "$LOG/vivado.log"; then
  echo A3_R4_CONTROL_REPAIR_R3T1_STATIC_FAIL_BD_41_737 > "$LOG/stage.txt"; sync_all; exit 42
fi

test -s "$WORK/project/fae-evidence/a3_address_map.txt"
grep -Eq '/f2_inst/M_AXI_OCL/SEG_fae_dp6_hls_0_Reg \| OFFSET=0x0*0([[:space:]]|$|\|)' "$WORK/project/fae-evidence/a3_address_map.txt"
grep -Eq '/f2_inst/M_AXI_OCL/SEG_fae_dp6_hls_1_Reg \| OFFSET=0x0*1000([[:space:]]|$|\|)' "$WORK/project/fae-evidence/a3_address_map.txt"
grep -q 'fae_ctrl_split' "$WORK/project/fae-evidence/a3_interfaces.txt"
if grep -q 'fae_cc_ctrl' "$WORK/project/fae-evidence/a3_cells.txt"; then
  echo A3_R4_CONTROL_REPAIR_R3T1_STATIC_FAIL_CTRL_CDC_PRESENT > "$LOG/stage.txt"; sync_all; exit 43
fi
if grep -q 'fae_pc_ctrl' "$WORK/project/fae-evidence/a3_cells.txt"; then
  echo A3_R4_CONTROL_REPAIR_R3T1_STATIC_FAIL_PROTOCOL_CONVERTER_PRESENT > "$LOG/stage.txt"; sync_all; exit 44
fi

echo A3_R4_CONTROL_REPAIR_R3T1_STATIC_PASS > "$LOG/stage.txt"
sync_all
exit 0
 "$LOG/vivado.log"
grep -q '^A3_R4_CONTROL_REPAIR_R3T1_LOCAL_CLOCK_MHZ=166.667' "$LOG/vivado.log"

if grep -q 'BD 41-237' "$LOG/vivado.log"; then
  echo A3_R4_CONTROL_REPAIR_R3T1_STATIC_FAIL_BD_41_237 > "$LOG/stage.txt"; sync_all; exit 41
fi
if grep -q 'BD 41-737' "$LOG/vivado.log"; then
  echo A3_R4_CONTROL_REPAIR_R3T1_STATIC_FAIL_BD_41_737 > "$LOG/stage.txt"; sync_all; exit 42
fi

test -s "$WORK/project/fae-evidence/a3_address_map.txt"
grep -Eq '/f2_inst/M_AXI_OCL/SEG_fae_dp6_hls_0_Reg \| OFFSET=0x0*0([[:space:]]|$|\|)' "$WORK/project/fae-evidence/a3_address_map.txt"
grep -Eq '/f2_inst/M_AXI_OCL/SEG_fae_dp6_hls_1_Reg \| OFFSET=0x0*1000([[:space:]]|$|\|)' "$WORK/project/fae-evidence/a3_address_map.txt"
grep -q 'fae_ctrl_split' "$WORK/project/fae-evidence/a3_interfaces.txt"
if grep -q 'fae_cc_ctrl' "$WORK/project/fae-evidence/a3_cells.txt"; then
  echo A3_R4_CONTROL_REPAIR_R3T1_STATIC_FAIL_CTRL_CDC_PRESENT > "$LOG/stage.txt"; sync_all; exit 43
fi
if grep -q 'fae_pc_ctrl' "$WORK/project/fae-evidence/a3_cells.txt"; then
  echo A3_R4_CONTROL_REPAIR_R3T1_STATIC_FAIL_PROTOCOL_CONVERTER_PRESENT > "$LOG/stage.txt"; sync_all; exit 44
fi

echo A3_R4_CONTROL_REPAIR_R3T1_STATIC_PASS > "$LOG/stage.txt"
sync_all
exit 0
