#!/bin/sh
# Builds the macOS container app (+ Safari web extension) with xcodebuild into ./build.
#   sh scripts/build-app.sh            ad-hoc signed Debug build — runs locally with
#                                      Safari > Develop > "Allow Unsigned Extensions"
#   SIGN=none sh scripts/build-app.sh  no code signing at all (CI compile check)
#   CONFIGURATION=Release sh scripts/build-app.sh
# Store builds are archived and signed from Xcode (Product > Archive), see README.md.
set -eu
HERE="$(cd "$(dirname "$0")/.." && pwd)"
CONFIGURATION="${CONFIGURATION:-Debug}"
if [ "${SIGN:-adhoc}" = "none" ]; then
  SIGNING="CODE_SIGNING_ALLOWED=NO"
else
  SIGNING="CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="
fi
# shellcheck disable=SC2086
xcodebuild \
  -project "$HERE/AwuCat Uzantı/AwuCat Uzantı.xcodeproj" \
  -scheme "AwuCat Uzantı" \
  -configuration "$CONFIGURATION" \
  -derivedDataPath "$HERE/build/DerivedData" \
  $SIGNING \
  build
echo "→ $HERE/build/DerivedData/Build/Products/$CONFIGURATION/AwuCat Uzantı.app"
