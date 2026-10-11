#!/usr/bin/env bash
# PBR-001 candidate. Inspect recovery bundle in temporary local bare repos.
# No remote writes, API tokens, provider credentials or GitHub activation.
set -euo pipefail
: "${BUNDLE_PATH:?bundle path required}"
: "${MANIFEST_PATH:?off-host recovery manifest required}"
: "${CHECKSUM_PATH:?bundle sha256 manifest required}"
test -f "$BUNDLE_PATH" && test -f "$MANIFEST_PATH" && test -f "$CHECKSUM_PATH" || { echo 'ERROR: RECOVERY_INPUT_MISSING' >&2; exit 11; }
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

manifest_field() {
  local key="$1"
  awk -v key="$key" 'index($0,key"=")==1 {print substr($0,length(key)+2)}' "$MANIFEST_PATH"
}
head_ref="$(manifest_field head_ref)"
head_sha="$(manifest_field head_sha)"
head_tree="$(manifest_field head_tree)"
checksum="$(awk 'NR==1 {print $1}' "$CHECKSUM_PATH")"
if [[ ! "$head_ref" =~ ^refs/heads/[a-zA-Z0-9._/-]+$ ]] || ! git check-ref-format "$head_ref"; then
  echo 'ERROR: INVALID_HEAD_REF' >&2; exit 12
fi
[[ "$head_sha" =~ ^[0-9a-f]{40}$ && "$head_tree" =~ ^[0-9a-f]{40}$ && "$checksum" =~ ^[0-9a-f]{64}$ ]] || {
  echo 'ERROR: INVALID_DIGEST' >&2; exit 13;
}
calculated="$(sha256sum "$BUNDLE_PATH" | awk '{print $1}')"
[[ "$calculated" == "$checksum" ]] || { echo 'ERROR: BUNDLE_CHECKSUM_MISMATCH' >&2; exit 14; }

awk 'BEGIN{inside=0} /^--- refs ---$/{inside=1;next} inside&&NF {print}' "$MANIFEST_PATH" | LC_ALL=C sort > "$workdir/expected"
[[ -s "$workdir/expected" ]] || { echo 'ERROR: EMPTY_REFS' >&2; exit 15; }
while IFS=' ' read -r oid ref extra; do
  [[ -z "${extra:-}" && "$oid" =~ ^[0-9a-f]{40}$ ]] || { echo 'ERROR: MALFORMED_REFS' >&2; exit 16; }
  [[ "$ref" == refs/heads/* || "$ref" == refs/tags/* || "$ref" == refs/notes/* ]] || { echo 'ERROR: UNEXPECTED_REF_NAMESPACE' >&2; exit 17; }
  git check-ref-format "$ref" || { echo 'ERROR: INVALID_REF_NAME' >&2; exit 18; }
done < "$workdir/expected"
test "$(awk '{print $2}' "$workdir/expected" | LC_ALL=C sort | uniq | wc -l)" -eq "$(wc -l < "$workdir/expected")" || {
  echo 'ERROR: DUPLICATE_REFS' >&2; exit 19;
}
git init --bare -q "$workdir/check.git"
git --git-dir="$workdir/check.git" bundle verify "$BUNDLE_PATH" >/dev/null 2>&1 || { echo 'ERROR: BUNDLE_VERIFICATION_FAILED' >&2; exit 20; }
git clone --mirror -q "$BUNDLE_PATH" "$workdir/reconstruction.git" || { echo 'ERROR: LOCAL_RECONSTRUCTION_FAILED' >&2; exit 21; }
git --git-dir="$workdir/reconstruction.git" fsck --full --strict >/dev/null 2>&1 || { echo 'ERROR: GIT_OBJECT_INTEGRITY_FAILED' >&2; exit 22; }
list_refs() { git --git-dir="$1" for-each-ref --format='%(objectname) %(refname)' refs/heads refs/tags refs/notes | LC_ALL=C sort; }
list_refs "$workdir/reconstruction.git" > "$workdir/rebuilt"
cmp -s "$workdir/expected" "$workdir/rebuilt" || { echo 'ERROR: INCOMPLETE_REF_RESTORATION' >&2; exit 23; }
observed_head="$(git --git-dir="$workdir/reconstruction.git" rev-parse "$head_ref")"
observed_tree="$(git --git-dir="$workdir/reconstruction.git" rev-parse "$head_ref^{tree}")"
[[ "$observed_head" == "$head_sha" && "$observed_tree" == "$head_tree" ]] || { echo 'ERROR: MAIN_HEAD_OR_TREE_MISMATCH' >&2; exit 24; }
git clone --mirror -q "$workdir/reconstruction.git" "$workdir/isolated-github-like.git" || { echo 'ERROR: SECOND_HOP_FAILED' >&2; exit 25; }
git --git-dir="$workdir/isolated-github-like.git" fsck --full --strict >/dev/null 2>&1 || { echo 'ERROR: SECOND_HOP_OBJECT_INTEGRITY_FAILED' >&2; exit 26; }
list_refs "$workdir/isolated-github-like.git" > "$workdir/second-hop"
cmp -s "$workdir/expected" "$workdir/second-hop" || { echo 'ERROR: SECOND_HOP_REF_MISMATCH' >&2; exit 27; }
ref_count="$(wc -l < "$workdir/expected" | tr -d ' ')"
printf 'LOCAL_FULL_GIT_REF_RESTORATION_PASS\n'
printf 'refs=%s\n' "$ref_count"
printf 'main_sha=%s\n' "$head_sha"
printf 'main_tree=%s\n' "$head_tree"
printf 'bundle_sha256=%s\n' "$checksum"
printf 'github_host_configuration_and_secrets_restored=false\n'
