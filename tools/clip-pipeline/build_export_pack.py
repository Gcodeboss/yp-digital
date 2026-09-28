#!/usr/bin/env python3
"""Assemble the approved clips into something a person can post from.

This is the handoff, and it is deliberately not a publish button:
`Agent-1-Content-Engine.md` is explicit that the agent never auto-publishes. The
pack is what gets an approved clip from "rendered" to "posted" — a folder holding
the videos, the caption text for each, and the order to post them in.

    build_export_pack.py                       every approved clip
    build_export_pack.py --date 2026-07-08     one stream's approved clips
    build_export_pack.py --include-pending     dry run before approvals exist
"""
import argparse
import json
import shutil
import sys
from datetime import date as date_cls, timedelta
from pathlib import Path

import build_strategy
import library
import tags as TAGS
import transcripts as _tr

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent.parent
PACKS = PROJECT_ROOT / "clips" / "export-packs"

# Two a day, spread across the week. Dumping a batch in one day is the mistake the
# content-engine doc calls out by name.
PER_DAY = 2
SLOTS = ["12:00 PM ET", "7:00 PM ET"]


def fmt_time(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 3600:02d}:{s // 60 % 60:02d}:{s % 60:02d}"


def caption_for(clip: dict) -> str:
    copy = clip.get("copy") or {}
    if copy.get("caption"):
        return copy["caption"]
    hook = copy.get("hook") or TAGS.hooks(clip["context_tag"])[0]
    return f"{hook}\n\n{TAGS.hashtags(clip['context_tag'])}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="limit to one stream")
    ap.add_argument("--include-pending", action="store_true",
                    help="include clips that are not approved yet (dry run)")
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()

    data = library.load()
    clips = library.clips(data, date=args.date)
    wanted = {"approved"} | ({"new", "needs_edit"} if args.include_pending else set())
    chosen = [c for c in clips if (c.get("status") or "new") in wanted]

    if not chosen:
        print("Nothing approved yet — approve clips in the dashboard, or pass "
              "--include-pending for a dry run.")
        return 1

    stamp = args.date or date_cls.today().isoformat()
    pack = args.out or (PACKS / f"pack-{stamp}")
    (pack / "clips").mkdir(parents=True, exist_ok=True)
    (pack / "captions").mkdir(parents=True, exist_ok=True)

    # Highest-scoring first decides posting order; the files stay chronological.
    ordered = sorted(chosen, key=lambda c: c.get("score", 0), reverse=True)
    schedule = []
    start_day = date_cls.today()
    for i, clip in enumerate(ordered):
        day = start_day + timedelta(days=i // PER_DAY)
        schedule.append((day.isoformat(), SLOTS[i % PER_DAY], clip))

    manifest = []
    for clip in chosen:
        src = PROJECT_ROOT / clip["path"]
        if not src.exists():
            print(f"  missing, skipped: {clip['path']}", file=sys.stderr)
            continue
        name = f"{clip['date']}_{fmt_time(clip['start']).replace(':', '')}_{clip['context_tag']}.mp4"
        shutil.copy2(src, pack / "clips" / name)
        (pack / "captions" / f"{name[:-4]}.txt").write_text(caption_for(clip) + "\n")

        # The clip's own words, so a caption can be rewritten without the pipeline.
        if clip.get("date"):
            try:
                segs = [s for s in _tr.resolved(clip["date"])
                        if s["end"] > clip["start"] and s["start"] < clip["end"]]
                if segs:
                    (pack / "captions" / f"{name[:-4]}.transcript.txt").write_text(
                        _tr.as_text(segs) + "\n")
            except Exception:
                pass

        primary, cross = TAGS.platforms(clip["context_tag"])
        manifest.append({
            "file": f"clips/{name}",
            "stream": clip["date"],
            "vod_time": fmt_time(clip["start"]),
            "duration_s": round(clip["duration"], 1),
            "tag": clip["context_tag"],
            "score": clip.get("score"),
            "status": clip.get("status", "new"),
            "platform": primary,
            "cross_post": cross,
            "hook": (clip.get("copy") or {}).get("hook", ""),
            "caption_file": f"captions/{name[:-4]}.txt",
        })

    lines = [
        f"# Export pack — {stamp}",
        "",
        f"**{len(manifest)} clip(s)** ready to post. Finished at 1080x1920 with burned-in",
        "captions, the mark and audio at -14 LUFS. Post as they are.",
        "",
        "Nothing here has been published. This pack is the handoff.",
        "",
        "## Posting order",
        "",
        "| Day | Time | Clip | Tag | Platform |",
        "|-----|------|------|-----|----------|",
    ]
    for day, slot, clip in schedule:
        primary, _ = TAGS.platforms(clip["context_tag"])
        lines.append(f"| {day} | {slot} | `{fmt_time(clip['start'])}` "
                     f"{clip['date']} | {clip['context_tag']} | {primary} |")

    lines += ["", "## Clips", ""]
    for m in manifest:
        lines += [
            f"### {m['vod_time']} · {m['stream']} · {m['tag']} ({m['duration_s']:.0f}s)",
            "",
            f"**Hook:** {m['hook'] or '_none written_'}",
            f"**File:** `{m['file']}`  ·  **Caption:** `{m['caption_file']}`",
            f"**Post to:** {m['platform']} · cross-post {m['cross_post']}",
            "",
        ]

    (pack / "README.md").write_text("\n".join(lines))
    (pack / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    # `clips/strategy.md` and `clips/<date>/strategy.md` were written only by a
    # full pipeline run, so they went stale on every hook edited, clip retagged
    # or status changed in the dashboard -- and nothing rebuilt them. They were
    # shipped as truth while being a snapshot of whenever compose.py last ran.
    #
    # Regenerated here rather than deleted, because this is the moment they have
    # to be right: the pack is what a person reads and posts from, and the docs
    # are the surrounding context for it. Read-only with respect to the library.
    refreshed = sorted({c["date"] for c in chosen if c.get("date")})
    for date in refreshed:
        build_strategy.refresh_docs(data, date)
    if refreshed:
        print(f"  strategy docs rebuilt for {', '.join(refreshed)}")

    size = sum(f.stat().st_size for f in (pack / "clips").glob("*.mp4"))
    print(f"Export pack: {len(manifest)} clip(s), {size/1e9:.2f} GB -> {pack}")
    print(f"  {pack/'README.md'}  posting order and copy")
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
