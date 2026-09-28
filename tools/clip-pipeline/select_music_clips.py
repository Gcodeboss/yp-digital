#!/usr/bin/env python3
"""Turn detect_music.py's segments into clip candidates.

analyze.py picks moments by *speech* energy, which reliably finds the talking and
just as reliably misses the music — the thing Yanchan actually wants clipped. This
selects from the music map instead: the strongest stretches where a beat is
genuinely playing, preferring the ones that are sung over instrumental.

Emits work/candidates.json in the same shape analyze.py produces, so compose.py
and build_strategy.py consume it unchanged.

Ranking blends two things detect_music.py measures: how strongly the music reads
(`score`) and how much sustained vocal is in it (`sung_fraction`). Sorting on
`kind` alone buried a great instrumental behind a weak vocal take, so both feed
one number and the mix is visible in the candidate as `rank`.

Usage:
    select_music_clips.py [--count 10] [--kind singing|instrumental|any]
"""
import argparse
import json
import os
from pathlib import Path

import settings as _settings
from layout import clip_layout, resolve_transcript

ROOT = Path(__file__).resolve().parent
WORK = Path(os.environ["CLIP_WORK"]) if os.environ.get("CLIP_WORK") else (ROOT / "work")

TARGET = 30.0        # clip length
MIN_SPACING = 240.0  # keep picks far apart so a batch isn't all one song
SUNG_WEIGHT = 0.30   # share of the ranking that vocal presence is worth


def excerpt_for(transcript_path: Path, start, end, max_words=35):
    if not transcript_path.exists():
        return ""
    segs = json.loads(transcript_path.read_text()).get("segments", [])
    text = " ".join(s.get("text", "").strip() for s in segs
                    if s["end"] > start and s["start"] < end)
    words = text.split()
    return " ".join(words[:max_words]) + ("..." if len(words) > max_words else "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--music", type=Path, default=WORK / "music.json")
    ap.add_argument("--transcript", type=Path, default=None)
    ap.add_argument("--output", type=Path, default=WORK / "candidates.json")
    ap.add_argument("--count", type=int, default=None,
                    help="the content engine's target is 8-15 pieces per capture")
    ap.add_argument("--kind", choices=["singing", "instrumental", "any"], default=None)
    ap.add_argument("--min-duration", type=float, default=None)
    ap.add_argument("--spacing", type=float, default=None,
                    help="minimum seconds between two picks")
    ap.add_argument("--skip-head", type=float, default=None,
                    help="ignore the stream intro (usually bumper music)")
    ap.add_argument("--skip-tail", type=float, default=None)
    ap.add_argument("--source", type=Path, default=None,
                    help="VOD; enables the layout probe during ranking")
    ap.add_argument("--calibration", type=Path, default=WORK / "calibration.json")
    ap.add_argument("--json", action="store_true", help="one-line summary only")
    ap.add_argument("--layout", choices=["split", "any"], default=None,
                    help="'split' keeps only candidates that will render as the "
                         "two-pane layout")
    ap.add_argument("--date", default=None,
                    help="stream date, so per-stream guardrails apply")
    args = ap.parse_args()

    # Guardrails come from settings; explicit flags still win. The resolved set is
    # stamped onto the batch so a surprising selection can be explained later.
    cfg = _settings.resolve(args.date, {
        "count": args.count, "spacing": args.spacing, "kind": args.kind,
        "min_duration": args.min_duration, "skip_head": args.skip_head,
        "skip_tail": args.skip_tail, "layout": args.layout,
    })
    args.count = cfg["count"]; args.spacing = cfg["spacing"]; args.kind = cfg["kind"]
    args.min_duration = cfg["min_duration"]; args.skip_head = cfg["skip_head"]
    args.skip_tail = cfg["skip_tail"]; args.layout = cfg["layout"]
    target = cfg["target_length"]
    sung_weight = cfg["sung_weight"]

    if args.transcript is None:
        args.transcript = resolve_transcript(WORK) or (WORK / "transcript.json")

    data = json.loads(args.music.read_text())
    per_second = data.get("per_second_score", [])
    per_second_sung = data.get("per_second_sung", [])
    total_dur = data.get("duration", 0.0)
    segs = [s for s in data["segments"]
            if s["duration"] >= args.min_duration
            and s["start"] >= args.skip_head
            and s["end"] <= total_dur - args.skip_tail]
    if args.kind != "any":
        segs = [s for s in segs if s["kind"] == args.kind]
    if not segs:
        raise SystemExit(f"No music segments of kind={args.kind} longer than "
                         f"{args.min_duration}s in {args.music}")

    cal = None
    if args.source and args.calibration.exists():
        cal = json.loads(args.calibration.read_text())

    # One ranking number rather than a tie-break chain: music strength normalised
    # across this stream's own segments, plus a vocal bonus.
    scores = [s["score"] for s in segs]
    lo_s, hi_s = min(scores), max(scores)
    span = max(hi_s - lo_s, 1e-6)
    for s in segs:
        s["rank"] = round((1 - sung_weight) * (s["score"] - lo_s) / span
                          + sung_weight * s.get("sung_fraction", 0.0), 4)
    segs.sort(key=lambda s: (s["rank"], s["duration"]), reverse=True)

    picked = []
    refused = {"spacing": 0, "layout": 0, "duration": 0}
    for s in segs:
        if len(picked) >= args.count:
            break
        a, b = int(s["start"]), int(s["end"])
        # Centre on the strongest run: music strength plus vocal presence, so a
        # 30 s window lands on the take rather than beside it.
        best_t, best_v = a, -1.0
        for t in range(a, max(a + 1, b - int(target))):
            w = int(target)
            v = sum(per_second[t:t + w]) if per_second else 0
            if per_second_sung:
                v += 0.5 * sum(per_second_sung[t:t + w])
            if v > best_v:
                best_v, best_t = v, t
        start = float(best_t)
        end = min(start + target, s["end"])
        if end - start < args.min_duration:
            start = max(0.0, end - target)
        if any(abs(start - p["start"]) < args.spacing for p in picked):
            refused["spacing"] += 1
            continue

        # Resolving layout here rather than after rendering is the whole point:
        # a render costs 25-40s, this probe costs well under a second. Without
        # it, candidates that reframe badly were only discovered by looking at
        # the finished clip.
        mode = None
        if cal is not None:
            mode, _, _ = clip_layout(args.source, start, end - start, cal)
            if args.layout == "split" and mode != "split":
                refused["layout"] += 1
                continue
        picked.append({
            "start": round(start, 3),
            "end": round(end, 3),
            "duration": round(end - start, 3),
            "score": round(s["score"] * 10, 3),
            "context_tag": "singing" if s["kind"] == "singing" else "beat",
            "rank": s["rank"],
            "sung_fraction": s.get("sung_fraction", 0.0),
            "reason": (f"{s['kind']}: music score={s['score']:.2f}, "
                       f"~{s['bpm']:.0f} BPM, "
                       f"sustained vocal {int(s.get('sung_fraction', 0)*100)}% of segment"),
            "excerpt": excerpt_for(args.transcript, start, end),
            "bpm": s["bpm"],
            "layout": mode,
            # Which selector made this bet. A music pick and a speech pick are
            # different kinds of claim and should not look identical in the
            # review queue -- this one says "the audio got loud and tonal here",
            # which is a much narrower assertion than "he said something worth
            # hearing".
            "selector": "music",
        })

    picked.sort(key=lambda c: c["start"])
    args.output.write_text(json.dumps(picked, indent=2))

    # Never silently ship fewer clips than asked: name what bound the batch.
    shortfall = args.count - len(picked)
    binding = None
    if shortfall > 0:
        binding = max(refused, key=refused.get) if any(refused.values()) else "supply"
        print(f"NOTE: asked for {args.count}, selected {len(picked)}. "
              f"Limited by {_settings.CONSTRAINTS[binding]} "
              f"(refused: {refused['spacing']} on spacing, {refused['layout']} on "
              f"layout, {len(segs)} eligible segments).")

    # Stamp the guardrails onto the batch.
    if args.date:
        import library
        lib = library.load()
        library.record_settings(lib, args.date, dict(
            cfg, selected=len(picked), asked=args.count, limited_by=binding))
        library.save(lib)
    if args.json:
        print(json.dumps({"selected": len(picked),
                          "layouts": [c.get("layout") for c in picked],
                          "tags": [c["context_tag"] for c in picked],
                          "output": str(args.output)}))
        return
    print(f"Selected {len(picked)} music clip(s) -> {args.output}")
    for c in picked:
        m = int(c["start"] // 60)
        lay = f"[{c['layout']}] " if c.get("layout") else ""
        print(f"  {m:>3}:{int(c['start']%60):02d}  {c['context_tag']:<8} "
              f"{c['duration']:.0f}s  {lay}{c['reason']}")


if __name__ == "__main__":
    main()
