#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
SRC="$ROOT/labs/asic-f2-pre-go/independent-verifier/dp6-independent-verifier.cpp"
ARGON2_COMMIT="f57e61e19229e23c4445b85494dbf7c07de721cb"
if [ -n "$FAE_DP6_ARGON2_DIR" ]; then
  ARGON_DIR="$FAE_DP6_ARGON2_DIR"
else
  ARGON_DIR="/tmp/fae-dp6-argon2-$ARGON2_COMMIT"
fi
if [ "$#" -gt 0 ]; then OUT="$1"; else OUT="/tmp/fae-dp6-independent-verifier"; fi

command -v git >/dev/null
command -v make >/dev/null
command -v gcc >/dev/null
command -v g++ >/dev/null
test -f /usr/include/openssl/sha.h || {
  echo "missing OpenSSL development headers (/usr/include/openssl/sha.h)" >&2
  exit 2
}

if [ ! -d "$ARGON_DIR/.git" ]; then
  rm -rf "$ARGON_DIR"
  git clone --filter=blob:none https://github.com/P-H-C/phc-winner-argon2.git "$ARGON_DIR"
fi

git -C "$ARGON_DIR" fetch --quiet origin "$ARGON2_COMMIT"
git -C "$ARGON_DIR" checkout --quiet --detach "$ARGON2_COMMIT"
test "$(git -C "$ARGON_DIR" rev-parse HEAD)" = "$ARGON2_COMMIT"

make -C "$ARGON_DIR" clean >/dev/null 2>&1 || true
make -C "$ARGON_DIR" OPTTARGET=none NO_THREADS=1 libargon2.a >/dev/null

g++ -O3 -std=c++20   -I"$ARGON_DIR/include"   -I"$ARGON_DIR/src"   "$SRC" "$ARGON_DIR/libargon2.a" -lcrypto -o "$OUT"

echo "FAE_DP6_INDEPENDENT_VERIFIER_BUILT=$OUT"
echo "ARGON2_REFERENCE_COMMIT=$ARGON2_COMMIT"
