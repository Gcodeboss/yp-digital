#!/usr/bin/env bash
# Scheduled capture. Run daily; it is a no-op on a day with nothing new.
#
#   ./capture.sh                 scan -> archive -> back-fill anything at risk
#   ./capture.sh --install       print how to install the LaunchAgent
#
# The scan no longer needs a browser. `kick_api.py` gets past Kick's 403 with a
# browser User-Agent on plain stdlib, falls back to curl_cffi's TLS
# impersonation, and only then to the local browser bridge -- so this runs
# headless, from launchd, with nobody logged into anything.
#
# A failed scan is not a failed run: back-filling from the last scan is a smaller
# failure than no capture at all. But a scan that has not succeeded in days is
# reported loudly rather than silently, because a stale scan reporting "nothing
# at risk" is how three streams came within a fortnight of deletion unnoticed.
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$PWD/.venv/bin/python"
LOG="$PWD/work/capture.log"
PLIST="$HOME/Library/LaunchAgents/com.yanchan.capture.plist"
mkdir -p "$(dirname "$LOG")"

if [[ "${1:-}" == "--install" ]]; then
  echo "The installer offers to do this for you. By hand:"
  echo
  echo "  cp assets/com.yanchan.capture.plist \"$PLIST\""
  echo "  sed -i '' \"s|__REPO__|$(cd ../.. && pwd)|g\" \"$PLIST\""
  echo "  launchctl bootstrap gui/\$(id -u) \"$PLIST\""
  echo
  echo "It runs at 04:00, and on wake if the machine was asleep then."
  echo "To stop it:  launchctl bootout gui/\$(id -u)/com.yanchan.capture"
  exit 0
fi

say() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# launchd gives a job no GUI session of its own, so a notification has to be
# addressed to the logged-in user's Aqua session explicitly. Failing to notify
# must never fail the capture.
notify() {
  local title="$1" msg="$2"
  /usr/bin/osascript -e "display notification \"${msg//\"/}\" with title \"${title//\"/}\"" \
    >/dev/null 2>&1 || true
}

say "capture run starting"

# --- 1. scan ---------------------------------------------------------------
if $VENV scan_kick.py; then
  say "scan succeeded"
  $VENV ingest.py --import-scan kick_scan.json 2>&1 | grep -v objc
else
  say "WARNING: every scan method failed — backfilling from the last scan"
fi

# --- 2. back-fill ----------------------------------------------------------
# `status=$?` used to be read after a pipe, so it captured the exit of `grep -v
# objc` -- which succeeds whenever it prints a line and fails when it prints
# none. The script's exit code was therefore about grep's output, not about
# whether anything was captured, and launchd would have logged success for every
# failed run. PIPESTATUS[0] is the one that means anything here.
$VENV ingest.py --backfill 2>&1 | grep -v objc
status=${PIPESTATUS[0]}

# --- 3. say where we stand -------------------------------------------------
$VENV ingest.py --status 2>&1 | grep -v objc | head -20

STATE_JSON="$($VENV scan_kick.py --state 2>/dev/null)"
STATE="$(printf '%s' "$STATE_JSON" | $VENV -c 'import json,sys; print(json.load(sys.stdin)["state"])' 2>/dev/null || echo unknown)"
MESSAGE="$(printf '%s' "$STATE_JSON" | $VENV -c 'import json,sys; print(json.load(sys.stdin)["message"])' 2>/dev/null || echo "capture state unknown")"
say "$MESSAGE"

case "$STATE" in
  stale)   notify "YP capture — scan is stale" "$MESSAGE" ;;
  at_risk) notify "YP capture — streams at risk" "$MESSAGE" ;;
esac
if [ "$status" -ne 0 ]; then
  notify "YP capture failed" "Back-fill exited $status. See work/capture.log."
fi

say "capture run finished (exit $status)"
exit $status
