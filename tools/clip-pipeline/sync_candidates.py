#!/usr/bin/env python3
"""Make every clip in the library renderable, including hand-drawn ones.

compose.py renders from `work/<slug>/candidates.json` — the selector's output.
The timeline can also create a clip by hand (mark in, mark out, New clip), and
that writes only to `clips/library.json`. The two never met, so a clip drawn on
the timeline showed up in the review list, was approved like any other, and then
silently had no MP4 behind it: compose iterated candidates and never saw it.

This closes that gap by topping candidates.json up from the library. Selector
picks keep their measured fields untouched — score, rank, bpm, sung_fraction,
the layout probe — because those were measured and cannot be reconstructed here.
A hand-drawn clip gets a candidate with what is actually known about it and no
invented numbers: `score` is null rather than 0, because a person choosing a
moment did not produce a music-density score, and writing 0 would rank it last
by implying it was measured and found weak.

Matching is by start time, the same identity `library.merge_stream` uses. Path
cannot be the key — compose names files `<HHMMSS>_<tag>.mp4`, so a retag renames
the file.

    sync_candidates.py --date 2026-07-08 [--json]
"""
import argparse
import json
import os
from pathlib import Path

import library

ROOT = Path(__file__).resolve().parent
WORK = Path(os.environ["CLIP_WORK"]) if os.environ.get("CLIP_WORK") else (ROOT / "work")

# Measured by the selector and not reproducible from a library record.
MEASURED = ("score", "rank", "sung_fraction", "bpm", "layout", "reason", "excerpt")


def candidate_from_clip(clip: dict) -> dict:
    """A library clip expressed as something compose.py can render."""
    start = float(clip["start"])
    end = float(clip.get("end", start + float(clip.get("duration", 30.0))))
    return {
        "start": round(start, 3),
        "end": round(end, 3),
        "duration": round(end - start, 3),
        "context_tag": clip.get("context_tag") or "beat",
        # Null, not zero: nothing measured this. See the module docstring.
        "score": None,
        "rank": None,
        "sung_fraction": clip.get("sung_fraction"),
        "reason": clip.get("reason") or "created by hand on the timeline",
        "excerpt": clip.get("excerpt", ""),
        "bpm": clip.get("bpm"),
        "layout": clip.get("mode") or clip.get("layout"),
        # No selector proposed this one; a person drew it on the timeline. That
        # is the strongest provenance there is and the queue should say so.
        "selector": clip.get("selector") or "hand",
    }


def sync(date: str, candidates_path: Path) -> dict:
    lib = library.load()
    clips = library.clips(lib, date=date)

    existing = []
    if candidates_path.exists():
        existing = json.loads(candidates_path.read_text())

    known = {round(float(c["start"]), 1) for c in existing if c.get("start") is not None}

    added = []
    for clip in clips:
        if clip.get("start") is None:
            continue
        if round(float(clip["start"]), 1) in known:
            continue
        added.append(candidate_from_clip(clip))

    if added:
        merged = sorted(existing + added, key=lambda c: c["start"])
        candidates_path.parent.mkdir(parents=True, exist_ok=True)
        candidates_path.write_text(json.dumps(merged, indent=2) + "\n")

    return {
        "date": date,
        "candidates": len(existing) + len(added),
        "added": len(added),
        "added_starts": [round(c["start"], 1) for c in added],
        "path": str(candidates_path),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True)
    ap.add_argument("--candidates", type=Path, default=WORK / "candidates.json")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    result = sync(args.date, args.candidates)
    if args.json:
        print(json.dumps(result))
        return
    if result["added"]:
        print(f"Added {result['added']} hand-drawn clip(s) to {result['path']}")
        for s in result["added_starts"]:
            print(f"  at {s}s")
    else:
        print(f"Nothing to add — every library clip for {args.date} is already a candidate")


if __name__ == "__main__":
    main()
