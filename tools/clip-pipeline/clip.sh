#!/usr/bin/env bash
set -euo pipefail

# One command, one stream, finished clips.
#
#   ./clip.sh                          newest local VOD
#   ./clip.sh --file /path/to/vod.mp4
#   ./clip.sh --url https://kick.com/video/<id>
#   ./clip.sh --file vod.mp4 --count 4 --select music --layout split
#
# Stages are cached and resumable. The work dir is derived from the source
# filename, so several streams can be processed without clobbering each other
# and without setting CLIP_WORK by hand.
#
# Approximate runtimes on this machine for a ~2.7h VOD:
#   audio 60s | music 30s | select 5s (+1s/candidate with --layout split)
#   windows-transcribe 20s | full-transcribe 30-60min | calibrate 40s
#   compose 25-40s PER CLIP | strategy 1s | qa 5s per clip
# A 6-clip batch is therefore ~4 minutes: run this in the background.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
VENV="$SCRIPT_DIR/.venv/bin/python"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

FETCH_ARGS=()
SELECT="music"     # music | speech
COUNT=10
LAYOUT="any"       # any | split
FULLCAM="reframe"
FORCE=""
STREAM_DATE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url|--file)   FETCH_ARGS+=("$1" "$2"); shift 2 ;;
    --stream)       STREAM_DATE="$2"; shift 2 ;;
    --select)       SELECT="$2"; shift 2 ;;
    --count)        COUNT="$2"; shift 2 ;;
    --layout)       LAYOUT="$2"; shift 2 ;;
    --fullcam-mode) FULLCAM="$2"; shift 2 ;;
    --force)        FORCE="--force"; shift ;;
    -h|--help)      sed -n '3,20p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# A stream that ingest.py has archived can be named by its date instead of a path.
if [[ -n "$STREAM_DATE" ]]; then
  ARCHIVED="$($VENV -c "
import archive, sys
d = archive.load()
hit = [r for r in archive.archived(d) if r.get('stream_date') == '$STREAM_DATE']
print(hit[0]['path'] if hit else '')
" 2>/dev/null)"
  if [[ -n "$ARCHIVED" ]]; then
    FETCH_ARGS+=(--file "$PROJECT_ROOT/$ARCHIVED")
    echo "== using archived stream $STREAM_DATE =="
  else
    echo "No archived stream for $STREAM_DATE — run ingest.py --backfill first" >&2
    exit 1
  fi
fi

echo "== discover =="
META="$($VENV fetch_vod.py ${FETCH_ARGS[@]+"${FETCH_ARGS[@]}"})"
VOD="$(echo "$META"  | $VENV -c 'import json,sys; print(json.load(sys.stdin)["path"])')"
DATE="$(echo "$META" | $VENV -c 'import json,sys; print(json.load(sys.stdin)["date"])')"
echo "  $VOD  ($DATE)"

# Per-VOD work dir keyed on the source filename.
SLUG="$($VENV -c '
import re,sys,pathlib
print(re.sub(r"[^a-z0-9]+","-",pathlib.Path(sys.argv[1]).stem.lower()).strip("-")[:60])
' "$VOD")"
export CLIP_WORK="$SCRIPT_DIR/work/$SLUG"
mkdir -p "$CLIP_WORK"
printf '%s' "$VOD" > "$CLIP_WORK/source.txt"
OUT="$PROJECT_ROOT/clips/$DATE"
mkdir -p "$OUT"
echo "  work: $CLIP_WORK"
echo "  out:  $OUT"

echo "== audio =="
$VENV extract_audio.py --source "$VOD"

echo "== calibrate =="
$VENV calibrate.py --source "$VOD" $FORCE

if [[ "$SELECT" == "music" ]]; then
  echo "== music map =="
  $VENV detect_music.py $FORCE
  echo "== select ($COUNT clips, layout=$LAYOUT) =="
  $VENV select_music_clips.py --count "$COUNT" --layout "$LAYOUT" --source "$VOD" --date "$DATE"
  echo "== transcribe windows =="
  $VENV transcribe_windows.py $FORCE
else
  echo "== transcribe (full: 30-60 min) =="
  $VENV transcribe.py
  echo "== analyze =="
  $VENV analyze.py --max-candidates "$COUNT"
fi

echo "== store transcript =="
$VENV transcripts.py --store "$CLIP_WORK" --stream "$DATE" || true

# Speech-moment discovery. Only worth running against a WHOLE-stream transcript:
# the windowed one covers just the music windows the selector already found, so
# there is nothing outside the music map for it to read. Never fatal -- no key,
# a failed call or an unusable reply leaves the music candidates untouched and
# the batch renders exactly as it does today.
if [ -f "$CLIP_WORK/transcript.json" ]; then
  echo "== discover speech moments =="
  $VENV discover_moments.py --transcript "$CLIP_WORK/transcript.json" \
    --stream "$DATE" --candidates "$CLIP_WORK/candidates.json" || \
    echo "discovery failed; continuing with the music candidates"
else
  echo "== discover speech moments == (skipped: no whole-stream transcript)"
fi

echo "== compose =="
$VENV compose.py --source "$VOD" --output-dir "$OUT" --fullcam-mode "$FULLCAM" \
  --stream "$DATE" $FORCE

echo "== strategy =="
$VENV build_strategy.py --date "$DATE" --source-name "$(basename "$VOD")"

echo "== qa =="
# qa_report.py now fails only when NO clip passed (design D8). A batch where one
# clip of ten fails its checks is a good batch with one clip to look at, and
# calling the whole run FAILED taught the operator to ignore the word.
if $VENV qa_report.py; then
  PASSED="$($VENV -c 'import json,os,sys; p=os.environ["CLIP_WORK"]+"/qa.json"; d=json.load(open(p)); print(d["passed"], d["clips"])' 2>/dev/null || echo "? ?")"
  echo ""
  echo "DONE  clips: $OUT"
  echo "      qa:    $CLIP_WORK/qa.json  ($PASSED passed)"
  echo "      Any clip that failed a check is named above and marked in the dashboard."
else
  echo ""
  echo "QA FAILED — no clip passed its checks." >&2
  echo "See $CLIP_WORK/qa.json and $CLIP_WORK/contact.jpg" >&2
  exit 1
fi
