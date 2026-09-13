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

wan_process_alive(){
  local pid="$1" stat
  kill -0 "$pid" 2>/dev/null || return 1
  stat=$(ps -o stat= -p "$pid" 2>/dev/null | tr -d ' ' || true)
  [[ -n "$stat" && "$stat" != Z* ]]
}

wan_tunnel_provider(){
  local url="$1"
  case "$url" in
    https://*.trycloudflare.com) printf '%s\n' cloudflare-quick-tunnel ;;
    https://*.localhost.run|https://*.lhr.life|https://*.lhrtunnel.link) printf '%s\n' localhost-run ;;
    *) printf '%s\n' unknown ;;
  esac
}

wan_start_cloudflare_tunnel(){
  local port="$1" log="$2" pid_file="$3" bin="${4:-/tmp/cloudflared}"
  local attempt attempt_log url start now pid
  : >"$log"
  [[ -x "$bin" ]] || { echo "cloudflared unavailable: ${bin}" >>"$log"; return 1; }

  # Quick Tunnels are ephemeral. Treat only bootstrap/endpoint-readiness failure
  # as retryable. Once a public endpoint passes /status, the protocol is fail-closed.
  for attempt in 1 2; do
    attempt_log="${log}.cloudflare-${attempt}"
    : >"$attempt_log"
    "$bin" tunnel --no-autoupdate --url "http://127.0.0.1:${port}" >"$attempt_log" 2>&1 &
    pid=$!
    echo "$pid" >"$pid_file"
    start=$(date +%s)
    url=''

    while :; do
      url=$(grep -Eo 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$attempt_log" | head -n1 || true)
      [[ -n "$url" ]] && break
      wan_process_alive "$pid" || break
      now=$(date +%s); (( now-start < 30 )) || break
      sleep 2
    done

    if [[ -n "$url" ]] && wan_wait_http "${url}/status" 35; then
      {
        echo "--- cloudflare attempt ${attempt}: READY ${url} ---"
        cat "$attempt_log"
      } >>"$log"
      printf '%s\n' "$url"
      return 0
    fi

    {
      echo "--- cloudflare attempt ${attempt}: bootstrap failed ---"
      cat "$attempt_log"
    } >>"$log"
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 12); do wan_process_alive "$pid" || break; sleep 0.25; done
    kill -KILL "$pid" 2>/dev/null || true
    rm -f "$pid_file"
    sleep 1
  done
  return 1
}

wan_start_localhost_run_tunnel(){
  local port="$1" log="$2" pid_file="$3"
  local attempt attempt_log url line host start now pid known_hosts
  : >"$log"
  known_hosts="${log}.localhost-run-known-hosts"
  : >"$known_hosts"

  for attempt in 1 2; do
    attempt_log="${log}.localhost-run-${attempt}"
    : >"$attempt_log"
    ssh -T \
      -o StrictHostKeyChecking=accept-new \
      -o UserKnownHostsFile="$known_hosts" \
      -o ServerAliveInterval=15 \
      -o ServerAliveCountMax=3 \
      -o ExitOnForwardFailure=yes \
      -R "80:127.0.0.1:${port}" \
      nokey@localhost.run >"$attempt_log" 2>&1 &
    pid=$!
    echo "$pid" >"$pid_file"
    start=$(date +%s)
    url=''

    while :; do
      line=$(grep -E 'tunneled with tls termination' "$attempt_log" | tail -n1 || true)
      if [[ -n "$line" ]]; then
        url=$(grep -Eo 'https://[A-Za-z0-9.-]+' <<<"$line" | tail -n1 || true)
        if [[ -z "$url" ]]; then
          host=$(awk '{print $1}' <<<"$line")
          [[ "$host" =~ ^[A-Za-z0-9.-]+$ ]] && url="https://${host}"
        fi
      fi
      [[ -n "$url" ]] && break
      wan_process_alive "$pid" || break
      now=$(date +%s); (( now-start < 35 )) || break
      sleep 2
    done

    if [[ -n "$url" ]] && wan_wait_http "${url}/status" 35; then
      {
        echo "--- localhost.run attempt ${attempt}: READY ${url} ---"
        cat "$attempt_log"
      } >>"$log"
      printf '%s\n' "$url"
      return 0
    fi

    {
      echo "--- localhost.run attempt ${attempt}: bootstrap failed ---"
      cat "$attempt_log"
    } >>"$log"
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 12); do wan_process_alive "$pid" || break; sleep 0.25; done
    kill -KILL "$pid" 2>/dev/null || true
    rm -f "$pid_file"
    sleep 1
  done
  return 1
}

wan_start_tunnel(){
  local port="$1" log="$2" pid_file="$3" bin="${4:-/tmp/cloudflared}"
  local preference="${FAE_WAN_TUNNEL_PROVIDER:-auto}" url
  case "$preference" in
    cloudflare)
      [[ -x "$bin" ]] || { echo "cloudflared unavailable: ${bin}" >&2; return 1; }
      wan_start_cloudflare_tunnel "$port" "$log" "$pid_file" "$bin"
      ;;
    localhost-run)
      wan_start_localhost_run_tunnel "$port" "$log" "$pid_file"
      ;;
    auto)
      if [[ -x "$bin" ]] && url=$(wan_start_cloudflare_tunnel "$port" "$log" "$pid_file" "$bin"); then
        printf '%s\n' "$url"
        return 0
      fi
      echo "Cloudflare Quick Tunnel bootstrap unavailable; falling back to localhost.run" >&2
      if url=$(wan_start_localhost_run_tunnel "$port" "$log" "$pid_file"); then
        printf '%s\n' "$url"
        return 0
      fi
      cat "$log" >&2
      return 1
      ;;
    *)
      echo "invalid FAE_WAN_TUNNEL_PROVIDER: ${preference}" >&2
      return 1
      ;;
  esac
}

wan_stop_pid_file(){
  local file="$1" signal="${2:-TERM}" pid
  [[ -f "$file" ]] || return 0
  pid=$(cat "$file" 2>/dev/null || true)
  [[ -n "$pid" ]] || return 0
  kill -s "$signal" "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do wan_process_alive "$pid" || return 0; sleep 0.25; done
  kill -KILL "$pid" 2>/dev/null || true
}

wan_json_status(){
  local url="$1" timeout_s="${2:-90}" start now body
  start=$(date +%s)
  while :; do
    if body=$(curl -fsS --max-time 15 "$url/status" 2>/dev/null) \
      && jq -e 'type=="object"' >/dev/null 2>&1 <<<"$body"; then
      printf '%s\n' "$body"
      return 0
    fi
    now=$(date +%s)
    (( now-start < timeout_s )) || {
      echo "public status endpoint did not become readable within ${timeout_s}s: ${url}" >&2
      return 1
    }
    sleep 2
  done
}
