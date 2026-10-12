$ErrorActionPreference = "Stop"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Error "Node.js 22+ is required. Browser-only online mode remains available."; exit 2 }
$major = [int]((node -p "process.versions.node.split('.')[0]"))
if ($major -lt 22) { Write-Error "Node.js 22+ is required; found $(node -v)."; exit 2 }
node "$PSScriptRoot\desktop-agent.mjs" @args
