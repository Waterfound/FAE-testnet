#!/bin/bash
set -Eeuo pipefail
export HOME=/root
export AWS_DEFAULT_REGION=us-east-1

BUCKET="fae-asic-lab-203842200752-20260922"
WORK="/opt/fae-f2-attacker-a2b-2lane-200mhz"
LOG="/var/log/fae-f2-attacker-a2b-2lane-200mhz"
BRANCH="lab/asic-f2-timing-hardening-bc-001"
EXPECTED_HLS_BLOB="ea1ab21fbf359adc35955c42ea8e137707c37b6d"
EXPECTED_INTEGRATE_BLOB="fca3640eecc7ab201600786d36a1144ca7b7b498"
EXPECTED_IMPLEMENT_BLOB="e1eec19b499f0de8be510858c7337ec22decb44f"
EXPECTED_IP_SHA="c0bf48c3864b72352ba57a2d6c17175c1c6a59dffae52c8fa73a5d346bc60a33"
IP_KEY="evidence/i-0c43c11717fabb6e7/build-colony-hls-c6/artifacts/fae_dp6_hls_prj/sol_vu47p/impl/ip/xilinx_com_hls_fae_dp6_hls_1_0.zip"

mkdir -p "$WORK" "$LOG"
exec > >(tee -a "$LOG/build.log") 2>&1

TOKEN="$(curl -fsS -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 21600' http://169.254.169.254/latest/api/token)"
IID="$(curl -fsS -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)"
PREFIX="evidence/$IID/f2-attacker-a2b-2lane-200mhz-physical"

sync_all() {
  set +e
  aws s3 sync "$LOG" "s3://$BUCKET/$PREFIX/" --sse AES256 --only-show-errors || true
  if [ -d "$WORK/project/fae-evidence" ]; then
    aws s3 sync "$WORK/project/fae-evidence" "s3://$BUCKET/$PREFIX/fae-evidence/" --sse AES256 --only-show-errors || true
  fi
  if [ -d "$WORK/project" ]; then
    find "$WORK/project" -type f \( -name "runme.log" -o -name "*timing_summary_routed.rpt" -o -name "*route_status.rpt" -o -name "*clock_utilization_routed.rpt" -o -name "*.Developer_CL.tar" \) -print0 |
    while IFS= read -r -d '' f; do
      rel="$(realpath --relative-to="$WORK/project" "$f")"
      aws s3 cp "$f" "s3://$BUCKET/$PREFIX/artifacts/$rel" --sse AES256 --only-show-errors || true
    done
  fi
  set -e
}

finish() {
  rc=$?
  set +e
  echo "$rc" > "$LOG/exit_code.txt"
  date -u +%Y-%m-%dT%H:%M:%SZ > "$LOG/finished_utc.txt"
  if [ -f "$LOG/vivado_impl.log" ]; then
    grep -E "FAE_HDK_|IMPL_(STATUS|PROGRESS|WNS|TNS|WHS|THS)|IMPLEMENTATION_|GLOBAL_IMPL_STRATEGY|EFFECTIVE_(PHYS_OPT|ROUTE)_DIRECTIVE" "$LOG/vivado_impl.log" > "$LOG/implementation_markers.txt" 2>/dev/null || true
  fi
  find "$WORK/project" -type f -name "*.Developer_CL.tar" -print > "$LOG/developer_cl_paths.txt" 2>/dev/null || true
  if [ -s "$LOG/developer_cl_paths.txt" ]; then
    while IFS= read -r f; do sha256sum "$f"; done < "$LOG/developer_cl_paths.txt" > "$LOG/developer_cl_sha256.txt" 2>/dev/null || true
  fi
  sync_all
  shutdown -h now || true
}
trap finish EXIT

( sleep 18000; echo WATCHDOG_EXPIRED > "$LOG/stage.txt"; sync_all; shutdown -h now ) &
( while true; do sleep 120; sync_all; done ) &

echo BOOTSTRAP > "$LOG/stage.txt"
date -u +%Y-%m-%dT%H:%M:%SZ > "$LOG/started_utc.txt"
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

ACTUAL_HLS="$(git hash-object labs/asic-f2-pre-go/hls/fae_dp6_hls.cpp)"
ACTUAL_INTEGRATE="$(git hash-object labs/asic-f2-pre-go/hdk/integrate_fae_f2_2lane_200mhz.tcl)"
ACTUAL_IMPLEMENT="$(git hash-object labs/asic-f2-pre-go/hdk/implement_fae_f2_2lane_200mhz.tcl)"
printf 'hls=%s\nintegrate=%s\nimplement=%s\n' "$ACTUAL_HLS" "$ACTUAL_INTEGRATE" "$ACTUAL_IMPLEMENT" > "$LOG/source_blobs.txt"
test "$ACTUAL_HLS" = "$EXPECTED_HLS_BLOB"
test "$ACTUAL_INTEGRATE" = "$EXPECTED_INTEGRATE_BLOB"
test "$ACTUAL_IMPLEMENT" = "$EXPECTED_IMPLEMENT_BLOB"

cd "$WORK"
echo HLS_IP_FETCH > "$LOG/stage.txt"
mkdir -p "$WORK/hls_ip"
aws s3 cp "s3://$BUCKET/$IP_KEY" "$WORK/hls_ip/fae_dp6_hls.zip" --only-show-errors
ACTUAL_IP_SHA="$(sha256sum "$WORK/hls_ip/fae_dp6_hls.zip" | awk '{print $1}')"
echo "$ACTUAL_IP_SHA  $WORK/hls_ip/fae_dp6_hls.zip" > "$LOG/hls_ip_zip_sha256.txt"
test "$ACTUAL_IP_SHA" = "$EXPECTED_IP_SHA"

mkdir -p "$HDK_SHELL_DIR/hlx/design/ip/fae_dp6_hls_1_0"
unzip -q "$WORK/hls_ip/fae_dp6_hls.zip" -d "$HDK_SHELL_DIR/hlx/design/ip/fae_dp6_hls_1_0"

mkdir -p "$WORK/project"
cd "$WORK/project"
export FAE_EVIDENCE_DIR="$WORK/project/fae-evidence"

echo "GLOBAL_IMPL_STRATEGY=Vivado Implementation Defaults" > "$LOG/physical_knobs.txt"
echo "OPT_DESIGN=Explore" >> "$LOG/physical_knobs.txt"
echo "PLACE_DESIGN=Explore" >> "$LOG/physical_knobs.txt"
echo "PHYS_OPT=Explore" >> "$LOG/physical_knobs.txt"
echo "ROUTE=Explore" >> "$LOG/physical_knobs.txt"
echo "SHELL_CLK_MAIN_A0_MHZ=250" >> "$LOG/physical_knobs.txt"
echo "LOCAL_COMPUTE_CLK_MHZ=200" >> "$LOG/physical_knobs.txt"
echo "CDC=2xAXIL_250_TO_200+4xAXI_200_TO_250" >> "$LOG/physical_knobs.txt"

echo VIVADO_2LANE_IMPLEMENTATION_RUNNING > "$LOG/stage.txt"
sync_all

set +e
timeout 17400 vivado -mode batch -notrace -source "$WORK/repo/labs/asic-f2-pre-go/hdk/implement_fae_f2_2lane_200mhz.tcl" > "$LOG/vivado_impl.log" 2>&1
VRC=$?
set -e
echo "$VRC" > "$LOG/vivado_rc.txt"

grep -E "FAE_HDK_|IMPL_(STATUS|PROGRESS|WNS|TNS|WHS|THS)|IMPLEMENTATION_|GLOBAL_IMPL_STRATEGY|EFFECTIVE_(PHYS_OPT|ROUTE)_DIRECTIVE" "$LOG/vivado_impl.log" > "$LOG/implementation_markers.txt" || true
find "$WORK/project" -type f -name "*.Developer_CL.tar" -print > "$LOG/developer_cl_paths.txt" || true
if [ -s "$LOG/developer_cl_paths.txt" ]; then
  while IFS= read -r f; do sha256sum "$f"; done < "$LOG/developer_cl_paths.txt" > "$LOG/developer_cl_sha256.txt" || true
fi
sync_all

if [ "$VRC" -ne 0 ]; then
  echo A2B_2LANE_200MHZ_PHYSICAL_FAIL_CLOSED > "$LOG/stage.txt"
  sync_all
  exit "$VRC"
fi

grep -q '^FAE_HDK_2LANE_200MHZ_CDC_TIMING_CLOSED$' "$LOG/implementation_markers.txt"
grep -q '^FAE_HDK_2LANE_200MHZ_CDC_IMPLEMENTATION_PASS$' "$LOG/implementation_markers.txt"
test -s "$LOG/developer_cl_paths.txt"

echo A2B_2LANE_200MHZ_PHYSICAL_PASS > "$LOG/stage.txt"
sync_all
exit 0
