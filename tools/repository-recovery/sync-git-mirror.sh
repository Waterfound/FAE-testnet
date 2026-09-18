#!/usr/bin/env bash
set -euo pipefail

: "${SOURCE_URL:?SOURCE_URL is required}"
: "${DEST_URL:?DEST_URL is required}"

CONTROL_REF="${CONTROL_REF:-refs/heads/backup-control}"
MANIFEST_OUT="${MANIFEST_OUT:-}"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

source_repo="$workdir/source.git"
source_manifest="$workdir/source.refs"
dest_manifest="$workdir/dest.refs"
dest_filtered="$workdir/dest.filtered.refs"
source_names="$workdir/source.names"
dest_names="$workdir/dest.names"

git clone --mirror "$SOURCE_URL" "$source_repo"
git -C "$source_repo" fsck --full --strict

git -C "$source_repo" for-each-ref \
  --format='%(objectname) %(refname)' \
  refs/heads refs/tags refs/notes \
  | LC_ALL=C sort > "$source_manifest"

if grep -Fq " $CONTROL_REF" "$source_manifest"; then
  echo "ERROR: source repository owns reserved control ref: $CONTROL_REF" >&2
  exit 21
fi

git -C "$source_repo" remote add backup "$DEST_URL"

while IFS=' ' read -r object ref; do
  [ -n "$ref" ] || continue
  git -C "$source_repo" push --force backup "$ref:$ref"
done < "$source_manifest"

git ls-remote "$DEST_URL" 'refs/heads/*' 'refs/tags/*' 'refs/notes/*' \
  | awk '$2 !~ /\^\{\}$/ { print $1 " " $2 }' \
  | LC_ALL=C sort > "$dest_manifest"

awk '{print $2}' "$source_manifest" | LC_ALL=C sort > "$source_names"
awk -v control="$CONTROL_REF" '$2 != control {print $2}' "$dest_manifest" | LC_ALL=C sort > "$dest_names"

comm -13 "$source_names" "$dest_names" | while IFS= read -r stale_ref; do
  [ -n "$stale_ref" ] || continue
  git -C "$source_repo" push backup ":$stale_ref"
done

git ls-remote "$DEST_URL" 'refs/heads/*' 'refs/tags/*' 'refs/notes/*' \
  | awk '$2 !~ /\^\{\}$/ { print $1 " " $2 }' \
  | awk -v control="$CONTROL_REF" '$2 != control' \
  | LC_ALL=C sort > "$dest_filtered"

if ! diff -u "$source_manifest" "$dest_filtered"; then
  echo "ERROR: destination refs do not exactly match source refs" >&2
  exit 22
fi

head_ref="$(git -C "$source_repo" symbolic-ref HEAD 2>/dev/null || true)"
head_sha="$(git -C "$source_repo" rev-parse HEAD)"
head_tree="$(git -C "$source_repo" rev-parse 'HEAD^{tree}')"

if [ -n "$MANIFEST_OUT" ]; then
  {
    printf 'source_url=%s\n' "$SOURCE_URL"
    printf 'control_ref=%s\n' "$CONTROL_REF"
    printf 'head_ref=%s\n' "$head_ref"
    printf 'head_sha=%s\n' "$head_sha"
    printf 'head_tree=%s\n' "$head_tree"
    printf '%s\n' '--- refs ---'
    cat "$source_manifest"
  } > "$MANIFEST_OUT"
fi

printf 'MIRROR_SYNC_GREEN\n'
printf 'head_ref=%s\n' "$head_ref"
printf 'head_sha=%s\n' "$head_sha"
printf 'head_tree=%s\n' "$head_tree"
