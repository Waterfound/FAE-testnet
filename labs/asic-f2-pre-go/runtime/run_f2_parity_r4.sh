#!/usr/bin/env bash
set -Eeuo pipefail
export HOME=/root
export AWS_DEFAULT_REGION=us-east-1

B="fae-asic-lab-203842200752-20260922"
AGFI="agfi-09f46d7fe160c51df"
W="/opt/fae-f2-runtime-r4"
L="/var/log/fae-f2-runtime-r4"
ROOT_REPO="$(cd "$(dirname "$0")/../../.." && pwd)"

mkdir -p "$W" "$L"
exec > >(tee -a "$L/run.log") 2>&1

TOKEN="$(curl -fsS -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 21600' http://169.254.169.254/latest/api/token)"
IID="$(curl -fsS -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)"
P="runtime/$IID/f2-parity-r4"

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
  dmesg | tail -200 > "$L/dmesg_tail.txt" 2>&1 || true
  syncall
  shutdown -h now || true
}
trap finish EXIT

( sleep 7200; echo WATCHDOG_EXPIRED > "$L/stage.txt"; syncall; shutdown -h now ) &
( while true; do sleep 60; syncall; done ) &

echo BOOTSTRAP > "$L/stage.txt"
syncall

cd "$W"
git clone --depth 1 --branch f2 https://github.com/aws/aws-fpga.git aws-fpga
export AWS_FPGA_REPO_DIR="$W/aws-fpga"
cd "$AWS_FPGA_REPO_DIR"
set +u
source sdk_setup.sh
set -u

echo "SDK_DIR=$SDK_DIR" > "$L/build_env.txt"
echo "LDFLAGS=$LDFLAGS" >> "$L/build_env.txt"
echo "LD_LIBRARY_PATH=$LD_LIBRARY_PATH" >> "$L/build_env.txt"
test -n "$SDK_DIR"

echo AFI_LOADING > "$L/stage.txt"
syncall
fpga-load-local-image -S 0 -I "$AGFI" -H > "$L/fpga_load.txt" 2>&1
fpga-describe-local-image -S 0 -R -H > "$L/fpga_status.txt" 2>&1
grep -q "$AGFI" "$L/fpga_status.txt"
grep -q "loaded" "$L/fpga_status.txt"
grep -q "0xf010" "$L/fpga_status.txt"
lspci -nn > "$L/lspci_after_load.txt"

if ! ls /dev/xdma*_h2c_0 >/dev/null 2>&1; then
  echo XDMA_FALLBACK_INSTALL > "$L/stage.txt"
  syncall
  cd "$W"
  git clone --depth 1 https://github.com/Xilinx/dma_ip_drivers.git
  XD="$W/dma_ip_drivers/XDMA/linux-kernel/xdma"
  cd "$XD"
  python3 -c 'from pathlib import Path; p=Path("xdma_mod.c"); s=p.read_text(); a="static const struct pci_device_id pci_ids[] = {"; b=a+"\n    { PCI_DEVICE(0x1D0F, 0xF010), },"; assert a in s; p.write_text(s.replace(a,b,1))'
  grep -n '0xF010' xdma_mod.c > "$L/xdma_patch.txt"
  make -j4 > "$L/xdma_make.log" 2>&1
  rmmod xdma > "$L/xdma_rmmod.log" 2>&1 || true
  insmod xdma.ko > "$L/xdma_insmod.log" 2>&1
  udevadm settle || true
  sleep 2
fi

lsmod | grep xdma > "$L/xdma_lsmod.txt" 2>&1
ls -l /dev/xdma* > "$L/xdma_devices.txt" 2>&1
test -e /dev/xdma0_h2c_0
test -e /dev/xdma0_c2h_0

echo RUNNER_BUILD > "$L/stage.txt"
syncall
SRC="$ROOT_REPO/labs/asic-f2-pre-go/runtime/run_f2_parity.c"
test -s "$SRC"
gcc -O2 -std=gnu11 -Wall -Wextra -I"$SDK_DIR/userspace/include" "$SRC" -o "$W/run_f2_parity" -L"$SDK_DIR/userspace/lib" -lfpga_mgmt -lrt -lpthread > "$L/compile.log" 2>&1
sha256sum "$SRC" "$W/run_f2_parity" > "$L/runner_sha256.txt"

echo RUNTIME_PARITY_RUNNING > "$L/stage.txt"
syncall
set +e
timeout 5400 "$W/run_f2_parity" > "$L/parity.log" 2>&1
RC=$?
set -e
echo "$RC" > "$L/parity_rc.txt"
cat "$L/parity.log"

if [ "$RC" -ne 0 ]; then
  echo RUNTIME_PARITY_FAIL_CLOSED > "$L/stage.txt"
  syncall
  exit "$RC"
fi

grep -q 'FAE_DP6_F2_CANONICAL=PASS' "$L/parity.log"
grep -q 'FAE_DP6_F2_16VECTORS=16/16' "$L/parity.log"
grep -q 'FAE_DP6_F2_RUNTIME_PARITY=PASS rc=0' "$L/parity.log"
echo RUNTIME_PARITY_PASS > "$L/stage.txt"
syncall
exit 0
