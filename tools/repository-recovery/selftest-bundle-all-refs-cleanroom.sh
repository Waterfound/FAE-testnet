#!/usr/bin/env bash
set -euo pipefail
# Synthetic local exact-ref rehearsal, NOT real GitLab artifact / GitHub rebuild.
script="$(cd "$(dirname "$0")" && pwd)/verify-bundle-all-refs-cleanroom.sh"
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
mkdir "$root/source"
git -C "$root/source" init -q
git -C "$root/source" config user.name 'Isolated PBR Test'
git -C "$root/source" config user.email 'test@invalid.local'
printf 'a\n' > "$root/source/a.txt"
git -C "$root/source" add .
git -C "$root/source" commit -qm initial
git -C "$root/source" branch -M main
git -C "$root/source" checkout -qb feature/test
printf 'b\n' > "$root/source/b.txt"
git -C "$root/source" add .
git -C "$root/source" commit -qm feature
git -C "$root/source" checkout -q main
git -C "$root/source" tag -a v1 -m fixture-tag
git -C "$root/source" notes add -m 'fixture-note'
git clone --mirror -q "$root/source" "$root/mirror.git"
git --git-dir="$root/mirror.git" bundle create "$root/recovery.bundle" --all
sha256sum "$root/recovery.bundle" > "$root/recovery-bundle.sha256"
{
 printf 'head_ref=refs/heads/main\n'
 printf 'head_sha=%s\n' "$(git -C "$root/source" rev-parse main)"
 printf 'head_tree=%s\n' "$(git -C "$root/source" rev-parse 'main^{tree}')"
 printf '%s\n' '--- refs ---'
 git --git-dir="$root/mirror.git" for-each-ref --format='%(objectname) %(refname)' refs/heads refs/tags refs/notes | LC_ALL=C sort
} > "$root/recovery-manifest.txt"
run() {
 BUNDLE_PATH="$root/recovery.bundle" MANIFEST_PATH="$root/recovery-manifest.txt" CHECKSUM_PATH="$root/recovery-bundle.sha256" bash "$script"
}
run
cp "$root/recovery-manifest.txt" "$root/good-manifest"
printf '0000000000000000000000000000000000000000 refs/heads/extra\n' >> "$root/recovery-manifest.txt"
if run >/dev/null 2>&1; then echo 'ERROR: missing ref accepted' >&2; exit 61; fi
mv "$root/good-manifest" "$root/recovery-manifest.txt"
printf 'not the checksum\n' > "$root/recovery-bundle.sha256"
if run >/dev/null 2>&1; then echo 'ERROR: invalid checksum accepted' >&2; exit 62; fi
printf 'CLEANROOM_REF_RECONSTRUCTION_ADVERSARIAL_PASS\n'
