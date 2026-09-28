#!/usr/bin/env sh
set -eu
command -v node >/dev/null 2>&1 || { echo "Node.js 22+ is required. Browser-only online mode remains available."; exit 2; }
node_major="$(node -p \"Number(process.versions.node.split('.')[0])\")"
[ "$node_major" -ge 22 ] || { echo "Node.js 22+ is required; found $(node -v)."; exit 2; }
exec node "$(dirname "$0")/desktop-agent.mjs" "$@"
