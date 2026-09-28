#!/usr/bin/env bash
set -Eeuo pipefail
export HOME=/root
export AWS_DEFAULT_REGION=us-east-1

B="fae-asic-lab-203842200752-20260922"
AGFI="agfi-01ca0856fe3a85305"
W="/opt/fae-f2-a3-r4-runtime"
L="/var/log/fae-f2-a3-r4-runtime"
RUNTIME_COMMIT="fc5f476196a8b31e45c7f216b55401761525f932"
HARDWARE_COMMIT="a208b245da98052b60b9d47cd676f7c0a23e74a3"
DEVELOPER_CL_SHA256="cb369bca24dbe0c17e015adf5668d2d4117c77d31896c3a3b1faedab09e2f7a5"
AFI="afi-0bd37117433ff02d7"

mkdir -p "$W" "$L"
exec > >(tee -a "$L/run.log") 2>&1

TOKEN="$(curl -fsS -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 21600' http://169.254.169.254/latest/api/token)"
IID="$(curl -fsS -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)"
P="runtime/$IID/f2-a3-r4-duallane"

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
  syncall
  shutdown -h now || true
}
trap finish EXIT

( sleep 4200; echo WATCHDOG_EXPIRED > "$L/stage.txt"; syncall; shutdown -h now ) &
( while true; do sleep 60; syncall; done ) &

echo BOOTSTRAP > "$L/stage.txt"
date -u +%Y-%m-%dT%H:%M:%SZ > "$L/started_utc.txt"
printf 'AFI=%s\nAGFI=%s\nHARDWARE_COMMIT=%s\nRUNTIME_COMMIT=%s\nDEVELOPER_CL_SHA256=%s\n' \
  "$AFI" "$AGFI" "$HARDWARE_COMMIT" "$RUNTIME_COMMIT" "$DEVELOPER_CL_SHA256" > "$L/candidate.txt"
syncall

cd "$W"
git clone --depth 50 --branch lab/asic-f2-timing-hardening-bc-001 https://github.com/Waterfound/FAE-testnet.git repo
cd repo
git checkout "$RUNTIME_COMMIT"
git rev-parse HEAD > "$L/repo_head.txt"
cp labs/asic-f2-pre-go/runtime/run_f2_a3_r4_duallane.c "$W/runner.c"
sha256sum "$W/runner.c" > "$L/source_sha256.txt"

git clone --depth 1 --branch f2 https://github.com/aws/aws-fpga.git "$W/aws-fpga"
export AWS_FPGA_REPO_DIR="$W/aws-fpga"
cd "$AWS_FPGA_REPO_DIR"
set +u
source sdk_setup.sh
set -u
test -n "$SDK_DIR"
printf 'SDK_DIR=%s\n' "$SDK_DIR" > "$L/build_env.txt"

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
gcc -O2 -std=gnu11 -Wall -Wextra -I"$SDK_DIR/userspace/include" "$W/runner.c" \
  -o "$W/runner" -L"$SDK_DIR/userspace/lib" -lfpga_mgmt -lrt -lpthread > "$L/compile.log" 2>&1
sha256sum "$W/runner.c" "$W/runner" > "$L/runner_sha256.txt"

echo A3_R4_DUALLANE_RUNTIME_RUNNING > "$L/stage.txt"
syncall
set +e
timeout 3600 "$W/runner" > "$L/runtime.log" 2>&1
RC=$?
set -e
echo "$RC" > "$L/runtime_rc.txt"
cat "$L/runtime.log"

if [ "$RC" -ne 0 ]; then
  echo A3_R4_DUALLANE_RUNTIME_FAIL_CLOSED > "$L/stage.txt"
  syncall
  exit "$RC"
fi

grep -q 'FAE_DP6_F2_LANE0_CANONICAL=PASS' "$L/runtime.log"
grep -q 'FAE_DP6_F2_LANE1_CANONICAL=PASS' "$L/runtime.log"
grep -q 'FAE_DP6_F2_LANE0_16VECTORS=16/16' "$L/runtime.log"
grep -q 'FAE_DP6_F2_LANE1_16VECTORS=16/16' "$L/runtime.log"
grep -q 'FAE_DP6_F2_DUALLANE_PARITY=PASS' "$L/runtime.log"
grep -q 'FAE_DP6_F2_DUALLANE_BENCH=PASS' "$L/runtime.log"
grep -q 'FAE_DP6_F2_DUALLANE_PROMOTION=FASTER_THAN_A1' "$L/runtime.log"
grep -q 'FAE_DP6_F2_A3_R4_RUNTIME=PASS rc=0' "$L/runtime.log"

echo A3_R4_DUALLANE_RUNTIME_PASS > "$L/stage.txt"
syncall
exit 0
