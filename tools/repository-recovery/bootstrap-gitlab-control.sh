#!/usr/bin/env bash
set -euo pipefail

: "${DEST_URL:?DEST_URL is required}"
: "${FAE_SOURCE_URL:?FAE_SOURCE_URL is required}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
package_root="$repo_root/tools/repository-recovery/gitlab-control"
control_branch="${FAE_CONTROL_BRANCH:-backup-control}"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

control_repo="$workdir/control"
mkdir -p "$control_repo/control"

cp "$package_root/gitlab-ci.yml" "$control_repo/.gitlab-ci.yml"
cp "$package_root/run-mirror.sh" "$control_repo/control/run-mirror.sh"
cp "$repo_root/tools/repository-recovery/sync-git-mirror.sh" "$control_repo/control/sync-git-mirror.sh"

cat > "$control_repo/RECOVERY-CONTROL.txt" <<EOF
FAE repository recovery control package
control_branch=$control_branch
source_url=$FAE_SOURCE_URL
package_revision=1
EOF

git init -q "$control_repo"
git -C "$control_repo" config user.name "FAE Repository Recovery"
git -C "$control_repo" config user.email "repository-recovery@invalid.local"
git -C "$control_repo" add .gitlab-ci.yml control RECOVERY-CONTROL.txt
git -C "$control_repo" commit -q -m "Install FAE repository recovery controller"
git -C "$control_repo" branch -M "$control_branch"
git -C "$control_repo" remote add backup "$DEST_URL"
git -C "$control_repo" push --force backup "$control_branch:$control_branch"

printf 'CONTROL_BOOTSTRAP_GREEN\n'
printf 'control_branch=%s\n' "$control_branch"
