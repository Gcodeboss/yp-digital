#!/usr/bin/env python3
"""Get a captured stream ready to work on in the editor.

Capturing a stream is not the same as being able to edit it. Opening a fresh
capture in the timeline gives you the video and nothing else: no waveform, so you
cannot see where anyone speaks; no music map, so the detector has nothing to
show; no calibration, so the 9:16 preview cannot be composed. All of that is
pipeline output that simply has not been produced yet.

This produces exactly the pieces the editor needs, and nothing else — it does NOT
select clips or render anything. Marking clips stays the creator's job.

    prepare_stream.py --stream 2026-08-12
    prepare_stream.py --stream 2026-08-12 --transcribe   also run Whisper (slow)
    prepare_stream.py --status 2026-08-12

Progress is written to `streams/prepare/<stream>.json` so a UI can follow along.
"""
import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

import archive
import library
from extract_audio import audio_is_complete, get_ffmpeg, probe_source

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent.parent
STATE = PROJECT_ROOT / "streams" / "prepare"
VENV = ROOT / ".venv" / "bin" / "python"

STEPS = [
    ("audio", "extracting audio"),
    ("calibrate", "measuring the stream layout"),
    ("music", "building the music and vocal map"),
    ("waveform", "building the audio waveform"),
    ("proxy", "making the stream playable in the browser"),
]


def slug_for(path: Path) -> str:
    return re.sub(r"[^a-z0-9]+", "-", path.stem.lower()).strip("-")[:60]


def source_for(stream: str):
    """The original capture — not a proxy. Layout coordinates are source pixels."""
    for rec in archive.archived(archive.load()):
        if rec.get("stream_date") == stream and rec.get("path"):
            p = Path(rec["path"])
            return p if p.is_absolute() else PROJECT_ROOT / p
    batch = (library.load().get("batches") or {}).get(stream) or {}
    return library.resolve_path(batch.get("source"))


def write_state(stream: str, **fields):
    STATE.mkdir(parents=True, exist_ok=True)
    path = STATE / f"{stream}.json"
    data = json.loads(path.read_text()) if path.exists() else {}
    data.update(fields)
    data["updated_at"] = time.time()
    path.write_text(json.dumps(data, indent=2))
    return data


def read_state(stream: str) -> dict:
    path = STATE / f"{stream}.json"
    return json.loads(path.read_text()) if path.exists() else {}


def source_seconds(src: Path):
    """How long the capture claims to be, or None if it will not probe."""
    try:
        return probe_source(get_ffmpeg(), src).get("duration")
    except Exception:
        return None


def json_is_complete(path: Path) -> bool:
    """A half-written JSON file is not a finished step.

    Same class of bug as the truncated WAV: `exists()` was the whole test, so a
    run killed while calibrate.py or detect_music.py was writing left a file that
    parses as nothing and is never rebuilt, because it is there.
    """
    try:
        return bool(json.loads(path.read_text()))
    except (OSError, ValueError):
        return False


def redo(path: Path, why: str) -> None:
    print(f"  {path.name} is {why} — a run was interrupted. Rebuilding it.")


def run(step: str, args: list, work: Path, stream: str) -> bool:
    write_state(stream, step=step, running=True, error=None)
    proc = subprocess.run([str(VENV), *args], cwd=ROOT,
                          env={**__import__("os").environ, "CLIP_WORK": str(work)},
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if proc.returncode != 0:
        tail = "\n".join(proc.stdout.strip().splitlines()[-3:])
        write_state(stream, running=False, error=f"{step}: {tail}")
        print(f"FAILED at {step}:\n{tail}", file=sys.stderr)
        return False
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stream")
    ap.add_argument("--status", metavar="STREAM")
    ap.add_argument("--transcribe", action="store_true",
                    help="also run Whisper over the whole stream (30-60 min)")
    args = ap.parse_args()

    if args.status:
        print(json.dumps(read_state(args.status), indent=2))
        return 0
    if not args.stream:
        ap.print_help()
        return 1

    stream = args.stream
    src = source_for(stream)
    if not src or not src.exists():
        print(f"no archived source for {stream}", file=sys.stderr)
        return 1

    work = ROOT / "work" / slug_for(src)
    work.mkdir(parents=True, exist_ok=True)
    (work / "source.txt").write_text(str(src))
    write_state(stream, running=True, step="starting", error=None, done=False,
                work_dir=library.relative(work), source=library.relative(src))
    print(f"{stream}: preparing from {src.name}")

    # `exists()` used to be the whole "already done" test for these three, so a
    # killed run left a stub that every later stage then failed on, always with an
    # error naming the later stage. compose.py grew a size floor for exactly this
    # class; preparation never had one.
    seconds = source_seconds(src)
    if not audio_is_complete(work / "audio.wav", seconds):
        if (work / "audio.wav").exists():
            redo(work / "audio.wav", "shorter than the source")
        print("  audio …")
        if not run("audio", ["extract_audio.py", "--source", str(src)], work, stream):
            return 1
    if not json_is_complete(work / "calibration.json"):
        if (work / "calibration.json").exists():
            redo(work / "calibration.json", "unreadable")
        print("  calibration …")
        if not run("calibrate", ["calibrate.py", "--source", str(src)], work, stream):
            return 1
    if not json_is_complete(work / "music.json"):
        if (work / "music.json").exists():
            redo(work / "music.json", "unreadable")
        print("  music and vocal map …")
        if not run("music", ["detect_music.py"], work, stream):
            return 1

    print("  waveform …")
    if not run("waveform", ["waveform.py", "--stream", stream], work, stream):
        return 1

    # A capture is not "ready to edit" until it can be watched. Every HLS capture
    # arrives as MPEG-TS with an .mp4 name -- it starts 0x47, not `ftyp` -- and no
    # browser will play one, so the editor's video element showed a black pane on
    # a stream that was otherwise fully prepared. `make_proxy.py` was written for
    # exactly this and was never wired in: the seven older streams have proxies
    # only because someone ran it by hand, and every capture since arrived
    # unwatchable. Stream-copy remux, no re-encode, about a minute.
    print("  browser proxy …")
    if not run("proxy", ["make_proxy.py", "--stream", stream], work, stream):
        # Not fatal: everything except in-browser playback still works, and
        # saying so beats failing a preparation that otherwise succeeded.
        print("  note: proxy failed — the stream is prepared but will not play "
              "in the browser until make_proxy.py succeeds", file=sys.stderr)

    if args.transcribe and not (work / "transcript.json").exists():
        print("  transcribing the whole stream (this is the slow one) …")
        if not run("transcribe", ["transcribe.py"], work, stream):
            return 1
        run("store", ["transcripts.py", "--store", str(work), "--stream", stream], work, stream)

    # Record where this stream's pieces live so the editor can find them.
    lib = library.load()
    batch = dict(library.settings_for(lib, stream))
    music = json.loads((work / "music.json").read_text()) if (work / "music.json").exists() else {}
    batch.update({"work_dir": library.relative(work),
                  "source": library.relative(src),
                  "calibration": library.relative(work / "calibration.json"),
                  "stream_duration": music.get("duration")})
    library.record_settings(lib, stream, batch)
    library.save(lib)

    write_state(stream, running=False, done=True, step="ready", error=None)
    print(f"{stream}: ready to edit")
    return 0


if __name__ == "__main__":
    sys.exit(main())
