#!/usr/bin/env bash
set -euo pipefail

: "${FAE_SOURCE_URL:?FAE_SOURCE_URL is required}"

CONTROL_BRANCH="${FAE_CONTROL_BRANCH:-backup-control}"
CONTROL_REF="refs/heads/$CONTROL_BRANCH"
MANIFEST_OUT="${FAE_MANIFEST_OUT:-mirror-manifest.txt}"

if [ "${CI_COMMIT_REF_NAME:-}" != "$CONTROL_BRANCH" ]; then
  echo "ERROR: mirror controller must run from $CONTROL_BRANCH" >&2
  exit 41
fi

if [ -n "${FAE_DEST_URL_OVERRIDE:-}" ]; then
  if [ "${FAE_TEST_MODE:-}" != "1" ]; then
    echo "ERROR: destination override is permitted only in FAE_TEST_MODE=1" >&2
    exit 42
  fi
  DEST_URL="$FAE_DEST_URL_OVERRIDE"
else
  : "${CI_JOB_TOKEN:?CI_JOB_TOKEN is required}"
  : "${CI_SERVER_HOST:?CI_SERVER_HOST is required}"
  : "${CI_PROJECT_PATH:?CI_PROJECT_PATH is required}"
  DEST_URL="https://gitlab-ci-token:${CI_JOB_TOKEN}@${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git"
fi

cleanup_ssh=0
if [[ "$FAE_SOURCE_URL" == git@github.com:* || "$FAE_SOURCE_URL" == ssh://git@github.com/* ]]; then
  : "${GITHUB_READ_SSH_KEY_FILE:?GITHUB_READ_SSH_KEY_FILE is required for a private GitHub source}"

  mkdir -p "$HOME/.ssh"
  chmod 700 "$HOME/.ssh"
  cp "$GITHUB_READ_SSH_KEY_FILE" "$HOME/.ssh/fae-github-read"
  chmod 600 "$HOME/.ssh/fae-github-read"

  cat > "$HOME/.ssh/known_hosts" <<'EOF'
github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl
EOF
  chmod 600 "$HOME/.ssh/known_hosts"

  export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/fae-github-read -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$HOME/.ssh/known_hosts"
  cleanup_ssh=1
fi

finish() {
  if [ "$cleanup_ssh" = "1" ]; then
    rm -f "$HOME/.ssh/fae-github-read"
  fi
}
trap finish EXIT

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SOURCE_URL="$FAE_SOURCE_URL" DEST_URL="$DEST_URL" CONTROL_REF="$CONTROL_REF" MANIFEST_OUT="$MANIFEST_OUT" bash "$script_dir/sync-git-mirror.sh"

printf 'GITLAB_CONTROL_GREEN\n'
