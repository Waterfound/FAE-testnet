# Immutable FAE node + independent desktop read gateway — candidate

This draft restores sovereign-forge/node/fae-node.mjs to its exact byte-for-byte imported main version and leaves FAE_FORGE_MAIN.sha256 unchanged. This preserves the canonical source integrity gate.

The separate standalone/desktop-read-gateway.cjs is a candidate for use inside a trusted Electron native process. It binds to ephemeral 127.0.0.1 only, generates a random 256-bit token at startup, requires the token for GET-only operations, denies Origin and OPTIONS browser traffic, validates FAE network identity, limits accepted routes and response size, and never exposes signing keys. The token must never be passed to a renderer, to public browser scripts, or to wallet/miner subprocesses.

IMPORTANT SECURITY HOLD: The unmodified FAE independent node itself remains a separate loopback HTTP listener with wildcard CORS. Requests directed to the raw node bypass the gateway. This candidate therefore does not eliminate browser access to the original listener and DOES NOT prove cryptographic process identity, upstream authenticity, port anti-hijacking, or readiness for wallet signing. The gateway can protect only its own restricted read API. The real native node ownership/transport problem requires an admitted architecture-level solution.

Dedicated regression tests run the actual unmodified node on a disposable loopback port in Windows, macOS and Linux CI, assert the protected manifest bytes, verify valid authenticated gateway reads, and deny browser requests, unauthenticated calls, mutating operations and forbidden routes. They also explicitly demonstrate the original node's unchanged CORS behavior.

No consensus, economics, network, wallet signing, frozen source or frozen integrity-manifest change. Remain Draft and require owner admission before integrating into PR #352. No release or production activation.
