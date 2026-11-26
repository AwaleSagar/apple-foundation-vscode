#!/bin/sh
set -eu
mkdir -p dist
sdk=$(xcrun --sdk macosx --show-sdk-version)
major=${sdk%%.*}
minor=${sdk#*.}
minor=${minor%%.*}
if [ "$major" -ge 27 ]; then
  set -- -D SDK_27
elif [ "$major" -eq 26 ] && [ "$minor" -ge 4 ]; then
  set --
else
  echo "Building the helper requires the macOS 26.4 SDK or later." >&2
  exit 1
fi
xcrun swiftc "$@" -parse-as-library -O -whole-module-optimization -target arm64-apple-macosx26.0 native/*.swift -o dist/apple-local-helper
if [ -n "${APPLE_DEVELOPER_ID:-}" ]; then
  codesign --force --options runtime --timestamp --sign "$APPLE_DEVELOPER_ID" dist/apple-local-helper
else
  codesign --force --sign - --timestamp=none dist/apple-local-helper
fi
