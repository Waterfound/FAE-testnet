# Optional native desktop browser-Origin guard — candidate

This is an isolated, opt-in HTTP transport hardening candidate for the existing FAE independent node, **not** a consensus/network activation or a substitute native process-authentication protocol.

When `FAE_DESKTOP_LOCAL_ONLY=1` is supplied to a client-owned node, it denies HTTP requests with an `Origin` header and preflight `OPTIONS` requests, and omits permissive CORS response headers. Node CLI and miner requests without an Origin remain functional. By default, the existing browser-facing testnet CORS behavior is unchanged for compatibility.

A malicious local native program, pre-bind port hijack, same-user process introspection, or forged same-machine listener are **NOT** solved by browser-origin denial. True process-authenticated transport must be solved before trusted native Vault signing or release. This branch does not implement any wallet signing or remote service operation.

The isolated tests launch the existing real Node.js FAE independent node on an ephemeral loopback port and verify the negative and backward-compatible contract across Windows/macOS/Linux CI. No new issuer, miner, PoW, block economics, trusted key or upstream endpoint is introduced.

**Do not merge or turn this on in the Universal Client without separate source owner review/admission.** This Draft is for security engineering evidence only.
