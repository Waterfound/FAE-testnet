#!/bin/bash
set -Eeuo pipefail
export HOME=/root

BUCKET="fae-asic-lab-203842200752-20260922"
WORK="/opt/fae-hdk-c2-p1-r2"
LOG="/var/log/fae-hdk-c2-p1-r2"
BRANCH="lab/asic-f2-timing-hardening-bc-001"
EXPECTED_BLOB="ca80f2ee39b3eb1d47e3e5b4121854f7116cbb45"
EXPECTED_IP_SHA="d23ba20497b0f4cde5fadd76d0ae1754783c95f3deff8e2e9d2a0c3eb9998ab8"
IP_KEY="evidence/i-07d2ae49cd70a0563/build-colony-hls-c2/artifacts/fae_dp6_hls_prj/sol_vu47p/impl/ip/xilinx_com_hls_fae_dp6_hls_1_0.zip"

mkdir -p "$WORK" "$LOG"
exec > >(tee -a "$LOG/build.log") 2>&1

TOKEN=$(curl -fsS -X PUT -H "X-aws-ec2-metadata-token-ttl-seconds: 1800" http://169.254.169.254/latest/api/token)
IID=$(curl -fsS -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)
PREFIX="evidence/$IID/build-colony-physical-c2-p1-r2"

sync_all() {
  set +e
  aws s3 sync "$LOG" "s3://$BUCKET/$PREFIX/" --sse AES256 --only-show-errors || true
  if [ -d "$WORK/project" ]; then
    find "$WORK/project" -type f \( -name "runme.log" -o -name "*timing_summary_routed.rpt" -o -name "*route_status.rpt" -o -name "*clock_utilization_routed.rpt" -o -name "*.Developer_CL.tar" \) -print0 |
    while IFS= read -r -d '' f; do
      rel=$(realpath --relative-to="$WORK/project" "$f")
      aws s3 cp "$f" "s3://$BUCKET/$PREFIX/artifacts/$rel" --sse AES256 --only-show-errors || true
    done
  fi
  set -e
}

finish() {
  rc=$?
  set +e
  echo "$rc" > "$LOG/exit_code.txt"
  date -u +"%Y-%m-%dT%H:%M:%SZ" > "$LOG/finished_utc.txt"
  grep -E "FAE_HDK_|IMPL_(STATUS|PROGRESS|WNS|TNS|WHS|THS)|IMPLEMENTATION_|EFFECTIVE_(PHYS_OPT|ROUTE)_DIRECTIVE" "$LOG/vivado_impl.log" > "$LOG/implementation_markers.txt" 2>/dev/null || true
  find "$WORK/project" -type f -name "*.Developer_CL.tar" -print > "$LOG/developer_cl_paths.txt" 2>/dev/null || true
  if [ -s "$LOG/developer_cl_paths.txt" ]; then
    while IFS= read -r f; do sha256sum "$f"; done < "$LOG/developer_cl_paths.txt" > "$LOG/developer_cl_sha256.txt" 2>/dev/null || true
  fi
  sync_all
  shutdown -h now || true
}
trap finish EXIT

( sleep 21600; echo WATCHDOG_EXPIRED > "$LOG/stage.txt"; sync_all; shutdown -h now ) &
( while true; do sleep 120; sync_all; done ) &

echo BOOTSTRAP > "$LOG/stage.txt"
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
cat "$HOME/.Xilinx/Vivado/Vivado_init.tcl" > "$LOG/vivado_init.tcl.txt"

cd "$WORK"
git clone --branch "$BRANCH" https://github.com/Waterfound/FAE-testnet.git repo
cd repo
git rev-parse HEAD > "$LOG/fae_repo_head.txt"
ACTUAL=$(git hash-object labs/asic-f2-pre-go/hls/fae_dp6_hls.cpp)
echo "$ACTUAL" > "$LOG/hls_blob.txt"
test "$ACTUAL" = "$EXPECTED_BLOB"

cd "$WORK"
echo HLS_IP_FETCH > "$LOG/stage.txt"
mkdir -p "$WORK/hls_ip"
aws s3 cp "s3://$BUCKET/$IP_KEY" "$WORK/hls_ip/fae_dp6_hls.zip" --only-show-errors
ACTUAL_IP_SHA=$(sha256sum "$WORK/hls_ip/fae_dp6_hls.zip" | awk '{print $1}')
echo "$ACTUAL_IP_SHA  $WORK/hls_ip/fae_dp6_hls.zip" > "$LOG/hls_ip_zip_sha256.txt"
test "$ACTUAL_IP_SHA" = "$EXPECTED_IP_SHA"

mkdir -p "$HDK_SHELL_DIR/hlx/design/ip/fae_dp6_hls_1_0"
unzip -q "$WORK/hls_ip/fae_dp6_hls.zip" -d "$HDK_SHELL_DIR/hlx/design/ip/fae_dp6_hls_1_0"

mkdir -p "$WORK/project"
cd "$WORK/project"
export FAE_EVIDENCE_DIR="$WORK/project/fae-evidence"
export FAE_ROUTE_DIRECTIVE="AggressiveExplore"
echo "FAE_PHYS_OPT_DIRECTIVE=Explore" > "$LOG/physical_knobs.txt"
echo "FAE_ROUTE_DIRECTIVE=AggressiveExplore" >> "$LOG/physical_knobs.txt"

echo VIVADO_IMPLEMENTATION_RUNNING > "$LOG/stage.txt"
sync_all

set +e
timeout 20400 vivado -mode batch -notrace -source "$WORK/repo/labs/asic-f2-pre-go/hdk/implement_fae_f2.tcl" > "$LOG/vivado_impl.log" 2>&1
VRC=$?
set -e
echo "$VRC" > "$LOG/vivado_rc.txt"

grep -E "FAE_HDK_|IMPL_(STATUS|PROGRESS|WNS|TNS|WHS|THS)|IMPLEMENTATION_|EFFECTIVE_(PHYS_OPT|ROUTE)_DIRECTIVE" "$LOG/vivado_impl.log" > "$LOG/implementation_markers.txt" || true
find "$WORK/project" -type f -name "*.Developer_CL.tar" -print > "$LOG/developer_cl_paths.txt" || true
if [ -s "$LOG/developer_cl_paths.txt" ]; then
  while IFS= read -r f; do sha256sum "$f"; done < "$LOG/developer_cl_paths.txt" > "$LOG/developer_cl_sha256.txt" || true
fi
sync_all

if [ "$VRC" -ne 0 ]; then
  echo PHYSICAL_IMPLEMENTATION_FAIL_CLOSED > "$LOG/stage.txt"
  sync_all
  exit "$VRC"
fi

grep -q '^FAE_HDK_TIMING_CLOSED$' "$LOG/implementation_markers.txt"
grep -q '^FAE_HDK_IMPLEMENTATION_PASS$' "$LOG/implementation_markers.txt"
test -s "$LOG/developer_cl_paths.txt"

echo PHYSICAL_TIMING_AND_DEVELOPER_CL_PASS > "$LOG/stage.txt"
sync_all
exit 0
