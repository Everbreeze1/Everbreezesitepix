#!/usr/bin/env bash

# Metro port. Override when apps/web has taken 8081: METRO_PORT=8082 npm run mobile:doctor
METRO_PORT="${METRO_PORT:-8081}"
#
# Look at, and drive, the mobile app on a connected Android device.
#
# WHY THIS EXISTS
#
# The web app can be checked by driving a browser and looking at the result.
# The mobile app had no equivalent, so changes were shipped verified only by
# `tsc`, the hooks lint, the test suite and a Metro bundle. None of those can
# see a screen.
#
# That gap had already cost something by the time this script was written: the
# Gallery tab shipped with a PostgREST query that typechecked, linted, bundled
# and passed 1878 tests, then failed at runtime on every load with "Could not
# find a relationship between photos and projects in the schema cache". One
# screenshot found it.
#
# USAGE
#
#   scripts/mobile-screen.sh shot [name]     capture the screen to a PNG
#   scripts/mobile-screen.sh tap X Y         tap at a pixel coordinate
#   scripts/mobile-screen.sh text "hello"    type into the focused field
#   scripts/mobile-screen.sh swipe X1 Y1 X2 Y2 [ms]
#   scripts/mobile-screen.sh back            hardware back
#   scripts/mobile-screen.sh open PATH       deep link into a route
#   scripts/mobile-screen.sh doctor          check the whole chain
#
# Screens land in .mobile-shots/, which is gitignored. Coordinates are in
# device pixels; take a shot first and read them off it.

set -euo pipefail

SDK="${ANDROID_HOME:-$LOCALAPPDATA/Android/Sdk}"
ADB="$SDK/platform-tools/adb"
[ -x "$ADB" ] || ADB="adb"

APP_ID="com.everlumen.app"
SCHEME="everlumen"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHOTS="$ROOT/.mobile-shots"

cmd="${1:-shot}"
shift || true

case "$cmd" in
  shot)
    mkdir -p "$SHOTS"
    name="${1:-screen}"
    out="$SHOTS/$name.png"
    "$ADB" exec-out screencap -p > "$out"
    # A truncated capture is a valid file with an invalid header, and it fails
    # later in a confusing way, so check the PNG magic rather than the size.
    if [ "$(head -c 4 "$out" | od -An -c | tr -d ' \n')" != "211PNG" ]; then
      echo "capture failed: not a PNG. Is a device attached?" >&2
      exit 1
    fi
    echo "$out"
    ;;

  tap)    "$ADB" shell input tap "$1" "$2" ;;
  # `input text` does not accept spaces; %s is the documented substitute.
  text)   "$ADB" shell input text "${1// /%s}" ;;
  swipe)  "$ADB" shell input swipe "$1" "$2" "$3" "$4" "${5:-300}" ;;
  back)   "$ADB" shell input keyevent KEYCODE_BACK ;;
  menu)   "$ADB" shell input keyevent KEYCODE_MENU ;;

  open)
    # Deep link straight to a screen, so a check does not have to tap its way
    # through three levels of navigation to reach the thing being tested.
    "$ADB" shell am start -a android.intent.action.VIEW -d "$SCHEME://${1#/}" >/dev/null
    ;;

  restart)
    "$ADB" shell am force-stop "$APP_ID"
    "$ADB" shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
    ;;

  doctor)
    echo "device:"
    "$ADB" devices | sed -n '2p' || true

    echo "app installed:"
    "$ADB" shell pm list packages 2>/dev/null | grep -c "$APP_ID" || echo "0"

    echo "port bridge:"
    "$ADB" reverse --list || true

    echo "metro reachable from the device:"
    # Asked from inside the device, which is the only answer that matters: the
    # host being able to reach Metro says nothing about the tunnel.
    "$ADB" shell "wget -q -O - http://127.0.0.1:${METRO_PORT}/status 2>/dev/null" || echo "  NO"

    echo
    echo "note: apps/web runs Vite on 8081 too. If Metro says the port is in"
    echo "use, stop the web dev server first, or the phone will load the wrong"
    echo "thing or nothing at all."
    ;;

  *)
    sed -n '2,30p' "${BASH_SOURCE[0]}"
    exit 1
    ;;
esac
