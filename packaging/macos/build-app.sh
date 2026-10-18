#!/bin/bash
# Reproducible candidate macOS arm64 app assembly. Run only on trusted macOS CI.
set -euo pipefail
umask 077
ROOT="$(git rev-parse --show-toplevel)"
PIN="f0c1ae0e5b1a421c9362c5a35fe0b6ca4cc8a282"
NODE_VERSION="22.16.0"
NODE_TAR="node-v$NODE_VERSION-darwin-arm64.tar.gz"
OUT="$ROOT/dist/FAE Node.app"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$ROOT"
# Never accidentally package mutable main or an unverified recovery implementation.
git fetch --no-tags --depth=1 origin "refs/pull/345/head:refs/remotes/origin/fae-node-packaging-source"
ACTUAL="$(git rev-parse refs/remotes/origin/fae-node-packaging-source)"
test "$ACTUAL" = "$PIN" || { echo "Node source drift: $ACTUAL" >&2; exit 31; }
mkdir -p "$TMP/tree" "$OUT/Contents/MacOS" "$OUT/Contents/Resources/node/bin"
git archive "$PIN" sovereign-forge/node | tar -xf - -C "$TMP/tree"
mv "$TMP/tree/sovereign-forge/node" "$OUT/Contents/Resources/fae-node"
# No npm, Homebrew or Xcode required on the user's Mac.
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "https://nodejs.org/dist/v$NODE_VERSION/$NODE_TAR" -o "$TMP/$NODE_TAR"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
grep -F "  $NODE_TAR" "$TMP/SHASUMS256.txt" > "$TMP/selected.sha"
(cd "$TMP" && shasum -a 256 -c selected.sha)
tar -xzf "$TMP/$NODE_TAR" -C "$TMP"
cp "$TMP/node-v$NODE_VERSION-darwin-arm64/bin/node" "$OUT/Contents/Resources/node/bin/node"
chmod 755 "$OUT/Contents/Resources/node/bin/node"
ARCH="$(/usr/bin/lipo -archs "$OUT/Contents/Resources/node/bin/node")"
case " $ARCH " in *" arm64 "*) ;; *) echo "Not an arm64 runtime: $ARCH" >&2; exit 32;; esac
cp "$ROOT/packaging/macos/FAE-Node-launcher.sh" "$OUT/Contents/MacOS/FAE-Node"
chmod 755 "$OUT/Contents/MacOS/FAE-Node"
/bin/bash -n "$OUT/Contents/MacOS/FAE-Node"
"$OUT/Contents/Resources/node/bin/node" --version >/dev/null 2>&1 || {
  # On an Intel builder an arm64 Node runtime cannot execute; lipo still proves architecture.
  echo "Node binary non-executable on this builder; architecture was verified"
}
cat > "$OUT/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>org.waterfound.fae-node</string>
<key>CFBundleName</key><string>FAE Node</string>
<key>CFBundleDisplayName</key><string>FAE Node</string>
<key>CFBundleExecutable</key><string>FAE-Node</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>12.0</string>
<key>LSUIElement</key><true/>
</dict></plist>
PLIST
/usr/bin/plutil -lint "$OUT/Contents/Info.plist"
printf 'FAE local testnet candidate; no production activation\nSource: %s\nNode: %s\n' "$PIN" "$NODE_VERSION" > "$OUT/Contents/Resources/BUILD-PROVENANCE.txt"
(cd "$OUT/Contents/Resources" && shasum -a 256 node/bin/node fae-node/fae-node-v6-candidate.mjs > BUILD-SHA256.txt)
# Ad-hoc signing validates assembly, NOT Apple Developer ID / notarization.
codesign --force --deep --sign - --timestamp=none "$OUT"
codesign --verify --deep --verbose=2 "$OUT"
mkdir -p "$ROOT/dist"
ditto -c -k --sequesterRsrc --keepParent "$OUT" "$ROOT/dist/FAE-Node-macOS-Apple-Silicon-candidate.zip"
shasum -a 256 "$ROOT/dist/FAE-Node-macOS-Apple-Silicon-candidate.zip" > "$ROOT/dist/FAE-Node-macOS-Apple-Silicon-candidate.zip.sha256"
echo "CANDIDATE_PACKAGED_NOT_NOTARIZED"
