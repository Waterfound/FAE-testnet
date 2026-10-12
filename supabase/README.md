# Supabase deployment source

This directory preserves the source retrieved from Supabase project `wfwwotuhectwknvbvgif` on 7 September 2026. No access token, service-role value, database password or private key is committed; deployed functions read platform credentials from `Deno.env`.

## Active function inventory at export

| Function | Version | Supabase bundle SHA-256 | Role |
| --- | ---: | --- | --- |
| `fae-public-testnet-v4` | 5 | `7ddfd6ce914609ed0b96028c5a8668c70a039d5cfd6537f1201f88b970356933` | Current public v4 API and consensus validator |
| `fae-chain-feed-v1` | 1 | `a0d39dde163681ddc5fd81f28bf2cbf1b40aae06bb5280ff17fa633be68377c0` | Read-only chain export |
| `fae-consensus-audit-v1` | 1 | `d7633e711dde8af0e4a9aac97454ca44398959a1c9a872cd9733db4e44ad9557` | Independent database reconstruction/audit |
| `fae-sovereign-forge-v1` | 1 | `f2f1bacc0ba21ec16967ffe8de1a2182a080abdf53bb53058fb5886d0e4ec757` | Read-only Forge export API |
| `fae-health` | 1 | `2041b87a304b9e1029b4b90b8c71cc1c671dfa80a9e1c2760c3529aff58b4e6a` | Health endpoint |
| `fairyelf-testnet` | 1 | `fda5cd59753468841496d4185004176efc6933c78eefd2c8ad02bb4dd613591b` | Legacy self-contained testnet page; not v4 consensus |

The exported text is semantically identical to the retrieved function source. A final POSIX newline was added where the Dashboard-managed source omitted one; Supabase's bundle hash covers its deployment bundle and is recorded above as external provenance.

`migrations/20260903_fae_v4_canonical.sql` is the consolidated v4 schema and atomic state-transition migration captured in FAE Sovereign Forge. Database state and testnet balances are deliberately not stored in Git.

## Release policy

Frontend pushes must not automatically redeploy these consensus functions. A backend deployment requires an explicit review of the source diff, database migration, frozen vectors and rollback plan. The current public browser continues to target `fae-public-testnet-v4`.

## Live security finding

The Supabase database advisor reported that the seven `fae_forge` tables have RLS disabled. This is a live hardening issue for the Forge store if that custom schema is exposed through the Data API. Do not apply a blanket RLS toggle without matching policies, because that could break the Forge API. Resolve exposure, grants and policies as a separate reviewed database change.
