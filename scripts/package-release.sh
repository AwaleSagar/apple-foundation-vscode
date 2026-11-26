#!/bin/sh
set -eu

: "${APPLE_DEVELOPER_ID:?Set the Developer ID Application signing identity}"
if [ "$#" -eq 0 ]; then
  echo "Pass notarytool credentials, e.g. --keychain-profile AC_NOTARY." >&2
  exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
package=$(node -p 'const p = require("./package.json"); p.name + "-darwin-arm64-" + p.version + ".vsix"')
pnpm run package --out "$work/$package"

# Notarize the executable taken from the final archive. vsce's prepublish hook
# has already finished building and signing at this point.
helper="$work/apple-local-helper"
unzip -p "$work/$package" extension/dist/apple-local-helper > "$helper"
cmp dist/apple-local-helper "$helper"
chmod +x "$helper"
codesign --verify --strict --verbose=2 --test-requirement \
  '=anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists' "$helper"
ditto -c -k --keepParent "$helper" "$work/helper.zip"
xcrun notarytool submit "$work/helper.zip" "$@" --wait --output-format json > "$work/result.json"
node -e '
  const { id, status } = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  console.log("Notarization", id, status);
  if (status !== "Accepted") process.exit(1);
' "$work/result.json"
mv "$work/$package" "$package"
