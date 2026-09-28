#!/usr/bin/env bash
set -euo pipefail

# Usage: ./run_pipeline.sh <vod.mp4> <YYYY-MM-DD> [--fullcam-mode skip|reframe]
#
# Produces finished, captioned 9:16 clips in clips/vertical/ plus clips/strategy.md.
# Every stage caches into work/ and is safe to re-run.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV="$SCRIPT_DIR/.venv/bin/python"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

SOURCE=""
STREAM_DATE=""
FULLCAM_MODE="reframe"
SELECT="music"
COUNT=15

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fullcam-mode) FULLCAM_MODE="$2"; shift 2 ;;
    --select) SELECT="$2"; shift 2 ;;
    --count) COUNT="$2"; shift 2 ;;
    -*) echo "Unknown option: $1" >&2
        echo "Usage: $0 <source.mp4> <YYYY-MM-DD> [--fullcam-mode skip|reframe]" >&2
        exit 1 ;;
    *)  if [[ -z "$SOURCE" ]]; then SOURCE="$1"; else STREAM_DATE="$1"; fi; shift ;;
  esac
done

if [[ -z "$SOURCE" || -z "$STREAM_DATE" ]]; then
  echo "Usage: $0 <source.mp4> <YYYY-MM-DD> [--fullcam-mode skip|reframe]" >&2
  exit 1
fi
if [[ ! -f "$SOURCE" ]]; then
  echo "Source not found: $SOURCE" >&2
  exit 1
fi

VERT_DIR="$PROJECT_ROOT/clips/$STREAM_DATE"

export WHISPER_MODEL="${WHISPER_MODEL:-small}"
export WHISPER_FALLBACK_MODEL="${WHISPER_FALLBACK_MODEL:-base}"
export WHISPER_CHUNK_SECONDS="${WHISPER_CHUNK_SECONDS:-900}"

# Stale cache is the #1 failure mode: every stage reuses work/ if it exists.
# Archive it whenever the source changes so a new stream can never silently
# reuse the previous stream's transcript or calibration.
if [[ -s work/audio.wav || -s work/transcript.json ]]; then
  if [[ ! -f work/source.txt ]] || [[ "$(cat work/source.txt)" != "$SOURCE" ]]; then
    archive="work_prev_$(date +%Y%m%d%H%M%S)"
    echo "Cache is not from this source — archiving to $archive"
    mv work "$archive"
  fi
fi
mkdir -p work
printf '%s' "$SOURCE" > work/source.txt

echo "=== 1/7 Extract audio ==="
$VENV extract_audio.py --source "$SOURCE"

echo "=== 2/7 Calibrate stream layout ==="
$VENV calibrate.py --source "$SOURCE"

if [[ "$SELECT" == "music" ]]; then
  echo "=== 3/7 Music map ==="
  $VENV detect_music.py
  echo "=== 4/7 Select music clips ==="
  $VENV select_music_clips.py --count "$COUNT" --source "$SOURCE"
  $VENV transcribe_windows.py
else
  echo "=== 3/7 Transcribe (full) ==="
  $VENV transcribe.py
  echo "=== 4/7 Analyze viral moments ==="
  $VENV analyze.py --max-candidates "$COUNT"
fi

echo "=== 5/7 Compose finished vertical clips ==="
$VENV compose.py --source "$SOURCE" --output-dir "$VERT_DIR" \
  --fullcam-mode "$FULLCAM_MODE"

echo "=== 6/7 Build strategy doc ==="
$VENV build_strategy.py --date "$STREAM_DATE" --source-name "$(basename "$SOURCE")"

echo "=== 7/7 QA ==="
$VENV qa_report.py

echo ""
echo "=== Pipeline complete ==="
echo "Clips:    $VERT_DIR"
echo "Strategy: $PROJECT_ROOT/clips/strategy.md"
echo "QA:       $(pwd)/work/qa.json"
