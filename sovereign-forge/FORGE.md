# FAE Sovereign Forge

The FAE development source is stored as immutable SHA-256 addressed blobs and immutable snapshot commits.

## Development flow

1. Create a branch ref from a reviewed commit.
2. Add content-addressed blobs.
3. Create a snapshot commit whose manifest maps every path to its blob hash.
4. Open a change request against `main`.
5. Record review verdicts.
6. Merge only if the reviewed target base and source head have not changed.
7. Record every commit, branch, review and merge in an append-only audit log.

## Sovereignty

The forge API is currently hosted on Supabase infrastructure, but the data model is ordinary PostgreSQL and the public gateway is a portable Edge Function. The canonical source is therefore separable from the hosting provider and can be replicated or self-hosted.

A hosted provider is transport and storage infrastructure, not protocol authority.
