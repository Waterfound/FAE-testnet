#!/bin/bash
set -Eeuo pipefail
export HOME=/root
BUCKET="fae-asic-lab-203842200752-20260922"
BRANCH="lab/asic-f2-timing-hardening-bc-001"
EXPECTED_BLOB="a663c5928123c7a379c9c5478e492fbb92cd8abe"
WORK="/opt/fae-c5-parity"
LOG="/var/log/fae-c5-parity"
mkdir -p "$WORK" "$LOG"
exec > >(tee -a "$LOG/run.log") 2>&1
TOKEN=$(curl -fsS -X PUT -H "X-aws-ec2-metadata-token-ttl-seconds: 1800" http://169.254.169.254/latest/api/token)
IID=$(curl -fsS -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)
PREFIX="evidence/$IID/build-colony-c5-parity"

sync_all(){ set +e; aws s3 sync "$LOG" "s3://$BUCKET/$PREFIX/" --sse AES256 --only-show-errors || true; set -e; }
finish(){ rc=$?; set +e; echo "$rc" > "$LOG/exit_code.txt"; date -u +"%Y-%m-%dT%H:%M:%SZ" > "$LOG/finished_utc.txt"; sync_all; shutdown -h now || true; }
trap finish EXIT
( sleep 7200; echo WATCHDOG_EXPIRED > "$LOG/stage.txt"; sync_all; shutdown -h now ) &
echo BOOTSTRAP > "$LOG/stage.txt"; sync_all

cd "$WORK"
git clone --branch "$BRANCH" https://github.com/Waterfound/FAE-testnet.git repo
cd repo
git rev-parse HEAD > "$LOG/fae_repo_head.txt"
BLOB=$(git hash-object labs/asic-f2-pre-go/hls/fae_dp6_hls.cpp)
echo "$BLOB" > "$LOG/hls_blob.txt"
test "$BLOB" = "$EXPECTED_BLOB"
cd labs/asic-f2-pre-go/hls
sha256sum fae_dp6_hls.cpp test_canonical.cpp test_16_vectors.cpp > "$LOG/input_sha256.txt"

echo COMPILE > "$LOG/stage.txt"; sync_all
g++ -O3 -std=c++17 test_canonical.cpp -o /tmp/canonical
g++ -O3 -std=c++17 fae_dp6_hls.cpp test_16_vectors.cpp -o /tmp/vectors

echo RUN_CANONICAL > "$LOG/stage.txt"; sync_all
/tmp/canonical | tee "$LOG/canonical.log"
grep -q 'FAE_DP6_HLS_CANONICAL=PASS' "$LOG/canonical.log"

echo RUN_16_VECTORS > "$LOG/stage.txt"; sync_all
/tmp/vectors | tee "$LOG/vectors.log"
grep -q 'FAE_DP6_HLS_16VECTORS=16/16' "$LOG/vectors.log"

echo PASS_CANONICAL_AND_16V > "$LOG/stage.txt"; sync_all
