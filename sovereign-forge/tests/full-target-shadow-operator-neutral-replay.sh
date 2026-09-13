#!/usr/bin/env bash
set -euo pipefail

IMAGE="${FAE_SHADOW_LOCAL_CHAOS_IMAGE:-fae-shadow-validation:operator-neutral}"
EVIDENCE_DIR="${FAE_OPERATOR_NEUTRAL_EVIDENCE_DIR:-operator-neutral-evidence}"
REPLAYS="${FAE_OPERATOR_NEUTRAL_REPLAYS:-5}"
BASE_ATTEMPT="${GITHUB_RUN_ATTEMPT:-0}"

if ! [[ "$REPLAYS" =~ ^[1-9][0-9]*$ ]]; then
  echo "FAE_OPERATOR_NEUTRAL_REPLAYS must be a positive integer" >&2
  exit 2
fi

rm -rf "$EVIDENCE_DIR"
mkdir -p "$EVIDENCE_DIR"

BOOT_ID="$(cat /proc/sys/kernel/random/boot_id)"
GIT_COMMIT="$(git rev-parse HEAD)"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
HARNESS_SHA="$(sha256sum sovereign-forge/tests/full-target-shadow-one-machine-failure-domain.sh | awk '{print $1}')"
VERIFIER_SHA="$(sha256sum sovereign-forge/tests/full-target-shadow-operator-neutral-verifier.mjs | awk '{print $1}')"
WRAPPER_SHA="$(sha256sum sovereign-forge/tests/full-target-shadow-operator-neutral-replay.sh | awk '{print $1}')"
PEER_SHA="$(sha256sum sovereign-forge/node/lab/full-target-shadow-peer-node.mjs | awk '{print $1}')"
PROXY_SHA="$(sha256sum sovereign-forge/node/lab/full-target-shadow-fault-proxy.mjs | awk '{print $1}')"

CONTEXT_BOOT_ID="$BOOT_ID" \
CONTEXT_GIT_COMMIT="$GIT_COMMIT" \
CONTEXT_STARTED_AT="$STARTED_AT" \
CONTEXT_REPLAYS="$REPLAYS" \
CONTEXT_HARNESS_SHA="$HARNESS_SHA" \
CONTEXT_VERIFIER_SHA="$VERIFIER_SHA" \
CONTEXT_WRAPPER_SHA="$WRAPPER_SHA" \
CONTEXT_PEER_SHA="$PEER_SHA" \
CONTEXT_PROXY_SHA="$PROXY_SHA" \
node --input-type=module <<'NODE' > "$EVIDENCE_DIR/context.json"
const value = {
  format: 'FAE_OPERATOR_NEUTRAL_CONTEXT_V1',
  evidence_scope: 'one-man-one-machine-operator-neutrality-surrogate',
  started_at: process.env.CONTEXT_STARTED_AT,
  expected_replays: Number(process.env.CONTEXT_REPLAYS),
  git_commit: process.env.CONTEXT_GIT_COMMIT,
  boot_id: process.env.CONTEXT_BOOT_ID,
  code_hashes: {
    one_machine_harness_sha256: process.env.CONTEXT_HARNESS_SHA,
    operator_neutral_verifier_sha256: process.env.CONTEXT_VERIFIER_SHA,
    operator_neutral_wrapper_sha256: process.env.CONTEXT_WRAPPER_SHA,
    shadow_peer_sha256: process.env.CONTEXT_PEER_SHA,
    fault_proxy_sha256: process.env.CONTEXT_PROXY_SHA,
  },
};
process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
NODE

for replay in $(seq 1 "$REPLAYS"); do
  log="$EVIDENCE_DIR/run-${replay}.log"
  meta="$EVIDENCE_DIR/run-${replay}.meta.json"
  replay_started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  set +e
  GITHUB_RUN_ATTEMPT="${BASE_ATTEMPT}-neutral-${replay}" \
  FAE_SHADOW_LOCAL_CHAOS_IMAGE="$IMAGE" \
    bash sovereign-forge/tests/full-target-shadow-one-machine-failure-domain.sh >"$log" 2>&1
  exit_code=$?
  set -e

  replay_finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  cleanup_ok=true
  if docker ps -a --format '{{.Names}}' | grep -q '^fae-om-'; then cleanup_ok=false; fi
  if docker network ls --format '{{.Name}}' | grep -q '^fae-om-'; then cleanup_ok=false; fi
  if docker volume ls --format '{{.Name}}' | grep -q '^fae-om-'; then cleanup_ok=false; fi

  META_REPLAY="$replay" \
  META_EXIT_CODE="$exit_code" \
  META_CLEANUP_OK="$cleanup_ok" \
  META_STARTED_AT="$replay_started" \
  META_FINISHED_AT="$replay_finished" \
  node --input-type=module <<'NODE' > "$meta"
const value = {
  replay: Number(process.env.META_REPLAY),
  exit_code: Number(process.env.META_EXIT_CODE),
  cleanup_ok: process.env.META_CLEANUP_OK === 'true',
  started_at: process.env.META_STARTED_AT,
  finished_at: process.env.META_FINISHED_AT,
};
process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
NODE

  echo "--- operator-neutral replay ${replay}/${REPLAYS} exit=${exit_code} cleanup_ok=${cleanup_ok} ---"
  cat "$log"
done

# The verifier is a separate implementation path from the Bash harness. It
# requires every fixed replay to be present and PASS; there is no selective
# retry or majority-vote path inside this gate.
node sovereign-forge/tests/full-target-shadow-operator-neutral-verifier.mjs "$EVIDENCE_DIR" "$REPLAYS"
