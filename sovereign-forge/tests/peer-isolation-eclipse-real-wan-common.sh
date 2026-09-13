#!/usr/bin/env bash
set -euo pipefail

# Reuse the already-proven rendezvous, Cloudflare and localhost.run helpers.
source "$(dirname "${BASH_SOURCE[0]}")/full-target-shadow-free-real-wan-common.sh"

wan_tunnel_provider(){
  local url="$1"
  case "$url" in
    https://*.trycloudflare.com) printf '%s\n' cloudflare-quick-tunnel ;;
    https://*.localhost.run|https://*.lhr.life|https://*.lhrtunnel.link) printf '%s\n' localhost-run ;;
    http://*.pinggy.link:*|http://*.free.pinggy.link:*|http://*.free.pinggy.online:*) printf '%s\n' pinggy-tcp ;;
    *) printf '%s\n' unknown ;;
  esac
}

wan_start_pinggy_tcp_tunnel(){
  local port="$1" log="$2" pid_file="$3"
  local attempt attempt_log tcp_url http_url start now pid known_hosts
  : >"$log"
  known_hosts="${log}.pinggy-known-hosts"
  : >"$known_hosts"

  # Pinggy TCP is deliberately used instead of its HTTP tunnel. The FAE node
  # remains the HTTP endpoint; Pinggy only forwards raw TCP and therefore does
  # not inject browser screening or HTTP middleware into protocol-6 traffic.
  for attempt in 1 2; do
    attempt_log="${log}.pinggy-${attempt}"
    : >"$attempt_log"
    ssh -T -p 443 \
      -o StrictHostKeyChecking=accept-new \
      -o UserKnownHostsFile="$known_hosts" \
      -o ServerAliveInterval=15 \
      -o ServerAliveCountMax=3 \
      -o ExitOnForwardFailure=yes \
      -R "0:127.0.0.1:${port}" \
      tcp@free.pinggy.io >"$attempt_log" 2>&1 &
    pid=$!
    echo "$pid" >"$pid_file"
    start=$(date +%s); tcp_url=''

    while :; do
      tcp_url=$(grep -Eo 'tcp://[A-Za-z0-9.-]+:[0-9]+' "$attempt_log" | head -n1 || true)
      [[ -n "$tcp_url" ]] && break
      wan_process_alive "$pid" || break
      now=$(date +%s); (( now-start < 40 )) || break
      sleep 2
    done

    if [[ -n "$tcp_url" ]]; then
      http_url="http://${tcp_url#tcp://}"
      if wan_wait_http "${http_url}/status" 40; then
        {
          echo "--- pinggy attempt ${attempt}: READY ${http_url} ---"
          cat "$attempt_log"
        } >>"$log"
        printf '%s\n' "$http_url"
        return 0
      fi
    fi

    {
      echo "--- pinggy attempt ${attempt}: bootstrap failed ---"
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

wan_start_required_provider(){
  local provider="$1" port="$2" log="$3" pid_file="$4" bin="${5:-/tmp/cloudflared}"
  case "$provider" in
    cloudflare)
      [[ -x "$bin" ]] || wan_install_cloudflared "$bin" >/dev/null
      wan_start_cloudflare_tunnel "$port" "$log" "$pid_file" "$bin"
      ;;
    localhost-run) wan_start_localhost_run_tunnel "$port" "$log" "$pid_file" ;;
    pinggy) wan_start_pinggy_tcp_tunnel "$port" "$log" "$pid_file" ;;
    *) echo "invalid required provider: $provider" >&2; return 1 ;;
  esac
}
