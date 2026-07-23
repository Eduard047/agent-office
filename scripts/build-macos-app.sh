#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runtime_node="${AGENT_OFFICE_NODE:-/Users/eduard/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}"
output_root="$project_root/release"
zip_path="$output_root/Agent-Office-macOS-arm64.zip"
checksum_path="$zip_path.sha256"
build_tmp="$(mktemp -d /tmp/agent-office-macos.XXXXXX)"
app_path="$build_tmp/Agent Office.app"

cleanup_build_tmp() {
  rm -rf "$build_tmp"
}
trap cleanup_build_tmp EXIT

if [[ ! -x "$runtime_node" ]]; then
  runtime_node="$(command -v node || true)"
fi
if [[ -z "$runtime_node" || ! -x "$runtime_node" ]]; then
  echo "A runnable Node.js binary is required to build Agent Office." >&2
  exit 1
fi
if [[ "$(uname -m)" != "arm64" ]]; then
  echo "This build currently targets Apple Silicon Macs." >&2
  exit 1
fi

export PATH="$(dirname "$runtime_node"):$PATH"
cd "$project_root"
pnpm build

rm -rf "$output_root/Agent Office.app"
rm -f "$zip_path" "$checksum_path"
mkdir -p "$output_root"
mkdir -p \
  "$app_path/Contents/MacOS" \
  "$app_path/Contents/Resources/app/client" \
  "$app_path/Contents/Resources/app/server" \
  "$app_path/Contents/Resources/licenses"

cp "$project_root/native/macos/Info.plist" "$app_path/Contents/Info.plist"
xcrun swiftc \
  -O \
  -target arm64-apple-macos13.0 \
  -framework Cocoa \
  -framework WebKit \
  "$project_root/native/macos/AgentOfficeApp.swift" \
  -o "$app_path/Contents/MacOS/AgentOffice"

cp "$runtime_node" "$app_path/Contents/Resources/node"
chmod 755 "$app_path/Contents/Resources/node"
ditto "$project_root/dist/client" "$app_path/Contents/Resources/app/client"
cp "$project_root/server/local-app-server.mjs" "$app_path/Contents/Resources/app/server/"
cp "$project_root/server/codex-local.mjs" "$app_path/Contents/Resources/app/server/"
cp "$project_root/server/codex-output-schema.json" "$app_path/Contents/Resources/app/server/"

node_license="$(cd "$(dirname "$runtime_node")/.." && pwd)/LICENSE"
if [[ -f "$node_license" ]]; then
  cp "$node_license" "$app_path/Contents/Resources/licenses/Node-LICENSE.txt"
fi

iconset="$build_tmp/AppIcon.iconset"
mkdir -p "$iconset"
sips -z 16 16 "$project_root/native/macos/AppIcon.png" --out "$iconset/icon_16x16.png" >/dev/null
sips -z 32 32 "$project_root/native/macos/AppIcon.png" --out "$iconset/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$project_root/native/macos/AppIcon.png" --out "$iconset/icon_32x32.png" >/dev/null
sips -z 64 64 "$project_root/native/macos/AppIcon.png" --out "$iconset/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$project_root/native/macos/AppIcon.png" --out "$iconset/icon_128x128.png" >/dev/null
sips -z 256 256 "$project_root/native/macos/AppIcon.png" --out "$iconset/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$project_root/native/macos/AppIcon.png" --out "$iconset/icon_256x256.png" >/dev/null
sips -z 512 512 "$project_root/native/macos/AppIcon.png" --out "$iconset/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$project_root/native/macos/AppIcon.png" --out "$iconset/icon_512x512.png" >/dev/null
sips -z 1024 1024 "$project_root/native/macos/AppIcon.png" --out "$iconset/icon_512x512@2x.png" >/dev/null
iconutil -c icns "$iconset" -o "$app_path/Contents/Resources/AppIcon.icns"

xattr -cr "$app_path"
xattr -d 'com.apple.fileprovider.fpfs#P' "$app_path" 2>/dev/null || true
find "$app_path" -exec xattr -d com.apple.ResourceFork {} \; 2>/dev/null || true
find "$app_path" -exec xattr -d com.apple.FinderInfo {} \; 2>/dev/null || true
codesign --force --deep --sign - "$app_path"
codesign --verify --deep --strict --verbose=2 "$app_path"

ditto -c -k --sequesterRsrc --keepParent "$app_path" "$zip_path"
shasum -a 256 "$zip_path" > "$checksum_path"

echo "$zip_path"
echo "$checksum_path"
