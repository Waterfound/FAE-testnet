# GitLab recovery-control package

This directory contains the self-sufficient control package intended for the
`backup-control` branch of an independent GitLab mirror.

It is deliberately separate from mirrored source refs. The mirror engine keeps
`refs/heads/backup-control` reserved and refuses to mirror a source repository
that owns that ref.

## Components

- `gitlab-ci.yml` — scheduled/manual GitLab pipeline definition.
- `run-mirror.sh` — fail-closed GitLab-side controller.
- `../sync-git-mirror.sh` — Git transport/integrity primitive copied into the
  control branch by `../bootstrap-gitlab-control.sh`.

## Required GitLab project settings

1. Create the destination project with the same visibility as the source.
2. Enable **Settings -> CI/CD -> Job token permissions -> Allow Git push
   requests to the repository**.
3. Protect `backup-control` so ordinary development does not mutate it.
4. Create a scheduled pipeline targeting `backup-control` at an interval no
   greater than 48 hours.
5. Set `FAE_SOURCE_URL` as a project variable:
   - public source: `https://github.com/Waterfound/FAE-testnet.git`
   - private source: `git@github.com:Waterfound/FAE-Development-Documentation.git`
6. For a private GitHub source, add `GITHUB_READ_SSH_KEY_FILE` as a protected
   GitLab **file-type** variable containing the private half of a dedicated,
   repository-scoped, read-only GitHub deploy key.

The private source path uses GitHub's published Ed25519 host key and
`StrictHostKeyChecking=yes`; it does not trust `ssh-keyscan` at runtime.

## Bootstrap

From an authenticated environment that can push to the empty GitLab project:

```sh
DEST_URL='<gitlab destination URL>' \
FAE_SOURCE_URL='<github source URL>' \
bash tools/repository-recovery/bootstrap-gitlab-control.sh
```

Then create the scheduled pipeline in GitLab. The normal mirror path uses the
short-lived `CI_JOB_TOKEN` for writes to the same GitLab project. No long-lived
GitLab write token is required by scheduled operation.

## Authority boundary

The mirror controller copies Git objects and records integrity evidence only.
It has no consensus, economics, wallet, deployment, release, or mainnet
authority.
