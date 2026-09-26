#!/usr/bin/env bash
set -euo pipefail

: "${AWS_FPGA_REPO_DIR:=$HOME/src/aws-fpga}"
: "${FAE_REPO_DIR:=$HOME/src/FAE-testnet}"
: "${FAE_EVIDENCE_DIR:=$PWD/evidence-runtime-parity}"
AGFI="${FAE_AGFI:-agfi-09f46d7fe160c51df}"
IP_S3="${FAE_C6_IP_S3:-s3://fae-asic-lab-203842200752-20260922/evidence/i-0c43c11717fabb6e7/build-colony-hls-c6/artifacts/fae_dp6_hls_prj/sol_vu47p/impl/ip/xilinx_com_hls_fae_dp6_hls_1_0.zip}"

mkdir -p "$FAE_EVIDENCE_DIR"
exec > >(tee -a "$FAE_EVIDENCE_DIR/runtime-parity.log") 2>&1

fail(){ echo "FAE_F2_RUNTIME_FAIL: $*" >&2; exit 1; }
pass(){ echo "FAE_F2_RUNTIME_PASS: $*"; }

[[ -d "$AWS_FPGA_REPO_DIR/.git" ]] || git clone --depth 1 --branch f2 https://github.com/aws/aws-fpga.git "$AWS_FPGA_REPO_DIR"
[[ -d "$FAE_REPO_DIR/.git" ]] || git clone --branch lab/asic-f2-timing-hardening-bc-001 https://github.com/Waterfound/FAE-testnet.git "$FAE_REPO_DIR"

set +u
source "$AWS_FPGA_REPO_DIR/sdk_setup.sh"
set -u

aws s3 cp "$IP_S3" /tmp/fae-c6-ip.zip --only-show-errors
rm -rf /tmp/fae-c6-ip && mkdir -p /tmp/fae-c6-ip
unzip -q /tmp/fae-c6-ip.zip -d /tmp/fae-c6-ip
HW_HEADER=$(find /tmp/fae-c6-ip -type f -name '*_hw.h' | head -1 || true)
[[ -n "$HW_HEADER" ]] || fail "Vitis HLS control header not found in C6 IP archive"
cp "$HW_HEADER" "$FAE_EVIDENCE_DIR/hls_control_hw.h"

grep -E '_ADDR_AP_CTRL[[:space:]]+0x00' "$HW_HEADER" >/dev/null || fail "unexpected AP_CTRL offset"
grep -E '_ADDR_INPUT_DATA[[:space:]]+0x10' "$HW_HEADER" >/dev/null || fail "unexpected input pointer offset"
grep -E '_ADDR_OUTPUT_DATA[[:space:]]+0x1c' "$HW_HEADER" >/dev/null || fail "unexpected output pointer offset"
grep -E '_ADDR_MATRIX_WORDS_DATA[[:space:]]+0x28' "$HW_HEADER" >/dev/null || fail "unexpected matrix pointer offset"
pass "HLS control register map matches frozen runtime harness"

cd "$FAE_REPO_DIR/labs/asic-f2-pre-go/runtime"
gcc -O2 -std=gnu11 -Wall -Wextra -I"$SDK_DIR/userspace/include" fae_f2_runtime.c -o fae_f2_runtime -lfpga_mgmt
sha256sum fae_f2_runtime > "$FAE_EVIDENCE_DIR/runtime_binary_sha256.txt"

sudo fpga-clear-local-image -S 0 || true
sudo fpga-load-local-image -S 0 -I "$AGFI"
sudo fpga-describe-local-image -S 0 | tee "$FAE_EVIDENCE_DIR/fpga_describe_loaded.txt"
grep -q "$AGFI" "$FAE_EVIDENCE_DIR/fpga_describe_loaded.txt" || fail "loaded AGFI not confirmed"
pass "AFI loaded in FPGA slot 0"

expected=(
"855bb2345c5a6e3c36979ae89cb63a70ab948b077d6590ccf1fb70dff5242c0c"
"b8a5277d9226b434cf67b7bd40abbf6567855eecd21d87b8141ccb89b082053a"
"ac00df85fe2338d511b9fcae75dc509af92e2fde1ce19d9951e4f05c35e0799a"
"93d6481107e50261ea64a8042f2f11207f2124ab0653b2e60bd2ef7fb1e19b4d"
"578553a7ae9e9be5f3feb28986e4189f58a60bab22ba3cc92c8bf14c05de187d"
"b617b446eb572bd6dd2917f5e3538e386a329f748d6236f6955814751b75533c"
"09a62accdff0fe82f9afec271d5ae680e2b5a46aa50be87fa3b3b7f5923ca5ad"
"5c2fe9d4817efe787707146b2e201eb662acb6221444f70c7a5d5cb2361c34c6"
"e363839a9e82a7dfdd8283e937daf4488118faf3ba68b5f84be362dd95b57a23"
"3fd54b69b09a1d9a490788efe36b9f6969563a9b8b3cd4e64dcd9a0f75e850eb"
"caede732f1fa26c0812ebcf61403f63a0b6a4041a2ee524dee86e4d45682759b"
"7daf75d27daeacdce11b39394723a6d53e6bc48b6eddb2e76783f955ef4e7118"
"061c9994ebec724f4c230f45376ec7fcfaaec1db857b2abb4907c25bb1ad1574"
"1ecb554e1beea1f23b3d488439b9290fd9ba0172683b33a769016ff077d3cc30"
"ccc925c3901834d4dcc2c154ea80a786e79ccce0b56215ef5d55ecc02255244b"
"6197d3b23a9f7a52abee994b6bfb820965e7645a815d0170824af43a0d75164b"
)

echo "CANONICAL_START" > "$FAE_EVIDENCE_DIR/stage.txt"
sudo -E ./fae_f2_runtime 1200 "${expected[0]}" canonical_full | tee "$FAE_EVIDENCE_DIR/canonical.log"
grep -q 'FAE_F2_RESULT nonce=1200 .* final=PASS full=PASS' "$FAE_EVIDENCE_DIR/canonical.log" || fail "canonical full-state parity failed"
pass "canonical full 160-byte parity"

echo "VECTORS_16_START" > "$FAE_EVIDENCE_DIR/stage.txt"
: > "$FAE_EVIDENCE_DIR/vectors.log"
pass_count=0
for i in $(seq 0 15); do
  nonce=$((1200+i))
  if sudo -E ./fae_f2_runtime "$nonce" "${expected[$i]}" | tee -a "$FAE_EVIDENCE_DIR/vectors.log"; then
    pass_count=$((pass_count+1))
  else
    fail "nonce $nonce runtime parity failed"
  fi
done
echo "FAE_F2_RUNTIME_16VECTORS=${pass_count}/16" | tee -a "$FAE_EVIDENCE_DIR/vectors.log"
[[ "$pass_count" -eq 16 ]] || fail "16-vector gate incomplete"

echo "PASS_CANONICAL_AND_16V" > "$FAE_EVIDENCE_DIR/stage.txt"
pass "canonical + 16-vector runtime parity"
