#!/usr/bin/env bash
set -euo pipefail
# Disposable Linux/Xvfb CI-only test. Real Electron OS processes, shared profile.
if [ "${CI:-}" != "true" ]; then
  echo "Refusing native desktop lock smoke outside CI" >&2
  exit 2
fi
scratch="$(mktemp -d)"
primary=""
cleanup() {
  if [ -n "$primary" ] && kill -0 "$primary" 2>/dev/null; then
    kill "$primary" 2>/dev/null || true
    wait "$primary" || true
  fi
  rm -rf "$scratch"
}
trap cleanup EXIT
"./node_modules/.bin/electron" --no-sandbox . --ts-lock-owner-smoke >"$scratch/owner.log" 2>&1 &
primary=$!
ready=""
for i in $(seq 1 72); do
  if grep -q TS_PRIMARY_LOCK_READY "$scratch/owner.log"; then ready=yes; break; fi
  if ! kill -0 "$primary" 2>/dev/null; then cat "$scratch/owner.log"; exit 1; fi
  sleep 0.15
done
if [ "$ready" != yes ]; then cat "$scratch/owner.log"; echo "No primary desktop lock" >&2; exit 1; fi
"./node_modules/.bin/electron" --no-sandbox . --ts-lock-probe >"$scratch/secondary.log" 2>&1
if ! grep -q TS_SECONDARY_LOCK_REJECTED "$scratch/secondary.log"; then
  cat "$scratch/owner.log"; cat "$scratch/secondary.log"
  echo "Second native instance was not blocked" >&2
  exit 1
fi
if ! kill -0 "$primary" 2>/dev/null; then echo "Primary exited prematurely" >&2;exit 1;fi
echo "TS_SINGLE_INSTANCE_REAL_PROCESS_PASS"
