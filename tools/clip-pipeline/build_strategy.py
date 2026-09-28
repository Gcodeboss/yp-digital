#!/usr/bin/env python3
"""Package a rendered batch: update clips/library.json and write the strategy docs.

Three outputs, and the split matters:

  clips/library.json      store of record, cumulative across every stream, merged
                          (see library.py). Machine-readable -- the dashboard reads
                          THIS, not the markdown.
  clips/<date>/strategy.md  one stream's batch: what to post from this stream.
  clips/strategy.md       roll-up across every stream processed so far, grouped by
                          stream, with the approval state of each clip.

Previously there was only the roll-up path and it was overwritten per run, so a
second stream erased the first stream's paperwork.
"""
import argparse
import json
import os
from datetime import timedelta
from pathlib import Path

import library
import tags as TAGS
from layout import resolve_transcript

ROOT = Path(__file__).resolve().parent
WORK = Path(os.environ["CLIP_WORK"]) if os.environ.get("CLIP_WORK") else (ROOT / "work")
OUT_ROOT = ROOT.parent.parent
DEFAULT_RENDERED = WORK / "rendered.json"
CLIPS_DIR = OUT_ROOT / "clips"
DEFAULT_STREAM_DATE = "2026-06-26"
DEFAULT_SOURCE_NAME = "YanchanProduced_Just Chatting_2026-06-26_720p30.mp4"

STATUS_ICON = {"new": "•", "approved": "✅", "needs_edit": "✎", "scheduled": "🗓",
               "rejected": "✗", "posted": "📤"}


def excerpt_for(transcript, start, end, max_words=40):
    """What is actually said in this clip.

    Computed HERE rather than in select_music_clips.py, which is where it used to
    live. On the music-first path the windows are transcribed AFTER selection, so
    the selector was reading a transcript that did not cover its own picks yet --
    9 of 10 clips in the 2026-06-26 batch came out with an empty excerpt, and the
    one that had text only did because it overlapped the previous batch. Same
    ordering mistake as the transcript-based singing tag.
    """
    text = " ".join(seg.get("text", "").strip() for seg in transcript
                    if seg["end"] > start and seg["start"] < end)
    words = text.split()
    return " ".join(words[:max_words]) + ("..." if len(words) > max_words else "")


def fmt_time(seconds: float) -> str:
    td = timedelta(seconds=int(seconds))
    h, m, s = td.seconds // 3600, (td.seconds // 60) % 60, td.seconds % 60
    return f"{h:02d}:{m:02d}:{s:02d}"


def build_cadence(clips, clips_per_day=2):
    """Spread clips across ~7 days, highest score first. Two a day, not four:
    dumping a batch in one day is the mistake the content engine doc calls out."""
    days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    plan = []
    for i, c in enumerate(sorted(clips, key=lambda c: c.get("score", 0), reverse=True)):
        plan.append((days[(i // clips_per_day) % 7],
                     "12:00 PM ET" if i % clips_per_day == 0 else "7:00 PM ET", c))
    return plan


def rebuild_by_context(data):
    """Symlinks grouped by tag, rebuilt from the WHOLE library.

    Rebuilt from the library rather than from one run's manifest: the old version
    wiped the folder and refilled it from the current batch only, so browsing by
    tag showed one stream.
    """
    by_context = CLIPS_DIR / "by-context"
    for tag_dir in sorted(by_context.glob("*")) if by_context.exists() else []:
        if tag_dir.is_dir():
            for link in tag_dir.iterdir():
                if link.is_symlink() or link.exists():
                    link.unlink()
            tag_dir.rmdir()
    by_context.mkdir(parents=True, exist_ok=True)

    linked = 0
    for c in library.clips(data):
        src = OUT_ROOT / c["path"]
        if not src.exists():
            continue
        tag_dir = by_context / c["context_tag"]
        tag_dir.mkdir(parents=True, exist_ok=True)
        dst = tag_dir / f"{c['date']}_{fmt_time(c['start']).replace(':', '')}_{c['context_tag']}.mp4"
        if dst.exists() or dst.is_symlink():
            dst.unlink()
        os.symlink(src.resolve(), dst)
        linked += 1
    return linked


def stream_doc(date, source_name, clips):
    total = sum(c["duration"] for c in clips)
    reframed = sum(1 for c in clips if c.get("mode") == "reframe")
    lines = [
        f"# Clip Batch — {date}",
        "",
        f"**Source:** `{source_name}`  ",
        f"**Clips:** {len(clips)}  ",
        f"**Total runtime:** {total:.0f}s ({total/60:.1f} min)  ",
        "",
        "Every clip is finished: 1080x1920, burned-in captions, watermark, audio at",
        "-14 LUFS. Approve, then post as-is.",
        "",
        "## Inventory",
        "",
        "| # | VOD time | Tag | Len | Music | Layout | Status | File |",
        "|---|----------|-----|-----|-------|--------|--------|------|",
    ]
    for i, c in enumerate(clips, 1):
        icon = STATUS_ICON.get(c.get("status", "new"), "•")
        lines.append(
            f"| {i} | {fmt_time(c['start'])} | {c['context_tag']} | {c['duration']:.0f}s | "
            f"{c.get('score', 0):.1f} | {c.get('mode', '?')} | {icon} {c.get('status', 'new')} | "
            f"`{Path(c['path']).name}` |")

    lines += ["", "## Post copy", ""]
    for i, c in enumerate(clips, 1):
        h1, h2 = TAGS.hooks(c["context_tag"])
        primary, cross = TAGS.platforms(c["context_tag"])
        lines += [
            f"### {i}. {fmt_time(c['start'])} — {c['context_tag']} ({c['duration']:.0f}s)",
            "",
            f"**Hook:** {library.hook_for(c, h1)}",
            f"**Alt:** {library.alt_for(c, h2)}",
            f"**Post to:** {primary} · cross-post {cross}",
            f"**Hashtags:** {TAGS.hashtags(c['context_tag'])}",
        ]
        if (c.get("copy") or {}).get("caption"):
            lines.append(f"**Caption:** {c['copy']['caption']}")
        if c.get("excerpt"):
            lines.append(f"> {c['excerpt']}")
        lines.append("")

    lines += ["## Posting cadence", "",
              "| Day | Time (ET) | VOD time | Tag | Platform |",
              "|-----|-----------|----------|-----|----------|"]
    for day, slot, c in build_cadence(clips):
        primary, _ = TAGS.platforms(c["context_tag"])
        lines.append(f"| {day} | {slot} | {fmt_time(c['start'])} | {c['context_tag']} | {primary} |")

    if reframed:
        lines += ["", f"*{reframed} clip(s) use the single-pane layout: the scene was "
                      "camera-dominant, so a split would have been camera in both panes.*"]
    lines.append("")
    return "\n".join(lines)


def rollup_doc(data):
    all_clips = library.clips(data)
    by_date = {}
    for c in all_clips:
        by_date.setdefault(c["date"], []).append(c)
    by_status = {}
    for c in all_clips:
        by_status[c.get("status", "new")] = by_status.get(c.get("status", "new"), 0) + 1
    total = sum(c["duration"] for c in all_clips)

    lines = [
        "# Yanchan Clip Library",
        "",
        f"**{len(all_clips)} clips** from **{len(by_date)} streams** · "
        f"{total/60:.0f} min of finished vertical video",
        "",
        "  ".join(f"{STATUS_ICON.get(k, '•')} {v} {k}" for k, v in sorted(by_status.items())),
        "",
        "Store of record is `clips/library.json`. Per-stream batches with full post copy",
        "live in `clips/<date>/strategy.md`. This page is the index across all of them.",
        "",
        "## Streams",
        "",
        "| Stream | Clips | Runtime | Tags | Batch doc |",
        "|--------|-------|---------|------|-----------|",
    ]
    for date in sorted(by_date, reverse=True):
        cs = by_date[date]
        tagset = ", ".join(sorted({c["context_tag"] for c in cs}))
        lines.append(f"| {date} | {len(cs)} | {sum(c['duration'] for c in cs)/60:.1f} min | "
                     f"{tagset} | `clips/{date}/strategy.md` |")

    lines += ["", "## Every clip", "",
              "| Stream | VOD time | Tag | Len | Music | Status | Hook |",
              "|--------|----------|-----|-----|-------|--------|------|"]
    for c in sorted(all_clips, key=lambda c: (c["date"], c["start"]), reverse=True):
        h1, _ = TAGS.hooks(c["context_tag"])
        icon = STATUS_ICON.get(c.get("status", "new"), "•")
        lines.append(
            f"| {c['date']} | {fmt_time(c['start'])} | {c['context_tag']} | {c['duration']:.0f}s | "
            f"{c.get('score', 0):.1f} | {icon} {c.get('status', 'new')} | "
            f"{library.hook_for(c, h1)} |")

    lines += ["", "## Browsing", "",
              "- `clips/by-context/<tag>/` — every clip from every stream, grouped by tag.",
              "- `clips/<date>/` — the finished MP4s for one stream.", ""]
    return "\n".join(lines)


def refresh_docs(data: dict, date: str, source_name: str = None) -> int:
    """Rewrite the strategy docs from the library as it stands right now.

    These docs used to be written only by a full pipeline run, which made them
    stale the moment anyone edited a hook, retagged a clip or approved something
    in the dashboard -- and no button anywhere rebuilt them. They were shipped as
    truth while being a snapshot of whenever compose.py last ran.

    Pulled out of main() so `build_export_pack.py` can call it: the export pack is
    the moment the docs have to be right, because that is when a person reads them
    and posts from them. Deliberately does NOT touch the library -- it only reads.
    """
    if source_name is None:
        clips = library.clips(data, date=date)
        source_name = next((c.get("source") for c in clips if c.get("source")), "") or ""
    CLIPS_DIR.mkdir(parents=True, exist_ok=True)
    (CLIPS_DIR / date).mkdir(parents=True, exist_ok=True)
    (CLIPS_DIR / date / "strategy.md").write_text(
        stream_doc(date, source_name, library.clips(data, date=date)))
    (CLIPS_DIR / "strategy.md").write_text(rollup_doc(data))
    return rebuild_by_context(data)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--rendered", type=Path, default=DEFAULT_RENDERED)
    parser.add_argument("--candidates", type=Path, default=WORK / "candidates.json")
    parser.add_argument("--transcript", type=Path, default=None,
                        help="defaults to whichever transcript is in the work dir")
    parser.add_argument("--date", default=DEFAULT_STREAM_DATE)
    parser.add_argument("--source-name", default=DEFAULT_SOURCE_NAME)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    rendered = json.loads(args.rendered.read_text())
    if not rendered:
        print("No rendered clips to package")
        return

    extra = {}
    if args.candidates.exists():
        for c in json.loads(args.candidates.read_text()):
            extra[round(c["start"], 1)] = c

    # Stream length, so a review pack can show WHERE in the stream each clip sits.
    music_path = WORK / "music.json"
    stream_duration = None
    if music_path.exists():
        stream_duration = json.loads(music_path.read_text()).get("duration")

    tpath = args.transcript or resolve_transcript(WORK)
    transcript = json.loads(Path(tpath).read_text())["segments"] if tpath else []

    entries = []
    for r in rendered:
        cand = extra.get(round(r["start"], 1), {})
        entries.append({
            **r,
            "duration": r["end"] - r["start"],
            "excerpt": excerpt_for(transcript, r["start"], r["end"])
                       or cand.get("excerpt", ""),
            "bpm": cand.get("bpm"),
            "sung_fraction": cand.get("sung_fraction"),
            "reason": cand.get("reason", ""),
            # Which selector found this clip. Recorded at the source from
            # 2026-09-07 on; clips selected before that have no stamp, so it is
            # derived from the tag instead -- the partition is exact, since the
            # music selector only ever emits MUSIC_TAGS and analyze.py only ever
            # emits SPEECH_TAGS.
            "selector": cand.get("selector") or (
                "music" if r["context_tag"] in TAGS.MUSIC_TAGS else "speech"),
            "stream_duration": stream_duration,
        })

    # A tag emitted by a selector but unknown here used to fall through to generic
    # copy silently. It shipped twice. Now it is a startup failure.
    TAGS.require_known(e["context_tag"] for e in entries)

    data = library.load()
    library.merge_stream(data, args.date, args.source_name, entries)
    # Where this stream's source and calibration live, so the editor can preview a
    # clip without rediscovering which work dir produced it.
    src_file = WORK / "source.txt"
    batch = dict(library.settings_for(data, args.date))
    # Relative, like prepare_stream.py writes them. These were absolute, so every
    # pipeline run quietly re-introduced this machine's paths into the store of
    # record and undid the migration that removed them -- the same file would have
    # named /Users/gbase again the first time anyone ran clip.sh.
    batch.update({
        "work_dir": library.relative(WORK),
        "source": library.relative(src_file.read_text().strip()) if src_file.exists() else None,
        "calibration": library.relative(WORK / "calibration.json"),
        "stream_duration": stream_duration,
    })
    library.record_settings(data, args.date, batch)
    library.save(data)

    stream_clips = library.clips(data, date=args.date)
    linked = refresh_docs(data, args.date, args.source_name)

    total_clips = len(library.clips(data))
    if args.json:
        print(json.dumps({"stream_clips": len(stream_clips), "library_clips": total_clips,
                          "linked": linked, "library": str(library.LIBRARY)}))
        return
    print(f"Library: {total_clips} clips across "
          f"{len({c['date'] for c in library.clips(data)})} streams -> {library.LIBRARY}")
    print(f"Batch doc: {CLIPS_DIR / args.date / 'strategy.md'} ({len(stream_clips)} clips)")
    print(f"Roll-up:   {CLIPS_DIR / 'strategy.md'}  ({linked} by-context links)")


if __name__ == "__main__":
    main()
