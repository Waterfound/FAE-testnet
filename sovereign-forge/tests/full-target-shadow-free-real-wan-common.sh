#!/usr/bin/env bash
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${ISSUE_NUMBER:?ISSUE_NUMBER is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"

FAE_WAN_API="https://api.github.com/repos/${GITHUB_REPOSITORY}/issues/${ISSUE_NUMBER}"

wan_comments(){
  curl -fsS --retry 3 \
    -H "Authorization: Bearer ${GH_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "${FAE_WAN_API}/comments?per_page=100"
}

wan_post(){
  local marker="$1" json="$2" body
  body="${marker} ${json}"
  jq -nc --arg body "$body" '{body:$body}' | \
    curl -fsS --retry 3 -X POST \
      -H "Authorization: Bearer ${GH_TOKEN}" \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      -H "Content-Type: application/json" \
      "${FAE_WAN_API}/comments" -d @- >/dev/null
}

wan_marker_json(){
  local marker="$1"
  wan_comments | jq -r --arg prefix "${marker} " --arg run "${GITHUB_RUN_ID}" '
    [.[].body
      | select(startswith($prefix))
      | sub("^" + ($prefix|gsub("([.^$*+?()\\[\\]{}|\\\\])"; "\\\\\\1")); "")
      | (fromjson? // empty)
      | select((.run_id|tostring)==$run)]
    | last // empty
    | @json'
}

wan_role_json(){
  local marker="$1" role="$2"
  wan_comments | jq -r --arg prefix "${marker} " --arg run "${GITHUB_RUN_ID}" --arg role "$role" '
    [.[].body
      | select(startswith($prefix))
      | .[($prefix|length):]
      | (fromjson? // empty)
      | select((.run_id|tostring)==$run and .role==$role)]
    | last // empty
    | @json'
}

wan_phase_json(){
  local marker="$1" phase="$2"
  wan_comments | jq -r --arg prefix "${marker} " --arg run "${GITHUB_RUN_ID}" --arg phase "$phase" '
    [.[].body
      | select(startswith($prefix))
      | .[($prefix|length):]
      | (fromjson? // empty)
      | select((.run_id|tostring)==$run and .phase==$phase)]
    | last // empty
    | @json'
}

wan_wait_role(){
  local marker="$1" role="$2" timeout_s="${3:-300}" start now value
  start=$(date +%s)
  while :; do
    value=$(wan_role_json "$marker" "$role")
    if [[ -n "$value" && "$value" != "null" ]]; then printf '%s\n' "$value"; return 0; fi
    now=$(date +%s); (( now-start < timeout_s )) || return 1
    sleep 2
  done
}

wan_wait_phase(){
  local marker="$1" phase="$2" timeout_s="${3:-300}" start now value
  start=$(date +%s)
  while :; do
    value=$(wan_phase_json "$marker" "$phase")
    if [[ -n "$value" && "$value" != "null" ]]; then printf '%s\n' "$value"; return 0; fi
    now=$(date +%s); (( now-start < timeout_s )) || return 1
    sleep 2
  done
}

wan_install_cloudflared(){
  local arch url out="${1:-/tmp/cloudflared}"
  case "$(uname -m)" in
    x86_64) arch=amd64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) echo "unsupported cloudflared architecture: $(uname -m)" >&2; return 1 ;;
  esac
  url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}"
  curl -fsSL --retry 5 --retry-delay 2 "$url" -o "$out"
  chmod +x "$out"
  "$out" --version
}

wan_wait_http(){
  local url="$1" timeout_s="${2:-90}" start now
  start=$(date +%s)
  while :; do
    if curl -fsS --max-time 10 --retry 1 "$url" >/dev/null 2>&1; then return 0; fi
    now=$(date +%s); (( now-start < timeout_s )) || return 1
    sleep 2
  done
}

wan_start_tunnel(){
  local port="$1" log="$2" pid_file="$3" bin="${4:-/tmp/cloudflared}" url start now
  : >"$log"
  "$bin" tunnel --no-autoupdate --url "http://127.0.0.1:${port}" >"$log" 2>&1 &
  echo $! >"$pid_file"
  start=$(date +%s)
  while :; do
    url=$(grep -Eo 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$log" | head -n1 || true)
    if [[ -n "$url" ]]; then
      wan_wait_http "${url}/status" 90
      printf '%s\n' "$url"
      return 0
    fi
    if ! kill -0 "$(cat "$pid_file")" 2>/dev/null; then cat "$log" >&2; return 1; fi
    now=$(date +%s); (( now-start < 90 )) || { cat "$log" >&2; return 1; }
    sleep 2
  done
}

wan_stop_pid_file(){
  local file="$1" signal="${2:-TERM}" pid
  [[ -f "$file" ]] || return 0
  pid=$(cat "$file" 2>/dev/null || true)
  [[ -n "$pid" ]] || return 0
  kill -s "$signal" "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || return 0; sleep 0.25; done
  kill -KILL "$pid" 2>/dev/null || true
}

wan_json_status(){
  local url="$1"
  curl -fsS --max-time 15 --retry 3 --retry-delay 1 "${url}/status"
}
