#!/usr/bin/env bash
set -Eeuo pipefail
export HOME=/root
export AWS_DEFAULT_REGION=us-east-1

B="fae-asic-lab-203842200752-20260922"
AGFI="agfi-09f46d7fe160c51df"
W="/opt/fae-f2-attacker-hbm0-a1"
L="/var/log/fae-f2-attacker-hbm0-a1"
SOURCE_S3="s3://$B/runtime/plans/attacker-hbm0-a1/run_f2_attacker_hbm0_a1.c"

mkdir -p "$W" "$L"
exec > >(tee -a "$L/run.log") 2>&1

TOKEN="$(curl -fsS -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 21600' http://169.254.169.254/latest/api/token)"
IID="$(curl -fsS -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)"
P="runtime/$IID/f2-attacker-hbm0-a1"

syncall() {
  set +e
  aws s3 sync "$L" "s3://$B/$P/" --sse AES256 --only-show-errors || true
  set -e
}

finish() {
  rc=$?
  set +e
  echo "$rc" > "$L/exit_code.txt"
  date -u +%Y-%m-%dT%H:%M:%SZ > "$L/finished_utc.txt"
  fpga-describe-local-image -S 0 -H > "$L/final_fpga_status.txt" 2>&1 || true
  fpga-describe-local-image -S 0 --metrics > "$L/final_fpga_metrics.txt" 2>&1 || true
  dmesg | tail -250 > "$L/dmesg_tail.txt" 2>&1 || true
  cp "$W/run_f2_attacker_hbm0_a1.c" "$L/" 2>/dev/null || true
  syncall
  shutdown -h now || true
}
trap finish EXIT

( sleep 6600; echo WATCHDOG_EXPIRED > "$L/stage.txt"; syncall; shutdown -h now ) &
( while true; do sleep 60; syncall; done ) &

echo BOOTSTRAP > "$L/stage.txt"
date -u +%Y-%m-%dT%H:%M:%SZ > "$L/started_utc.txt"
syncall

cd "$W"
git clone --depth 1 --branch f2 https://github.com/aws/aws-fpga.git aws-fpga
export AWS_FPGA_REPO_DIR="$W/aws-fpga"
cd "$AWS_FPGA_REPO_DIR"
set +u
source sdk_setup.sh
set -u
printf 'SDK_DIR=%s\nLDFLAGS=%s\nLD_LIBRARY_PATH=%s\n' "$SDK_DIR" "${LDFLAGS:-}" "${LD_LIBRARY_PATH:-}" > "$L/build_env.txt"
test -n "$SDK_DIR"

aws s3 cp "$SOURCE_S3" "$W/run_f2_attacker_hbm0_a1.c" --only-show-errors
sha256sum "$W/run_f2_attacker_hbm0_a1.c" > "$L/source_sha256.txt"

echo AFI_LOADING > "$L/stage.txt"
syncall
fpga-load-local-image -S 0 -I "$AGFI" -H > "$L/fpga_load.txt" 2>&1
fpga-describe-local-image -S 0 -R -H > "$L/fpga_status.txt" 2>&1
grep -q "$AGFI" "$L/fpga_status.txt"
grep -q "loaded" "$L/fpga_status.txt"
grep -q "0xf010" "$L/fpga_status.txt"
lspci -nn > "$L/lspci_after_load.txt"

echo RUNNER_BUILD > "$L/stage.txt"
syncall
gcc -O2 -std=gnu11 -Wall -Wextra -I"$SDK_DIR/userspace/include" "$W/run_f2_attacker_hbm0_a1.c"   -o "$W/run_f2_attacker_hbm0_a1" -L"$SDK_DIR/userspace/lib" -lfpga_mgmt -lrt -lpthread > "$L/compile.log" 2>&1
sha256sum "$W/run_f2_attacker_hbm0_a1.c" "$W/run_f2_attacker_hbm0_a1" > "$L/runner_sha256.txt"

echo ATTACKER_HBM0_A1_RUNNING > "$L/stage.txt"
syncall
set +e
timeout 5400 "$W/run_f2_attacker_hbm0_a1" > "$L/parity.log" 2>&1
RC=$?
set -e
echo "$RC" > "$L/parity_rc.txt"
cat "$L/parity.log"

if [ "$RC" -ne 0 ]; then
  echo ATTACKER_HBM0_A1_FAIL_CLOSED > "$L/stage.txt"
  syncall
  exit "$RC"
fi

grep -q 'FAE_DP6_F2_CANONICAL=PASS' "$L/parity.log"
grep -q 'FAE_DP6_F2_16VECTORS=16/16' "$L/parity.log"
grep -q 'FAE_DP6_F2_RUNTIME_PARITY=PASS rc=0' "$L/parity.log"
echo ATTACKER_HBM0_A1_PASS > "$L/stage.txt"
syncall
exit 0
