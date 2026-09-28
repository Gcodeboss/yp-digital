#!/usr/bin/env bash
#
# Yanchan clip pipeline + dashboard — one-command install for a fresh Mac.
#
#   ./install.sh
#
# What it does, in order:
#   1. checks you have the tools it needs, and tells you plainly how to get any
#      that are missing
#   2. builds tools/clip-pipeline/.venv and installs requirements.txt into it
#   3. installs the dashboard's packages in site/
#   4. creates the folders the pipeline and dashboard read and write
#   5. runs the preflight check and tells you what to do next
#
# It is safe to run twice. Nothing here deletes work, overwrites a clip, or
# touches clips/library.json — that file is the store of record and it is left
# strictly alone.
#
# It does NOT need Homebrew, and it does NOT need a system ffmpeg. ffmpeg comes
# bundled inside the imageio-ffmpeg Python package (see requirements.txt).

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIPELINE="$REPO/tools/clip-pipeline"
SITE="$REPO/site"
VENV="$PIPELINE/.venv"

# Lowest and highest Python the pinned requirements have wheels for.
PY_MIN_MINOR=9
PY_MAX_MINOR=12

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; OFF=$'\033[0m'
else
  BOLD=""; DIM=""; GREEN=""; RED=""; YELLOW=""; OFF=""
fi

STEP=0
step()  { STEP=$((STEP + 1)); printf '\n%s[%d/7] %s%s\n' "$BOLD" "$STEP" "$1" "$OFF"; }
info()  { printf '      %s\n' "$1"; }
ok()    { printf '      %s✓%s %s\n' "$GREEN" "$OFF" "$1"; }
warn()  { printf '      %s!%s %s\n' "$YELLOW" "$OFF" "$1"; }

# Every failure exits here, with a sentence a person can act on and no traceback.
fail() {
  printf '\n%s%s  Install stopped.%s\n\n' "$RED" "$BOLD" "$OFF"
  printf '  %s\n\n' "$1"
  shift
  if [ "$#" -gt 0 ]; then
    printf '  %sHow to fix it:%s\n' "$BOLD" "$OFF"
    for line in "$@"; do printf '      %s\n' "$line"; done
    printf '\n  Then run %s./install.sh%s again.\n\n' "$BOLD" "$OFF"
  fi
  exit 1
}

# How to tell someone to install Node.
#
# Homebrew is not required by this project. If they already have it, `brew
# install node` is one line and obviously the answer. If they do NOT have it,
# telling a music producer to install a package manager first is the wrong lead —
# the installer from nodejs.org is a double-click, needs no Terminal, and puts
# node somewhere always on PATH. So the order flips depending on what is there.
#
# Fills a global array rather than echoing, because these lines contain spaces
# and a command substitution; captured with $(...) they would be split into one
# word per space and printed as gibberish.
NODE_FIX=()
node_fix() {
  if command -v brew >/dev/null 2>&1; then
    NODE_FIX=(
      "You have Homebrew, so this is one line:"
      "  brew install node"
      ""
      "Or download the LTS installer from https://nodejs.org and double-click it."
    )
  else
    # The Homebrew one-liner is single-quoted on purpose: it is text for a person
    # to copy into their own Terminal, so the $(curl ...) inside it must survive
    # verbatim rather than being run by this script.
    # shellcheck disable=SC2016
    NODE_FIX=(
      "Easiest way: go to https://nodejs.org, download the LTS installer,"
      "and double-click it. Then come back here."
      ""
      "If you would rather use the Terminal, install Homebrew first by pasting"
      "this whole line, then run 'brew install node':"
      '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
    )
  fi
}

printf '\n%s%sYanchan clip pipeline — installer%s\n' "$BOLD" "$GREEN" "$OFF"
printf '%s%s%s\n' "$DIM" "$REPO" "$OFF"

# ---------------------------------------------------------------------------
step "Checking what you already have"
# ---------------------------------------------------------------------------

case "$(uname -s)" in
  Darwin) ok "macOS $(sw_vers -productVersion 2>/dev/null || echo '') on $(uname -m)" ;;
  *) fail "This installer is for macOS. It is running on $(uname -s)." \
          "Run it on the Mac the pipeline is meant to live on." ;;
esac

# --- Python. Prefer whatever the caller pins, then the macOS built-in (which is
# --- 3.9 and is exactly what the requirements were resolved against), then a
# --- Homebrew one. Anything 3.13+ is rejected: the pinned scientific packages
# --- publish no wheels for it and would try to compile from source.
python_ok() {
  local candidate="$1" minor
  [ -x "$candidate" ] || command -v "$candidate" >/dev/null 2>&1 || return 1
  minor="$("$candidate" -c 'import sys; print(sys.version_info[1] if sys.version_info[0]==3 else -1)' 2>/dev/null)" || return 1
  [ -n "$minor" ] || return 1
  [ "$minor" -ge "$PY_MIN_MINOR" ] && [ "$minor" -le "$PY_MAX_MINOR" ]
}

PY=""
for candidate in ${PYTHON:-} /usr/bin/python3 python3.12 python3.11 python3.10 python3.9 python3; do
  [ -n "$candidate" ] || continue
  if python_ok "$candidate"; then PY="$candidate"; break; fi
done

if [ -z "$PY" ]; then
  found="$(python3 --version 2>&1 || echo 'none found')"
  # Braces are load-bearing: "$PY_MIN_MINOR" followed directly by an en dash makes
  # bash 3.2 read the dash's bytes as part of the variable name, which under
  # `set -u` aborts with "unbound variable" instead of printing this message.
  fail "No usable Python 3 was found. The pipeline needs Python 3.${PY_MIN_MINOR}-3.${PY_MAX_MINOR}, and what is on this Mac is: $found" \
       "macOS includes a suitable Python once Apple's command line tools are installed." \
       "Run this and accept the prompt (it takes a few minutes):" \
       "  xcode-select --install" \
       "" \
       "If you already have a newer Python (3.13 or later), that is the problem —" \
       "the video and audio libraries have no build for it yet. Point the installer" \
       "at the built-in one instead:" \
       "  PYTHON=/usr/bin/python3 ./install.sh"
fi
ok "Python $("$PY" -c 'import sys;print(".".join(map(str,sys.version_info[:3])))')  ($(command -v "$PY"))"

# venv is a Python module, but Debian-style splits and broken installs do lose it.
"$PY" -c 'import venv, ensurepip' >/dev/null 2>&1 || fail \
  "This Python cannot create virtual environments (the 'venv' module is missing)." \
  "Install Apple's command line tools, which include a complete Python:" \
  "  xcode-select --install"

# --- Node. The dashboard is a Next.js 16 app; its own package.json requires 20.9+.
if ! command -v node >/dev/null 2>&1; then
  node_fix
  fail "Node.js is not installed. The clip dashboard is a web app and needs it." \
       "${NODE_FIX[@]}"
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 20 ]; then
  node_fix
  fail "Node.js $(node --version) is too old — the dashboard needs version 20 or newer." \
       "${NODE_FIX[@]}"
fi
ok "Node.js $(node --version)"

command -v npm >/dev/null 2>&1 || fail \
  "npm is missing. It normally arrives with Node.js, so the Node install is incomplete." \
  "Reinstall Node.js from https://nodejs.org (the LTS installer includes npm)."
ok "npm $(npm --version)"

# --- ffmpeg. Deliberately NOT required. compose.py, extract_audio.py, ingest.py,
# --- preview.py, make_proxy.py, posters.py and qa_report.py all call
# --- imageio_ffmpeg.get_ffmpeg_exe(), which returns a binary shipped inside the
# --- pip package. Verified on the build machine, which has no system ffmpeg and
# --- renders clips fine. This is informational only.
if command -v ffmpeg >/dev/null 2>&1; then
  ok "ffmpeg found on your system — harmless, but the pipeline uses its own bundled copy"
else
  info "${DIM}ffmpeg not installed system-wide — that is expected; a copy is bundled with the Python packages${OFF}"
fi

# --- yt-dlp. Genuinely needed to pull a VOD off Kick (fetch_vod.py). It is in
# --- requirements.txt, and fetch_vod.py looks in the venv's bin/, so pip
# --- installing it in step 2 is enough. No Homebrew needed.
if command -v yt-dlp >/dev/null 2>&1; then
  ok "yt-dlp found on your system ($(yt-dlp --version 2>/dev/null || echo 'version unknown'))"
else
  info "${DIM}yt-dlp will be installed into the pipeline's environment in the next step${OFF}"
fi

# ---------------------------------------------------------------------------
step "Building the clip pipeline's Python environment"
# ---------------------------------------------------------------------------

[ -f "$PIPELINE/requirements.txt" ] || fail \
  "tools/clip-pipeline/requirements.txt is missing, so there is no list of what to install." \
  "This copy of the project is incomplete. Get a full copy of the repository."

# Idempotent: reuse a healthy venv, rebuild a broken or wrong-version one. A venv
# copied from another Mac has absolute paths baked into it and will not run, so
# "the python in it does not execute" is a rebuild, not an error.
if [ -x "$VENV/bin/python" ] && "$VENV/bin/python" -c 'import sys' >/dev/null 2>&1; then
  ok "Reusing the existing environment at tools/clip-pipeline/.venv"
else
  if [ -e "$VENV" ]; then
    warn "The existing tools/clip-pipeline/.venv does not work here (it was built on another Mac) — rebuilding it"
    rm -rf "$VENV"
  fi
  info "Creating tools/clip-pipeline/.venv ..."
  "$PY" -m venv "$VENV" || fail "Could not create the Python environment at $VENV." \
    "Check you have write permission to that folder, then try again."
  ok "Environment created"
fi

info "Updating pip ..."
"$VENV/bin/python" -m pip install --quiet --upgrade pip >/dev/null 2>&1 || \
  warn "pip could not be updated — carrying on with the version you have"

printf '      Installing the video, audio and transcription packages.\n'
printf '      %sThis is the slow part: about 250-300 MB to download, ~1 GB on disk.%s\n' "$DIM" "$OFF"
printf '      %sExpect 5-15 minutes on a normal connection. Leave it running.%s\n' "$DIM" "$OFF"
if ! "$VENV/bin/python" -m pip install -r "$PIPELINE/requirements.txt"; then
  fail "Installing the Python packages failed. The messages above say which one." \
       "Most common causes:" \
       "  * the internet dropped — just run ./install.sh again, it picks up where it left off" \
       "  * this Mac's Python is too new for the pinned packages — force the built-in one:" \
       "      rm -rf tools/clip-pipeline/.venv && PYTHON=/usr/bin/python3 ./install.sh"
fi
ok "Python packages installed"

# openai-whisper's load_audio() shells out to plain `ffmpeg` from PATH, unlike
# every other stage which calls imageio_ffmpeg.get_ffmpeg_exe() directly. The
# project ships no system ffmpeg on purpose, so put the vendored binary on the
# venv's PATH under the name whisper looks for. Without this the speech path
# (--select speech) dies on the first chunk with FileNotFoundError: 'ffmpeg'.
FFMPEG_SRC="$("$VENV/bin/python" -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())')"
ln -sf "$FFMPEG_SRC" "$VENV/bin/ffmpeg"
ok "ffmpeg symlinked into the venv (vendored $("$VENV/bin/ffmpeg" -version 2>/dev/null | head -1 | awk '{print $3}'))"

# ---------------------------------------------------------------------------
step "Installing the dashboard"
# ---------------------------------------------------------------------------

[ -f "$SITE/package.json" ] || fail \
  "site/package.json is missing, so the dashboard cannot be installed." \
  "This copy of the project is incomplete. Get a full copy of the repository."

# `npm ci` is the reproducible one: it installs exactly the versions in
# package-lock.json and nothing else. It refuses to run if the lock file is
# missing or out of step with package.json, which is when `npm install` is right.
info "Installing the dashboard's packages (a minute or two) ..."
if [ -f "$SITE/package-lock.json" ] && (cd "$SITE" && npm ci --no-audit --no-fund); then
  ok "Dashboard packages installed (exact locked versions)"
elif (cd "$SITE" && npm install --no-audit --no-fund); then
  warn "Installed with 'npm install' — the lock file was missing or out of date, so versions may differ slightly"
else
  fail "Installing the dashboard's packages failed. The messages above say why." \
       "The usual cause is a dropped connection. Try again:" \
       "  ./install.sh" \
       "" \
       "If it keeps failing, clear the cache and retry:" \
       "  rm -rf site/node_modules && npm cache clean --force && ./install.sh"
fi

# ---------------------------------------------------------------------------
step "Creating the working folders"
# ---------------------------------------------------------------------------

# Read off the code rather than assumed:
#   clips/                  library.py, settings.py, framing locks   (store of record)
#   clips/export-packs/     build_export_pack.py
#   streams/                archive.py — the stream archive
#   streams/prepare/        prepare_stream.py progress, read by /api/yp/prepare
#   streams/proxy/          make_proxy.py — browser-playable remuxes, read by yp.ts
#   streams/waveform/       waveform.py — timeline audio peaks
#   transcripts/            transcripts.py, read by yp.ts getTranscript()
#   tools/clip-pipeline/work/          per-stream audio, calibration, music map
#   tools/clip-pipeline/work/preview/  still frames and draft renders for the editor
#   site/data/              the ops dashboard's local state file
CREATED=0
for dir in \
  "$REPO/clips" \
  "$REPO/clips/export-packs" \
  "$REPO/streams" \
  "$REPO/streams/prepare" \
  "$REPO/streams/proxy" \
  "$REPO/streams/waveform" \
  "$REPO/transcripts" \
  "$PIPELINE/work" \
  "$PIPELINE/work/preview" \
  "$SITE/data"
do
  if [ ! -d "$dir" ]; then mkdir -p "$dir"; CREATED=$((CREATED + 1)); fi
done
# No data file is seeded. library.py, archive.py and settings.py all return sane
# empty defaults when their JSON is absent, and clips/library.json is the store of
# record — an installer must never be able to blank it.
if [ "$CREATED" -eq 0 ]; then ok "All working folders were already there"; else ok "Created $CREATED folder(s)"; fi

# Every shipped script, not just start.sh. capture.sh is the one that matters:
# the LaunchAgent below runs it through bash, but anyone invoking it directly --
# or copying the `--install` line it prints -- needs the bit set.
CHMODDED=0
for script in "$REPO"/*.sh "$PIPELINE"/*.sh; do
  [ -f "$script" ] || continue
  chmod +x "$script" 2>/dev/null && CHMODDED=$((CHMODDED + 1))
done
ok "Made $CHMODDED script(s) executable"

# ---------------------------------------------------------------------------
step "Capturing streams automatically"
# ---------------------------------------------------------------------------

# Kick deletes a non-verified channel's VODs after about 30 days. Every stream
# lost so far was lost to nobody running the scan, not to anything failing, so
# this is the one part of the install that is about time rather than software.
#
# Declining is a real option and leaves everything working: the dashboard's
# "Archive now" button and `./tools/clip-pipeline/capture.sh` both still run by
# hand. It only removes the part that happens while you are asleep.
AGENT_LABEL="com.yanchan.capture"
AGENT_SRC="$PIPELINE/assets/${AGENT_LABEL}.plist"
AGENT_DST="$HOME/Library/LaunchAgents/${AGENT_LABEL}.plist"

install_agent() {
  mkdir -p "$(dirname "$AGENT_DST")"
  sed "s|__REPO__|$REPO|g" "$AGENT_SRC" > "$AGENT_DST"
  # bootout first so re-running the installer replaces the agent rather than
  # failing with "service already loaded".
  launchctl bootout "gui/$(id -u)/$AGENT_LABEL" >/dev/null 2>&1 || true
  if launchctl bootstrap "gui/$(id -u)" "$AGENT_DST" 2>/dev/null; then
    ok "Daily capture installed — it runs at 04:00, and on wake if the Mac was asleep"
    ok "To stop it later:  launchctl bootout gui/\$(id -u)/$AGENT_LABEL"
    return 0
  fi
  rm -f "$AGENT_DST"
  warn "Could not load the daily capture agent. Everything else works;"
  warn "capture by hand with ./tools/clip-pipeline/capture.sh"
  return 1
}

if [ ! -f "$AGENT_SRC" ]; then
  warn "No LaunchAgent template shipped — skipping automatic capture"
elif [ "${YP_INSTALL_AGENT:-}" = "yes" ]; then
  install_agent || true                      # non-interactive install
elif [ "${YP_INSTALL_AGENT:-}" = "no" ] || [ ! -t 0 ]; then
  info "Skipping automatic capture (run ./tools/clip-pipeline/capture.sh by hand,"
  info "or re-run this installer from a Terminal to be asked)."
else
  printf '\n      Kick deletes streams after about 30 days.\n'
  printf '      Check for new streams every day at 04:00, automatically? [Y/n] '
  read -r REPLY_AGENT
  case "${REPLY_AGENT:-y}" in
    [Nn]*) info "Skipped. Capture by hand with ./tools/clip-pipeline/capture.sh" ;;
    *)     install_agent || true ;;
  esac
fi

# ---------------------------------------------------------------------------
step "Checking everything works"
# ---------------------------------------------------------------------------

DOCTOR_OK=1
"$VENV/bin/python" "$PIPELINE/doctor.py" || DOCTOR_OK=0

# ---------------------------------------------------------------------------
step "Done"
# ---------------------------------------------------------------------------

if [ "$DOCTOR_OK" -eq 0 ]; then
  printf '\n  %s%sInstalled, but the check above found problems.%s\n' "$YELLOW" "$BOLD" "$OFF"
  printf '  Fix the lines marked FAIL, then run:\n\n'
  printf '      %s./install.sh%s\n\n' "$BOLD" "$OFF"
  exit 1
fi

printf '\n  %s%sInstall complete.%s\n\n' "$GREEN" "$BOLD" "$OFF"
printf '  Now start the dashboard:\n\n'
printf '      %s./start.sh%s\n\n' "$BOLD" "$OFF"
printf '  %sIt opens in your browser. Leave that Terminal window open while you work —%s\n' "$DIM" "$OFF"
printf '  %sclosing it stops the dashboard. Press Ctrl-C in it to stop on purpose.%s\n\n' "$DIM" "$OFF"
