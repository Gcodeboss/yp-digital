#!/usr/bin/env bash
#
# Build a shippable archive of the YP Digital Dash.
#
# The working repo is ~37 GB, essentially all of it stream footage, rendered
# clips, the Python venv and node_modules. The actual program is under 1 MB.
# This copies out the program and leaves the rest behind, so what gets sent is
# something a person can download rather than a hard drive.
#
# Nothing here is destructive: it only ever reads the repo and writes one
# archive into ../ .
#
#   ./package.sh              -> ../yp-dash-<date>.zip
#   ./package.sh /some/dir    -> writes the archive there instead
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${1:-$(dirname "$REPO")}"
STAMP="$(date +%Y-%m-%d)"
NAME="yp-dash-${STAMP}"
STAGE="$(mktemp -d)/${NAME}"

cleanup() { rm -rf "$(dirname "$STAGE")"; }
trap cleanup EXIT

echo "==> staging $NAME"
mkdir -p "$STAGE"

# --- what ships ------------------------------------------------------------
# Everything needed to install and run, and nothing that can be regenerated
# or re-downloaded.
copy() {
  local src="$1"
  [ -e "$REPO/$src" ] || { echo "    skip  $src (not present)"; return; }
  mkdir -p "$STAGE/$(dirname "$src")"
  cp -R "$REPO/$src" "$STAGE/$(dirname "$src")/"
  echo "    add   $src"
}

# The clipping engine — source only. .venv is rebuilt by install.sh because it
# contains absolute paths to the machine that created it.
mkdir -p "$STAGE/tools/clip-pipeline"
for f in "$REPO"/tools/clip-pipeline/*.py; do
  [ -e "$f" ] && cp "$f" "$STAGE/tools/clip-pipeline/"
done
echo "    add   tools/clip-pipeline/*.py"
copy tools/clip-pipeline/requirements.txt
copy tools/clip-pipeline/assets            # watermark plate, fonts, LaunchAgent plist
copy tools/clip-pipeline/clip.sh
copy tools/clip-pipeline/run_pipeline.sh
# capture.sh is what the LaunchAgent runs. It is a .sh, so the *.py loop above
# does not carry it, and shipping the plist without the script it points at would
# install a scheduled job that fails every night at 04:00.
copy tools/clip-pipeline/capture.sh

# The dashboard — source only. node_modules and .next are rebuilt on install.
copy site/src
copy site/public
copy site/package.json
copy site/package-lock.json
copy site/next.config.ts
copy site/next.config.js
copy site/tsconfig.json
copy site/postcss.config.mjs
copy site/eslint.config.mjs
copy site/next-env.d.ts
copy site/AGENTS.md
copy site/CLAUDE.md
copy site/DESIGN-CONSOLE.md
copy site/.env.example

# Setup and docs — the part a non-developer actually reads.
copy install.sh
copy start.sh
copy package.sh
copy README.md
copy HOW-TO-GUIDE.md
copy DESIGN.md
copy .gitignore

# --- what does NOT ship, and why -------------------------------------------
#   *.mp4, clips/, streams/       source footage and renders — his own machine
#                                 produces these; ~35 GB and none of it is code
#   tools/clip-pipeline/.venv     absolute paths to the build machine
#   tools/clip-pipeline/work      per-stream intermediates, all regenerable
#   site/node_modules, site/.next rebuilt by install.sh
#   Yanchan-Produced/, openspec/  business documents and change specs, not the app
#   .git                          history is not the deliverable

echo "==> checking the archive is actually installable"
missing=0
for required in \
  tools/clip-pipeline/compose.py \
  tools/clip-pipeline/requirements.txt \
  tools/clip-pipeline/capture.sh \
  tools/clip-pipeline/kick_api.py \
  tools/clip-pipeline/scan_kick.py \
  tools/clip-pipeline/assets/com.yanchan.capture.plist \
  site/package.json \
  site/src/app/dashboard/layout.tsx \
  install.sh \
  HOW-TO-GUIDE.md
do
  if [ ! -e "$STAGE/$required" ]; then
    echo "    MISSING  $required"
    missing=$((missing + 1))
  fi
done
if [ "$missing" -gt 0 ]; then
  echo "!!  $missing required file(s) missing — the archive would not install." >&2
  exit 1
fi
echo "    all required files present"

# Guard against shipping something enormous by accident.
STAGE_KB="$(du -sk "$STAGE" | cut -f1)"
if [ "$STAGE_KB" -gt 512000 ]; then
  echo "!!  staged payload is $((STAGE_KB / 1024)) MB — that is far larger than the" >&2
  echo "    program should be. Something big got included; check the copy list." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
ARCHIVE="$OUT_DIR/${NAME}.zip"
rm -f "$ARCHIVE"
( cd "$(dirname "$STAGE")" && zip -qr "$ARCHIVE" "$NAME" -x '*.DS_Store' )

echo
echo "==> done"
echo "    $ARCHIVE"
echo "    $(du -h "$ARCHIVE" | cut -f1)"
echo
echo "    Send that file. On the other machine: unzip, then ./install.sh"
