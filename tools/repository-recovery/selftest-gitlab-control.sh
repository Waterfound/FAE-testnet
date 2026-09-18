#!/usr/bin/env bash
set -euo pipefail

: "${SOURCE_URL:?SOURCE_URL is required}"
: "${EXPECTED_COMMIT:?EXPECTED_COMMIT is required}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bootstrap="$repo_root/tools/repository-recovery/bootstrap-gitlab-control.sh"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

target="$workdir/target.git"
control_checkout="$workdir/control-checkout"
manifest="$workdir/manifest.txt"

git init -q --bare "$target"

DEST_URL="file://$target" FAE_SOURCE_URL="$SOURCE_URL" bash "$bootstrap"

git --git-dir="$target" show-ref --verify --quiet refs/heads/backup-control

git clone -q --branch backup-control "file://$target" "$control_checkout"

test -f "$control_checkout/.gitlab-ci.yml"
test -x "$control_checkout/control/run-mirror.sh" || chmod +x "$control_checkout/control/run-mirror.sh"
test -f "$control_checkout/control/sync-git-mirror.sh"

if (
  cd "$control_checkout"
  CI_COMMIT_REF_NAME=main   FAE_SOURCE_URL="$SOURCE_URL"   FAE_TEST_MODE=1   FAE_DEST_URL_OVERRIDE="file://$target"   bash control/run-mirror.sh
); then
  echo "ERROR: controller accepted execution from non-control branch identity" >&2
  exit 51
fi

if (
  cd "$control_checkout"
  CI_COMMIT_REF_NAME=backup-control   FAE_SOURCE_URL="git@github.com:example/private.git"   FAE_TEST_MODE=1   FAE_DEST_URL_OVERRIDE="file://$target"   bash control/run-mirror.sh
); then
  echo "ERROR: private GitHub source accepted without read-only key file" >&2
  exit 52
fi

(
  cd "$control_checkout"
  CI_COMMIT_REF_NAME=backup-control   FAE_SOURCE_URL="$SOURCE_URL"   FAE_TEST_MODE=1   FAE_DEST_URL_OVERRIDE="file://$target"   FAE_MANIFEST_OUT="$manifest"   bash control/run-mirror.sh
)

git --git-dir="$target" show-ref --verify --quiet refs/heads/backup-control

main_sha="$(git --git-dir="$target" rev-parse refs/heads/main)"
if [ "$main_sha" != "$EXPECTED_COMMIT" ]; then
  echo "ERROR: mirrored main mismatch: expected $EXPECTED_COMMIT got $main_sha" >&2
  exit 53
fi

if ! grep -Fq "head_sha=$EXPECTED_COMMIT" "$manifest"; then
  echo "ERROR: manifest does not bind expected source HEAD" >&2
  exit 54
fi

printf 'GITLAB_CONTROL_SELFTEST_GREEN\n'
printf 'expected_commit=%s\n' "$EXPECTED_COMMIT"
printf 'mirrored_main=%s\n' "$main_sha"
printf 'control_sha=%s\n' "$(git --git-dir="$target" rev-parse refs/heads/backup-control)"
