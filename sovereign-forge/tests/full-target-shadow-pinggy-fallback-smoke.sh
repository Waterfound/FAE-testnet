#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${FAE_PINGGY_SMOKE_DIR:-/tmp/fae-pinggy-smoke}"
mkdir -p "$WORK/data"
NODE_PID_FILE="$WORK/node.pid"
SSH_PID_FILE="$WORK/pinggy.pid"
NODE_LOG="$WORK/node.log"
PINGGY_LOG="$WORK/pinggy.log"
DEBUGGER_PORT="${FAE_PINGGY_DEBUGGER_PORT:-4300}"

stop_pid_file(){
  local file="$1" pid
  [[ -f "$file" ]] || return 0
  pid=$(cat "$file" 2>/dev/null || true)
  [[ -n "$pid" ]] || return 0
  kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || return 0; sleep 0.25; done
  kill -KILL "$pid" 2>/dev/null || true
}
cleanup(){ stop_pid_file "$SSH_PID_FILE"; stop_pid_file "$NODE_PID_FILE"; }
trap cleanup EXIT

FAE_SHADOW_HOST=127.0.0.1 \
FAE_SHADOW_PORT=8788 \
FAE_SHADOW_PROFILE=trusted \
FAE_SHADOW_LABEL=pinggy-fallback-smoke \
FAE_SHADOW_DATA_FILE="$WORK/data/state.json" \
FAE_SHADOW_IDENTITY_FILE="$WORK/data/identity.json" \
FAE_SHADOW_EVIDENCE_FILE="$WORK/data/evidence.jsonl" \
FAE_SHADOW_SYNC=0 \
node "$ROOT/node/lab/fae-full-target-shadow-validation-node.mjs" >"$NODE_LOG" 2>&1 &
echo $! >"$NODE_PID_FILE"

for _ in $(seq 1 60); do
  curl -fsS --max-time 3 http://127.0.0.1:8788/status >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS --max-time 5 http://127.0.0.1:8788/status >"$WORK/local-status.json"

ssh \
  -o BatchMode=yes \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  -o ExitOnForwardFailure=yes \
  -o ConnectTimeout=15 \
  -o ServerAliveInterval=15 \
  -o ServerAliveCountMax=3 \
  -p 443 \
  -R0:127.0.0.1:8788 \
  -L"${DEBUGGER_PORT}":127.0.0.1:4300 \
  -T free.pinggy.io >"$PINGGY_LOG" 2>&1 &
echo $! >"$SSH_PID_FILE"

PUBLIC_URL=''
for _ in $(seq 1 45); do
  if urls=$(curl -fsS --max-time 3 "http://127.0.0.1:${DEBUGGER_PORT}/urls" 2>/dev/null); then
    PUBLIC_URL=$(jq -r '.urls[]? | select(startswith("https://"))' <<<"$urls" | head -n1 || true)
    [[ -n "$PUBLIC_URL" ]] || PUBLIC_URL=$(jq -r '.urls[]? | select(startswith("http://"))' <<<"$urls" | head -n1 || true)
    [[ -n "$PUBLIC_URL" ]] && break
  fi
  kill -0 "$(cat "$SSH_PID_FILE")" 2>/dev/null || { cat "$PINGGY_LOG" >&2; exit 1; }
  sleep 1
done
[[ -n "$PUBLIC_URL" ]] || { cat "$PINGGY_LOG" >&2; exit 1; }

PUBLIC_STATUS=''
for _ in $(seq 1 45); do
  if PUBLIC_STATUS=$(curl -fsS --max-time 5 "${PUBLIC_URL}/status" 2>/dev/null) \
    && jq -e '.status=="lab-only-no-consensus-authority" and .height==12' >/dev/null 2>&1 <<<"$PUBLIC_STATUS"; then
    break
  fi
  PUBLIC_STATUS=''
  sleep 1
done
[[ -n "$PUBLIC_STATUS" ]] || { cat "$PINGGY_LOG" >&2; exit 1; }

printf '%s\n' "$PUBLIC_STATUS" >"$WORK/public-status.json"
RESULT=$(jq -nc \
  --arg url "$PUBLIC_URL" \
  --arg boot_id "$(cat /proc/sys/kernel/random/boot_id)" \
  --arg runner "${RUNNER_NAME:-unknown}" \
  '{status:"PASS",scenario:"pinggy-fallback-public-http-smoke",provider:"pinggy-free-http",public_url:$url,runner:$runner,boot_id:$boot_id,public_status_verified:true,consensus_authority:false}')
printf '%s\n' "$RESULT" | tee "$WORK/result.json"
