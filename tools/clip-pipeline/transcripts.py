#!/usr/bin/env python3
"""Transcripts that outlive the working directory, and corrections that stick.

Two problems with keeping a transcript in `work/<slug>/`. It is scratch — clearing
a work dir throws away an hour of transcription. And it is not addressable: the
editor needs "the transcript for this stream", not "the file under whichever work
dir this stream happened to get".

So the transcript is stored per stream under `transcripts/`, and CORRECTIONS are
stored separately from it. That separation is the point: re-transcribing a stream
with a better model replaces the machine output and leaves the human's fixes
alone. A correction carries the segment's timing, so fixing a word never moves it.

    transcripts.py --store <work-dir> --stream 2026-07-08
    transcripts.py --fix 2026-07-08 --at 9313.4 --to "you could do a roll"
    transcripts.py --export 2026-07-08 --format srt
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent.parent
STORE = PROJECT_ROOT / "transcripts"

MATCH_TOLERANCE = 0.35      # seconds; a correction binds to the segment starting here


def paths(stream: str):
    return (STORE / f"{stream}.json", STORE / f"{stream}.edits.json")


def load(stream: str) -> dict:
    src, _ = paths(stream)
    return json.loads(src.read_text()) if src.exists() else {"segments": []}


def load_edits(stream: str) -> dict:
    _, ed = paths(stream)
    return json.loads(ed.read_text()) if ed.exists() else {"version": 1, "edits": []}


def save_edits(stream: str, data: dict) -> None:
    _, ed = paths(stream)
    ed.parent.mkdir(parents=True, exist_ok=True)
    ed.write_text(json.dumps(data, indent=2) + "\n")


def store(work_dir: Path, stream: str) -> Path:
    """Copy a finished transcript out of a work dir into the durable store."""
    for name in ("transcript.json", "transcript_windows.json"):
        src = work_dir / name
        if src.exists():
            data = json.loads(src.read_text())
            dest, _ = paths(stream)
            dest.parent.mkdir(parents=True, exist_ok=True)
            data["stream"] = stream
            data.setdefault("coverage", "full" if name == "transcript.json" else "windows")
            dest.write_text(json.dumps(data))
            return dest
    raise SystemExit(f"no transcript in {work_dir}")


def nearest_segment(stream: str, at: float, window: float = 30.0):
    """The segment a correction is really about.

    A correction must bind to a segment that exists. Storing it at whatever
    timestamp was typed silently binds to nothing, and the fix looks applied while
    the render keeps the machine's version.
    """
    segs = load(stream).get("segments", [])
    if not segs:
        return None
    best = min(segs, key=lambda s: abs(s.get("start", 0) - at))
    return best if abs(best.get("start", 0) - at) <= window else None


def add_edit(stream: str, at: float, text: str, note: str = "") -> dict:
    seg = nearest_segment(stream, at)
    if seg is None:
        raise SystemExit(f"no transcript segment near {at}s in {stream} — "
                         f"a correction has to bind to real speech")
    at = seg["start"]
    data = load_edits(stream)
    data["edits"] = [e for e in data["edits"] if abs(e["at"] - at) > MATCH_TOLERANCE]
    edit = {"at": round(float(at), 2), "text": text, "note": note,
            "was": seg.get("text", "").strip()}
    data["edits"].append(edit)
    data["edits"].sort(key=lambda e: e["at"])
    save_edits(stream, data)
    return edit


def apply_edits(segments: list, edits: list) -> list:
    """Overlay corrections onto machine output, keeping every original timing."""
    if not edits:
        return segments
    out = []
    for seg in segments:
        hit = next((e for e in edits
                    if abs(e["at"] - seg.get("start", -99)) <= MATCH_TOLERANCE), None)
        if hit:
            seg = dict(seg, text=hit["text"], edited=True)
            # Word timings belong to the machine pass; a retyped line invalidates
            # the per-word split, so drop it rather than mis-highlight a karaoke word.
            seg.pop("words", None)
        out.append(seg)
    return out


def resolved(stream: str) -> list:
    return apply_edits(load(stream).get("segments", []), load_edits(stream)["edits"])


def as_text(segments: list) -> str:
    def ts(t):
        return f"{int(t // 3600):02d}:{int(t // 60) % 60:02d}:{int(t % 60):02d}"
    return "\n".join(f"[{ts(s['start'])}] {s.get('text', '').strip()}"
                     for s in segments if s.get("text", "").strip())


def as_srt(segments: list) -> str:
    def ts(t):
        ms = int(round((t - int(t)) * 1000))
        return f"{int(t // 3600):02d}:{int(t // 60) % 60:02d}:{int(t % 60):02d},{ms:03d}"
    out = []
    for i, s in enumerate([x for x in segments if x.get("text", "").strip()], 1):
        out.append(f"{i}\n{ts(s['start'])} --> {ts(s['end'])}\n{s['text'].strip()}\n")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--store", type=Path, metavar="WORK_DIR")
    ap.add_argument("--stream", help="stream date, e.g. 2026-07-08")
    ap.add_argument("--fix", metavar="STREAM")
    ap.add_argument("--at", type=float)
    ap.add_argument("--to")
    ap.add_argument("--note", default="")
    ap.add_argument("--export", metavar="STREAM")
    ap.add_argument("--format", choices=["txt", "srt"], default="txt")
    ap.add_argument("--out", type=Path)
    args = ap.parse_args()

    if args.store:
        if not args.stream:
            raise SystemExit("--store needs --stream")
        print(f"stored -> {store(args.store, args.stream)}")
        return 0
    if args.fix:
        if args.at is None or not args.to:
            raise SystemExit("--fix needs --at and --to")
        e = add_edit(args.fix, args.at, args.to, args.note)
        print(f"bound to the segment at {e['at']}s\n  was: {e['was']!r}\n  now: {e['text']!r}")
        return 0
    if args.export:
        segs = resolved(args.export)
        text = as_srt(segs) if args.format == "srt" else as_text(segs)
        if args.out:
            args.out.write_text(text)
            print(f"exported {len(segs)} segments -> {args.out}")
        else:
            sys.stdout.write(text)
        return 0
    ap.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
