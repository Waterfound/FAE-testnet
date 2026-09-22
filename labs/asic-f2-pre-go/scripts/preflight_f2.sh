#!/usr/bin/env bash
set -euo pipefail
EXPECTED_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
SUPPORTED_RE='^(2024\.1|2024\.2|2025\.1|2025\.2)$'
fail(){ echo "PREGO_FAIL: $*" >&2; exit 1; }
pass(){ echo "PREGO_PASS: $*"; }

[[ "$(uname -m)" == "x86_64" ]] || fail "AMD tools require x86_64"
for c in git git-lfs aws python3 vivado vitis_hls sha256sum; do command -v "$c" >/dev/null || fail "missing $c"; done
pass "required executables present"

if env | cut -d= -f1 | grep -Eiq '(FAE_.*(SEED|PRIVATE|WALLET|TESTNET|MAINNET)|PRIVATE_KEY|MNEMONIC)'; then
  fail "wallet/testnet/mainnet/private-key-like environment variable detected"
fi
pass "no FAE authority/secret environment variable names detected"

VIVADO_VERSION=$(vivado -version | sed -n 's/.*Vivado v\([0-9][0-9]*\.[0-9][0-9]*\).*/\1/p' | head -1)
[[ "$VIVADO_VERSION" =~ $SUPPORTED_RE ]] || fail "unsupported Vivado version: ${VIVADO_VERSION:-unknown}"
pass "Vivado $VIVADO_VERSION is within frozen pre-GO allowlist"

: "${AWS_FPGA_REPO_DIR:=$HOME/src/aws-fpga}"
if [[ ! -d "$AWS_FPGA_REPO_DIR/.git" ]]; then
  mkdir -p "$(dirname "$AWS_FPGA_REPO_DIR")"
  git clone --depth 1 --branch f2 https://github.com/aws/aws-fpga.git "$AWS_FPGA_REPO_DIR"
fi
[[ "$(git -C "$AWS_FPGA_REPO_DIR" branch --show-current)" == "f2" ]] || fail "aws-fpga is not on f2 branch"
source "$AWS_FPGA_REPO_DIR/hdk_setup.sh"
grep -q "$VIVADO_VERSION" "$AWS_FPGA_REPO_DIR/supported_vivado_versions.txt" || fail "Vivado not supported by checked-out F2 HDK"
pass "AWS F2 HDK setup accepts Vivado $VIVADO_VERSION"

[[ "$EXPECTED_REGION" == "us-east-1" ]] || echo "PREGO_WARN: region is $EXPECTED_REGION; cost/availability must be rechecked"
aws sts get-caller-identity --query Account --output text >/dev/null || fail "AWS credentials/account not usable"
pass "AWS account credentials usable (account id intentionally not printed)"

echo "PREGO_READY: environment is ready for HLS/Vivado build; no EC2 instance or AFI was created by this script."
