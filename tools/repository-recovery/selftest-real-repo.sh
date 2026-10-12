#!/usr/bin/env bash
set -euo pipefail

: "${SOURCE_URL:?SOURCE_URL is required}"
: "${SOURCE_REF:?SOURCE_REF is required}"
: "${EXPECTED_COMMIT:?EXPECTED_COMMIT is required}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
sync_script="$repo_root/tools/repository-recovery/sync-git-mirror.sh"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

control_repo="$workdir/control"
target_repo="$workdir/target.git"
restore_repo="$workdir/restore"
bundle_restore="$workdir/bundle-restore"
bundle_path="$workdir/fae-testnet.bundle"
manifest="$workdir/mirror-manifest.txt"

git init -q "$control_repo"
git -C "$control_repo" config user.name "FAE Recovery Self-Test"
git -C "$control_repo" config user.email "recovery-selftest@invalid.local"
printf 'reserved control branch\n' > "$control_repo/CONTROL"
git -C "$control_repo" add CONTROL
git -C "$control_repo" commit -q -m "Create reserved backup-control branch"
git -C "$control_repo" branch -M backup-control

git init -q --bare "$target_repo"
git -C "$control_repo" remote add target "file://$target_repo"
git -C "$control_repo" push -q target backup-control:backup-control

git -C "$control_repo" switch -q -c stale-source-ref
printf 'stale ref\n' > "$control_repo/STALE"
git -C "$control_repo" add STALE
git -C "$control_repo" commit -q -m "Create stale destination ref"
git -C "$control_repo" push -q target stale-source-ref:stale-source-ref

SOURCE_URL="$SOURCE_URL" \
DEST_URL="file://$target_repo" \
CONTROL_REF="refs/heads/backup-control" \
MANIFEST_OUT="$manifest" \
bash "$sync_script"

git --git-dir="$target_repo" show-ref --verify --quiet refs/heads/backup-control
if git --git-dir="$target_repo" show-ref --verify --quiet refs/heads/stale-source-ref; then
  echo "ERROR: stale destination ref survived synchronization" >&2
  exit 31
fi

branch_name="${SOURCE_REF#refs/heads/}"
git clone -q "file://$target_repo" "$restore_repo"
git -C "$restore_repo" checkout -q "$branch_name"

restored_commit="$(git -C "$restore_repo" rev-parse HEAD)"
if [ "$restored_commit" != "$EXPECTED_COMMIT" ]; then
  echo "ERROR: restored commit mismatch: expected $EXPECTED_COMMIT got $restored_commit" >&2
  exit 32
fi

git -C "$restore_repo" fsck --full --strict

git --git-dir="$target_repo" bundle create "$bundle_path" --all
git clone -q "$bundle_path" "$bundle_restore"
git -C "$bundle_restore" checkout -q "$branch_name"

bundle_commit="$(git -C "$bundle_restore" rev-parse HEAD)"
if [ "$bundle_commit" != "$EXPECTED_COMMIT" ]; then
  echo "ERROR: bundle restore mismatch: expected $EXPECTED_COMMIT got $bundle_commit" >&2
  exit 33
fi

git -C "$bundle_restore" fsck --full --strict

cd "$restore_repo"

sha256sum -c FAE_FORGE_MAIN.sha256
(
  cd supabase
  sha256sum -c SOURCE_MANIFEST.sha256
)

node --check core.js
node --check wallet-crypto.js
node --check wallet.js
node --check mining.js
node --check network-status.js
node tests/crypto-compat.mjs
node tests/client-smoke.mjs
npm ci --prefix sovereign-forge/node
npm run --prefix sovereign-forge/node check
node sovereign-forge/tests/smoke-independent-node.mjs

printf 'RECOVERY_SELFTEST_GREEN\n'
printf 'source_ref=%s\n' "$SOURCE_REF"
printf 'expected_commit=%s\n' "$EXPECTED_COMMIT"
printf 'restored_commit=%s\n' "$restored_commit"
printf 'bundle_commit=%s\n' "$bundle_commit"
printf 'manifest_sha256=%s\n' "$(sha256sum "$manifest" | awk '{print $1}')"
