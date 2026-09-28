#!/usr/bin/env bash
#
# Yanchan clip dashboard — start it and open it.
#
#   ./start.sh              start on http://localhost:3000
#   PORT=4000 ./start.sh    start on a different port
#   YP_DEV=1 ./start.sh     development mode (slower pages, live code reload)
#
# Leave this Terminal window open while you work. Press Ctrl-C to stop.
#
# ---------------------------------------------------------------------------
# WHY THIS BUILDS FOR PRODUCTION RATHER THAN RUNNING `npm run dev`
#
# `next dev` compiles each route the first time you visit it. On this dashboard
# that means several seconds of blank screen per page, every single session —
# the timeline page alone reads clips/library.json, a waveform and a per-second
# music map. For someone who is here to cut clips, not to write code, that reads
# as "the app is broken".
#
# The usual objection to `next start` is staleness: a production build can bake
# page HTML at build time, so a freshly prepared stream would not show up. That
# does not apply here — every page under site/src/app/dashboard/ declares
# `export const dynamic = "force-dynamic"`, so each one is rendered per request
# and reads the pipeline's files live. Checked, not assumed.
#
# So: build once (a minute or two), then start. Subsequent runs skip the build
# entirely unless the app's source changed. `YP_DEV=1` is the escape hatch for
# anyone actually editing the app.
#
# ---------------------------------------------------------------------------
# WHY OPS_DASHBOARD=1 IS EXPORTED FOR BOTH THE BUILD AND THE RUN
#
# site/src/lib/internal-only.ts gates the whole dashboard:
#
#     INTERNAL_TOOLS_ENABLED = process.env.OPS_DASHBOARD === "1"
#                              || process.env.NODE_ENV === "development"
#
# Every page under /dashboard and every /api/yp route calls notFound() when that
# is false, and site/src/proxy.ts 404s /dashboard at the edge as well. A
# production build sets NODE_ENV=production, so without OPS_DASHBOARD=1 a fresh
# install would open to a 404 — which looks exactly like a broken install.
#
# It is set before `next build` too, not just before `next start`, because
# proxy.ts runs as Next middleware and middleware has its environment inlined at
# build time. Setting it only at run time would leave a 404 baked into the
# middleware bundle.
# ---------------------------------------------------------------------------

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE="$REPO/site"
VENV="$REPO/tools/clip-pipeline/.venv"

PORT="${PORT:-3000}"
PORT_SCAN_LIMIT=10          # how many ports past PORT to try before giving up
PATH_TO_OPEN="/dashboard"

export OPS_DASHBOARD=1      # see the long note above — required, both phases

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; OFF=$'\033[0m'
else
  BOLD=""; DIM=""; GREEN=""; RED=""; YELLOW=""; OFF=""
fi

say()  { printf '  %s\n' "$1"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$OFF" "$1"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$OFF" "$1"; }

fail() {
  printf '\n%s%s  Cannot start.%s\n\n' "$RED" "$BOLD" "$OFF"
  printf '  %s\n\n' "$1"
  shift
  if [ "$#" -gt 0 ]; then
    printf '  %sHow to fix it:%s\n' "$BOLD" "$OFF"
    for line in "$@"; do printf '      %s\n' "$line"; done
    printf '\n'
  fi
  exit 1
}

printf '\n%s%sYanchan clip dashboard%s\n\n' "$BOLD" "$GREEN" "$OFF"

# ---------------------------------------------------------------------------
# 1. Has the installer been run?
# ---------------------------------------------------------------------------
[ -x "$VENV/bin/python" ] || fail \
  "The clip pipeline is not installed yet." \
  "Run the installer first — it only takes one command:" \
  "  ./install.sh"

[ -d "$SITE/node_modules" ] || fail \
  "The dashboard's packages are not installed yet." \
  "Run the installer first — it only takes one command:" \
  "  ./install.sh"

[ -f "$SITE/package.json" ] || fail \
  "site/package.json is missing, so there is no dashboard to start." \
  "This copy of the project is incomplete. Get a full copy of the repository."

command -v node >/dev/null 2>&1 || fail \
  "Node.js is not on this Mac any more, so the dashboard cannot run." \
  "Reinstall it from https://nodejs.org, then run:" \
  "  ./install.sh"

# ---------------------------------------------------------------------------
# 2. Pick a port. If ours is already up, just open it instead of failing.
# ---------------------------------------------------------------------------
port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1; }

responds_as_dashboard() {
  local code
  code="$(curl -s -o /dev/null -m 3 -w '%{http_code}' "http://127.0.0.1:$1$PATH_TO_OPEN" 2>/dev/null || echo 000)"
  [ "$code" = "200" ]
}

if port_busy "$PORT"; then
  if responds_as_dashboard "$PORT"; then
    URL="http://localhost:$PORT$PATH_TO_OPEN"
    ok "The dashboard is already running on port $PORT — opening it."
    printf '\n      %s%s%s\n\n' "$BOLD" "$URL" "$OFF"
    open "$URL" >/dev/null 2>&1 || say "Open that address in your browser."
    say "${DIM}It is running in another Terminal window. Stop it there with Ctrl-C.${OFF}"
    printf '\n'
    exit 0
  fi

  holder="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -F c 2>/dev/null | sed -n 's/^c//p' | head -1 || true)"
  warn "Port $PORT is taken${holder:+ by \"$holder\"} — looking for a free one."

  ORIGINAL_PORT="$PORT"
  FOUND=""
  for offset in $(seq 1 "$PORT_SCAN_LIMIT"); do
    candidate=$((ORIGINAL_PORT + offset))
    if ! port_busy "$candidate"; then FOUND="$candidate"; break; fi
  done
  [ -n "$FOUND" ] || fail \
    "Ports $ORIGINAL_PORT to $((ORIGINAL_PORT + PORT_SCAN_LIMIT)) are all in use, so there is nowhere to start." \
    "Something else on this Mac is using them. To see what:" \
    "  lsof -nP -iTCP:$ORIGINAL_PORT -sTCP:LISTEN" \
    "" \
    "Restarting the Mac clears stuck ones. Or pick your own port:" \
    "  PORT=8080 ./start.sh"
  PORT="$FOUND"
  ok "Using port $PORT instead."
fi

URL="http://localhost:$PORT$PATH_TO_OPEN"

# ---------------------------------------------------------------------------
# 3. Build, unless a current build is already sitting there.
# ---------------------------------------------------------------------------
DEV_MODE="${YP_DEV:-0}"

needs_build() {
  [ -f "$SITE/.next/BUILD_ID" ] || return 0
  # Any app source newer than the build means the build is stale.
  local newer
  newer="$(find "$SITE/src" "$SITE/package.json" "$SITE/next.config.ts" \
             -newer "$SITE/.next/BUILD_ID" -print -quit 2>/dev/null || true)"
  [ -n "$newer" ]
}

if [ "$DEV_MODE" = "1" ]; then
  warn "Development mode — pages compile as you open them, so the first view of each is slow."
elif needs_build; then
  say "Preparing the dashboard (one or two minutes — only happens after a change)…"
  if ! (cd "$SITE" && npm run build); then
    fail "The dashboard failed to build. The messages above say which file is unhappy." \
         "If you have not edited anything, reinstall and try again:" \
         "  rm -rf site/.next && ./install.sh && ./start.sh" \
         "" \
         "To get working right now regardless, start in development mode:" \
         "  YP_DEV=1 ./start.sh"
  fi
  ok "Dashboard prepared."
else
  ok "Dashboard already prepared — starting straight away."
fi

# ---------------------------------------------------------------------------
# 4. Start it, wait for it to answer, then open the browser.
# ---------------------------------------------------------------------------
printf '\n  Starting on %s%s%s\n\n' "$BOLD" "$URL" "$OFF"

if [ "$DEV_MODE" = "1" ]; then
  (cd "$SITE" && exec npm run dev -- --port "$PORT") &
else
  (cd "$SITE" && exec npm run start -- --port "$PORT") &
fi
SERVER_PID=$!

# Open the browser as soon as the server actually answers. Doing it any earlier
# gives a "can't connect" page, which reads as a broken install.
(
  for _ in $(seq 1 90); do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then exit 0; fi
    if responds_as_dashboard "$PORT"; then
      open "$URL" >/dev/null 2>&1 || true
      exit 0
    fi
    sleep 1
  done
) &
OPENER_PID=$!

# Ctrl-C should stop the server and the browser-opener, not orphan either.
cleanup() {
  trap - INT TERM EXIT
  printf '\n  Stopping the dashboard…\n'
  kill "$OPENER_PID" 2>/dev/null || true
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  printf '  Stopped.\n\n'
}
trap cleanup INT TERM EXIT

printf '  %sLeave this window open while you work. Press Ctrl-C here to stop.%s\n\n' "$DIM" "$OFF"

wait "$SERVER_PID"
