#!/bin/bash
set -Eeuo pipefail
export HOME=/root
BUCKET="fae-asic-lab-203842200752-20260922"
BRANCH="lab/asic-f2-timing-hardening-bc-001"
EXPECTED_BLOB="6a40fa552efd668236dc678ff29fe7fd7373db65"
WORK="/opt/fae-c5-hls"
LOG="/var/log/fae-c5-hls"
mkdir -p "$WORK" "$LOG"
exec > >(tee -a "$LOG/run.log") 2>&1
TOKEN=$(curl -fsS -X PUT -H "X-aws-ec2-metadata-token-ttl-seconds: 1800" http://169.254.169.254/latest/api/token)
IID=$(curl -fsS -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)
PREFIX="evidence/$IID/build-colony-hls-c5"

sync_all(){
  set +e
  aws s3 sync "$LOG" "s3://$BUCKET/$PREFIX/" --sse AES256 --only-show-errors || true
  if [ -d "$WORK/repo/labs/asic-f2-pre-go/hls/fae_dp6_hls_prj" ]; then
    find "$WORK/repo/labs/asic-f2-pre-go/hls/fae_dp6_hls_prj" -type f \( -name "*csynth.rpt" -o -name "*.bind.rpt" -o -name "*.verbose.bind.rpt" -o -name "*.zip" \) -print0 |
      while IFS= read -r -d '' f; do
        rel=$(realpath --relative-to="$WORK/repo/labs/asic-f2-pre-go/hls" "$f")
        aws s3 cp "$f" "s3://$BUCKET/$PREFIX/artifacts/$rel" --sse AES256 --only-show-errors || true
      done
  fi
  set -e
}
finish(){ rc=$?; set +e; echo "$rc" > "$LOG/exit_code.txt"; date -u +"%Y-%m-%dT%H:%M:%SZ" > "$LOG/finished_utc.txt"; sync_all; shutdown -h now || true; }
trap finish EXIT
( sleep 10800; echo WATCHDOG_EXPIRED > "$LOG/stage.txt"; sync_all; shutdown -h now ) &
echo BOOTSTRAP > "$LOG/stage.txt"; sync_all

set +u
source /opt/Xilinx/2025.2/Vitis/settings64.sh
set -u
cd "$WORK"
git clone --branch "$BRANCH" https://github.com/Waterfound/FAE-testnet.git repo
cd repo
git rev-parse HEAD > "$LOG/fae_repo_head.txt"
BLOB=$(git hash-object labs/asic-f2-pre-go/hls/fae_dp6_hls.cpp)
echo "$BLOB" > "$LOG/hls_blob.txt"
test "$BLOB" = "$EXPECTED_BLOB"
cd labs/asic-f2-pre-go/hls
sha256sum fae_dp6_hls.cpp test_16_vectors.cpp run_hls.tcl > "$LOG/input_sha256.txt"

echo VITIS_HLS_RUNNING > "$LOG/stage.txt"; sync_all
set +e
timeout 9600 vitis-run --mode hls --tcl run_hls.tcl > "$LOG/vitis_hls.log" 2>&1
RC=$?
set -e
echo "$RC" > "$LOG/vitis_hls_rc.txt"
test "$RC" -eq 0
grep -q 'FAE_DP6_HLS_16VECTORS=16/16' "$LOG/vitis_hls.log"

RW5="fae_dp6_hls_prj/sol_vu47p/.autopilot/db/rw5.verbose.bind.rpt"
FILL="fae_dp6_hls_prj/sol_vu47p/.autopilot/db/fill_block.verbose.bind.rpt"
CS="fae_dp6_hls_prj/sol_vu47p/syn/report/fae_dp6_hls_csynth.rpt"
IP="fae_dp6_hls_prj/sol_vu47p/impl/ip/xilinx_com_hls_fae_dp6_hls_1_0.zip"
test -s "$RW5"; test -s "$FILL"; test -s "$CS"; test -s "$IP"

grep -E 'Port \[ r\]|Width = 64|Depth = 8|LUTRAM|RAM_2P_LUTRAM' "$RW5" > "$LOG/rw5_binding_excerpt.txt" || true
grep -E 'r.*LUTRAM|RAM_2P_LUTRAM|t.*RAM' "$FILL" > "$LOG/fill_binding_excerpt.txt" || true
grep -q 'RAM_2P_LUTRAM' "$RW5"
test "$(grep -c 'RAM_2P_LUTRAM' "$FILL")" -ge 2
sha256sum "$IP" > "$LOG/hls_ip_zip_sha256.txt"
cp "$CS" "$LOG/fae_dp6_hls_csynth.rpt"

echo PASS_CSIM_CSYNTH_EXPORT_BINDING > "$LOG/stage.txt"; sync_all
