#!/usr/bin/env bash

# Metro port. Override when apps/web has taken 8081: METRO_PORT=8099 npm run mobile:doctor
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
# That gap has now cost two separate outages:
#
#   1. The Gallery tab shipped with a PostgREST query that typechecked, linted,
#      bundled and passed 1878 tests, then failed at runtime on every load with
#      "Could not find a relationship between photos and projects in the schema
#      cache". One screenshot found it.
#
#   2. `EXPO_PUBLIC_API_BASE_URL` was pointed at the web host rather than the
#      API host, so all 44 `/v1/rpc` operations hit a 404 and every
#      server-backed screen said "Request failed". 2305 tests were green. The
#      `env` check below exists so that one cannot recur silently.
#
# USAGE
#
#   scripts/mobile-screen.sh shot [name]     capture the screen to a PNG
#   scripts/mobile-screen.sh tap X Y         tap at a pixel coordinate
#   scripts/mobile-screen.sh text "hello"    type into the focused field
#   scripts/mobile-screen.sh swipe X1 Y1 X2 Y2 [ms]
#   scripts/mobile-screen.sh back            hardware back
#   scripts/mobile-screen.sh metro           kill any stale Metro, start a clean one
#   scripts/mobile-screen.sh reload          point the dev client at Metro and relaunch
#   scripts/mobile-screen.sh env             check the API and web hosts are not confused
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
MOBILE="$ROOT/apps/mobile"

# PIDs listening on the Metro port. Used instead of `pkill -f "expo start"`,
# which does not work here: Metro runs as a node child whose command line does
# not contain that string, so pkill reports success and kills nothing.
metro_pids() {
  netstat -ano 2>/dev/null \
    | grep -E ":${METRO_PORT}[[:space:]]" \
    | grep LISTENING \
    | awk '{print $NF}' | sort -u
}

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

  metro)
    # Start Metro, and REFUSE TO PRETEND when it did not start.
    #
    # `npx expo start` on a port already in use does not fail. It asks whether
    # to use the next port, finds itself non-interactive, prints "Skipping dev
    # server" and exits 0. The old process keeps serving, so the app silently
    # loads a bundle built before whatever you just changed. That cost an hour:
    # a correct fix looked broken because the device never received it.
    for pid in $(metro_pids); do
      echo "killing stale Metro on ${METRO_PORT} (pid $pid)"
      taskkill //PID "$pid" //F >/dev/null 2>&1 || kill -9 "$pid" 2>/dev/null || true
    done
    sleep 2

    log="${TMPDIR:-/tmp}/metro-${METRO_PORT}.log"
    ( cd "$MOBILE" && npx expo start --port "$METRO_PORT" --clear > "$log" 2>&1 & )

    for _ in $(seq 1 45); do
      sleep 2
      if [ -n "$(metro_pids)" ]; then break; fi
    done

    if grep -q "Skipping dev server" "$log" 2>/dev/null; then
      echo "Metro did NOT start: the port was still held. See $log" >&2
      exit 1
    fi
    if [ -z "$(metro_pids)" ]; then
      echo "Metro did not come up within 90s. See $log" >&2
      exit 1
    fi

    echo "metro up on ${METRO_PORT}"
    # Proves the env actually reached this Metro, which is what decides whether
    # the bundle the device gets has the right hosts inlined.
    grep -m1 "env: export" "$log" 2>/dev/null || echo "  (no env exported: check apps/mobile/.env)"
    ;;

  reload)
    # Point the dev client at Metro and restart the app. `adb reverse` first,
    # because the emulator's localhost is not the host's.
    "$ADB" reverse "tcp:${METRO_PORT}" "tcp:${METRO_PORT}" >/dev/null
    "$ADB" shell am force-stop "$APP_ID"
    "$ADB" shell am start -a android.intent.action.VIEW \
      -d "exp+${SCHEME}://expo-development-client/?url=http%3A%2F%2Flocalhost%3A${METRO_PORT}" >/dev/null
    echo "reloading from http://localhost:${METRO_PORT}"
    ;;

  restart)
    "$ADB" shell am force-stop "$APP_ID"
    "$ADB" shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
    ;;

  env)
    # The two hosts are different, and confusing them is a silent total outage.
    # See the note at the top of this file, and tests/mobile-api-host.test.ts.
    envfile="$MOBILE/.env"
    if [ ! -f "$envfile" ]; then
      echo "no apps/mobile/.env - copy .env.example and fill it in" >&2
      exit 1
    fi
    api=$(grep -m1 '^EXPO_PUBLIC_API_BASE_URL=' "$envfile" | cut -d= -f2- || true)
    web=$(grep -m1 '^EXPO_PUBLIC_WEB_BASE_URL=' "$envfile" | cut -d= -f2- || true)

    echo "api host: ${api:-(unset)}"
    echo "web host: ${web:-(unset)}"

    fail=0
    [ -n "$api" ] || { echo "  FAIL EXPO_PUBLIC_API_BASE_URL is unset"; fail=1; }
    [ -n "$web" ] || { echo "  FAIL EXPO_PUBLIC_WEB_BASE_URL is unset"; fail=1; }
    if [ -n "$api" ] && [ "$api" = "$web" ]; then
      echo "  FAIL both point at one host. /v1 is not served by the web app."
      fail=1
    fi
    if [ -n "$api" ]; then
      code=$(curl -s -o /dev/null -w "%{http_code}" "${api%/}/v1/health" || echo 000)
      echo "  ${api%/}/v1/health -> HTTP $code"
      [ "$code" = "200" ] || { echo "  FAIL the API host does not serve /v1"; fail=1; }
    fi
    [ "$fail" = "0" ] && echo "  ok"
    exit "$fail"
    ;;

  doctor)
    echo "device:"
    "$ADB" devices | sed -n '2p' || true

    echo "app installed:"
    "$ADB" shell pm list packages 2>/dev/null | grep -c "$APP_ID" || echo "0"

    echo "build kind:"
    # A development build loads from Metro; a preview/production build has the
    # JS baked in and ignores Metro entirely. Testing a standalone build while
    # expecting your latest change is a whole afternoon.
    if "$ADB" shell pm dump "$APP_ID" 2>/dev/null | grep -qi "expo.modules.devlauncher"; then
      echo "  development build (loads from Metro)"
    else
      echo "  standalone build (JS is baked in; Metro is ignored)"
    fi

    echo "metro process:"
    pids="$(metro_pids)"
    echo "  ${pids:-none listening on $METRO_PORT}"

    echo "port bridge:"
    "$ADB" reverse --list || true

    echo "metro reachable from the device:"
    # Asked from inside the device, which is the only answer that matters: the
    # host being able to reach Metro says nothing about the tunnel. The status
    # endpoint answers without a trailing newline, hence the echo.
    "$ADB" shell "wget -q -O - http://127.0.0.1:${METRO_PORT}/status 2>/dev/null" && echo || echo "  NO"

    echo "hosts:"
    "$0" env 2>&1 | sed 's/^/  /' || true

    echo
    # Single quotes: the backticks below are literal, and in double quotes the
    # shell would try to run them. It did, on the first version of this file.
    echo 'note: apps/web runs Vite on 8081 too. If Metro says the port is in'
    echo 'use, stop the web dev server first, or the phone loads the wrong'
    echo 'thing or nothing at all. `mobile-screen.sh metro` kills by PID and'
    echo 'fails loudly rather than silently serving a stale bundle.'
    ;;

  *)
    sed -n '2,42p' "${BASH_SOURCE[0]}"
    exit 1
    ;;
esac
