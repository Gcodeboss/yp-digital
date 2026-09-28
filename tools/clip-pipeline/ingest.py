#!/usr/bin/env python3
"""Capture Kick streams before Kick deletes them.

    ingest.py --import-scan kick_scan.json    fold a channel scan into the archive
    ingest.py --status                        what is safe, what is on a clock
    ingest.py --backfill [--limit N]          download at-risk streams, most urgent first
    ingest.py --verify                        re-check every archived file

Why the scan is a separate file: kick.com's API sits behind Cloudflare and refuses
a plain CLI request (403, "Request blocked by security policy"). The channel's own
browser session gets through, so the scan is taken there and handed to this tool.
The DOWNLOAD does not have that problem -- each VOD record carries an HLS URL on
stream.kick.com, which serves the CLI directly, 720p30 included.

Downloads are verified before they count. `+faststart`-style truncation is not the
risk here, but a killed transfer leaving a large, plausible, undecodable file very
much is -- that exact failure wasted a clip batch on 2026-08-17. A stream is only
marked archived once its container reads back with the duration Kick advertised.
"""
import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import imageio_ffmpeg

import archive

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent.parent
STREAMS_DIR = PROJECT_ROOT / "streams"
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
YTDLP = ROOT / ".venv" / "bin" / "yt-dlp"

# Pinned on purpose: every calibrated layout coordinate downstream is in source
# pixels, so an unannounced jump to 1080p would silently invalidate all of them.
# Not every stream carries a format literally named "720p" though -- three of the
# first seven did not, and a hard-coded id failed them outright. Try the exact id,
# then the best thing at or under 720p, then whatever exists, and record what
# actually arrived.
FORMAT_CHAIN = ["720p", "best[height<=720]", "best"]

# A live VOD's advertised duration counts the whole session, including reconnects
# and gaps the recording does not contain, so the media is routinely a little
# shorter. Anything above this fraction is a complete capture.
MIN_DURATION_FRACTION = 0.90


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def probe(path: Path):
    """(duration_seconds, "WxH", fps) read back from the file itself.

    fps is here because it changed under us and nothing noticed. The download
    format is pinned `bestvideo[height<=720][fps<=30]` precisely so a source
    change cannot invalidate calibrated pixel coordinates -- but that selector
    ends in `/best`, which drops both constraints, and on 2026-08-09, 08-25 and
    08-31 it did: those captures are 720p**60** while every stream before them
    is 720p30. The resolution held, so nothing complained.

    Output is pinned to `-r 30` in compose.py, so a 60 fps source composes
    correctly today. Recording it is what makes the next change visible rather
    than silent.
    """
    out = subprocess.run([FFMPEG, "-hide_banner", "-i", str(path)],
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         text=True).stdout
    dur = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", out)
    res = re.search(r"Video:.*?, (\d{2,5})x(\d{2,5})", out)
    rate = re.search(r"(\d+(?:\.\d+)?) fps", out)
    seconds = (int(dur.group(1)) * 3600 + int(dur.group(2)) * 60
               + float(dur.group(3))) if dur else None
    return (seconds, (f"{res.group(1)}x{res.group(2)}" if res else None),
            float(rate.group(1)) if rate else None)


def slugify(title: str, stream_date: str, uuid: str = "") -> str:
    """Unique per VOD, not per day. Two streams went out on 2026-08-12 under the
    same title; without the uuid they collide and the shorter one overwrites the
    longer one on disk."""
    s = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:44]
    return f"{stream_date[:10]}_{s or 'stream'}_{uuid[:8]}" if uuid \
        else f"{stream_date[:10]}_{s or 'stream'}"


def download(rec: dict, dest: Path) -> tuple:
    """Pull one VOD at the pinned format. Returns (ok, method, message)."""
    hls = rec.get("source_hls")
    if not hls:
        return False, None, "no HLS source on the record"
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(".part.mp4")
    last = ""
    for fmt in FORMAT_CHAIN:
        cmd = [str(YTDLP), "--no-warnings", "--no-progress", "-f", fmt,
               "-o", str(part), hls]
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                              text=True)
        if proc.returncode == 0:
            part.replace(dest)
            return True, f"yt-dlp/hls:{fmt}", "ok"
        last = "\n".join(proc.stdout.strip().splitlines()[-2:])
        part.unlink(missing_ok=True)
        if "Requested format is not available" not in proc.stdout:
            break            # a real failure, not a missing rung on the ladder
    return False, None, f"yt-dlp failed on every format: {last}"


def implied_bitrate(path: Path, seconds: float) -> float:
    """Mbps the container's own duration implies. A wildly high number means the
    header is lying, not that the stream is dense."""
    if not seconds:
        return 0.0
    return (path.stat().st_size * 8) / seconds / 1e6


def repair_timestamps(path: Path) -> float:
    """Rebuild presentation timestamps, returning the corrected duration.

    Some Kick VODs come off the CDN with non-monotonic DTS -- a live stream that
    reconnected mid-session. ffmpeg then reports a duration from the first PTS
    reset, so a complete 20-minute capture reads back as 72 seconds and looks 94%
    lost. The media is all there; only the timing index is wrong. Remuxing with
    generated timestamps fixes it without re-encoding, and matters beyond
    verification: every later stage seeks into this file by time.
    """
    fixed = path.with_suffix(".fixed.mp4")
    proc = subprocess.run(
        [FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-fflags", "+genpts",
         "-i", str(path), "-c", "copy", "-movflags", "+faststart", str(fixed)],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if proc.returncode != 0 or not fixed.exists():
        fixed.unlink(missing_ok=True)
        return 0.0
    seconds, _, _ = probe(fixed)
    if not seconds:
        fixed.unlink(missing_ok=True)
        return 0.0
    fixed.replace(path)
    return seconds


def verify(rec: dict, path: Path) -> tuple:
    """(ok, seconds, resolution, why, fps). `ok` False means do not trust the file.

    Deliberately forgiving about length, and it never deletes. The first run threw
    away a 98.6% capture of a 3.19h stream because the media was 160s shorter than
    Kick's advertised duration -- for a VOD Kick is about to delete, an almost
    complete capture is enormously better than none. Only an unreadable or
    obviously truncated file is refused; a short one is kept and flagged.
    """
    if not path.exists():
        return False, None, None, "file missing", None
    seconds, resolution, fps = probe(path)
    if seconds is None:
        return False, None, None, "unreadable container", None
    expected = rec.get("duration_s") or 0
    if expected and seconds < expected * MIN_DURATION_FRACTION:
        # Before believing a file is short, check whether the header is lying:
        # 34 Mbps implied for a 3.3 Mbps stream means broken timestamps, not a
        # truncated download.
        if implied_bitrate(path, seconds) > 12.0:
            repaired = repair_timestamps(path)
            if repaired:
                seconds = repaired
                if seconds >= expected * MIN_DURATION_FRACTION:
                    return (True, seconds, resolution,
                            "timestamps were broken and have been rebuilt", fps)
        return (False, seconds, resolution,
                f"only {seconds/expected:.0%} of the advertised "
                f"{expected/3600:.2f}h was captured", fps)
    if expected and seconds < expected - 5:
        return (True, seconds, resolution,
                f"short by {expected - seconds:.0f}s of Kick's {expected:.0f}s "
                f"(live VODs advertise gaps the media does not contain)", fps)
    return True, seconds, resolution, "ok", fps


def cmd_import_scan(args):
    scanned = json.loads(Path(args.import_scan).read_text())
    for v in scanned:
        # The browser scan uses the API's own field names; normalise to ours.
        v["stream_date"] = v.get("start", v.get("stream_date", ""))[:10]
        v["duration_s"] = (v.get("dur_ms") or 0) / 1000.0
        v.setdefault("source_hls", v.get("hls"))
    missing = [v["stream_date"] for v in scanned if not v.get("source_hls")]
    if missing:
        print(f"WARNING: no HLS source on {len(missing)} record(s): "
              f"{', '.join(missing)}", file=sys.stderr)
    data = archive.load()
    archive.merge_scan(data, scanned, now())
    archive.save(data)
    lost = archive.unrecoverable(data)
    print(f"Scan folded in: {len(scanned)} stream(s) on Kick "
          f"-> {archive.ARCHIVE}")
    if lost:
        print(f"  {len(lost)} previously-seen stream(s) are now UNRECOVERABLE:")
        for r in lost:
            print(f"    {r.get('stream_date')}  {r.get('title')}")


def cmd_status(args):
    data = archive.load()
    safe, risk, lost = archive.archived(data), archive.at_risk(data), archive.unrecoverable(data)
    state = archive.scan_state(data)
    # THIS is the line that printed `AT RISK 0` on 2026-09-06 from a scan
    # nineteen days old, while three streams sat uncaptured on Kick and two of
    # them were a fortnight from deletion. The dashboard and doctor.py were
    # taught the rule; this, the surface that actually said it, was not. When the
    # scan is too old the count is unknown, and this prints that instead.
    print(state["message"])
    print()
    print(f"ARCHIVED  {len(safe)}")
    for r in safe:
        gb = (r.get("bytes") or 0) / 1e9
        print(f"  {r.get('stream_date')}  {(r.get('measured_duration_s') or 0)/3600:4.2f}h "
              f"{gb:5.2f}GB  {r.get('title', '')[:44]}")
    if state["state"] == "stale":
        print(f"\nAT RISK ON KICK  unknown — the scan is too old to say")
        print("  Run scan_kick.py, or ./capture.sh, then look again.")
        risk = []
    else:
        print(f"\nAT RISK ON KICK  {len(risk)}")
    for r in risk:
        d = archive.days_left(r)
        flag = "!! " if d <= 7 else "   "
        print(f"{flag}{r['stream_date']}  {(r.get('duration_s') or 0)/3600:4.2f}h  "
              f"{d:>3}d left  {r.get('title', '')[:44]}")
    if lost:
        print(f"\nUNRECOVERABLE  {len(lost)}")
        for r in lost:
            print(f"  {r.get('stream_date')}  {r.get('title', '')[:44]}")
    if args.json:
        stale = state["state"] == "stale"
        print(json.dumps({"archived": len(safe),
                          # null, not 0 — a consumer must not be able to read an
                          # all-clear out of a scan that cannot support one.
                          "at_risk": None if stale else len(risk),
                          "unrecoverable": len(lost),
                          "scan": state,
                          "most_urgent_days": (None if stale or not risk
                                               else archive.days_left(risk[0]))}))


def cmd_backfill(args):
    data = archive.load()
    queue = archive.at_risk(data)
    if args.limit:
        queue = queue[:args.limit]
    if not queue:
        # Same rule: "everything Kick holds is archived" is a claim about Kick,
        # and it is only as current as the last scan.
        state = archive.scan_state(data)
        if state["state"] == "stale":
            print(f"Nothing queued. {state['message']}")
        else:
            print("Nothing at risk — everything Kick holds is archived.")
        return 0

    print(f"Backfilling {len(queue)} stream(s), most urgent first\n")
    failures = []
    for i, rec in enumerate(queue, 1):
        left = archive.days_left(rec)
        dest = STREAMS_DIR / f"{slugify(rec.get('title', ''), rec['stream_date'], rec['uuid'])}.mp4"
        print(f"[{i}/{len(queue)}] {rec['stream_date']}  {left}d left  "
              f"{rec.get('title', '')[:44]}")
        print(f"          -> {dest.name}")

        if dest.exists():
            ok, seconds, res, why, fps = verify(rec, dest)
            if ok:
                print(f"          already complete ({seconds/3600:.2f}h, {res}"
                      + (f"{fps:g}" if fps else "") + ")")
                archive.mark_archived(data, rec["uuid"], dest, dest.stat().st_size,
                                      res, seconds, "existing", now(), fps)
                archive.save(data)
                continue
            print(f"          on disk but incomplete ({why}) — re-downloading")

        ok, method, msg = download(rec, dest)
        if not ok:
            print(f"          FAILED: {msg}")
            failures.append(rec["stream_date"])
            continue

        ok, seconds, res, why, fps = verify(rec, dest)
        if not ok:
            # Kept, not deleted. If this is all we get of a stream Kick is about
            # to remove, it is still worth having; the record says so.
            print(f"          UNUSABLE: {why} — file kept at {dest.name}")
            failures.append(rec["stream_date"])
            continue
        if why != "ok":
            print(f"          note: {why}")

        if res and not res.endswith("x720"):
            print(f"          NOTE: got {res}, not the pinned 720p — "
                  f"re-calibrate before composing this stream")
        # The format pin ends in `/best`, which drops both the height and the fps
        # constraint. That is how 720p60 captures arrived unremarked from
        # 2026-08-09 onward. compose.py pins `-r 30` on output so they render
        # correctly; saying so out loud is what makes the next drift visible.
        if fps and fps > 31:
            print(f"          NOTE: {fps:g} fps, not the pinned 30 — the format "
                  f"selector fell through to /best. Output is still 30 fps.")
        archive.mark_archived(data, rec["uuid"], dest, dest.stat().st_size,
                              res, seconds, method, now(), fps)
        archive.save(data)
        print(f"          archived  {seconds/3600:.2f}h  {res}"
              + (f"{fps:g}" if fps else "")
              + f"  {dest.stat().st_size/1e9:.2f}GB")

    print(f"\nBackfill done. {len(queue) - len(failures)} archived, {len(failures)} failed.")
    if failures:
        print(f"Failed: {', '.join(failures)}", file=sys.stderr)
        return 1
    return 0


def cmd_verify(args):
    data = archive.load()
    bad = 0
    for rec in archive.archived(data):
        path = PROJECT_ROOT / rec["path"] if not Path(rec["path"]).is_absolute() else Path(rec["path"])
        ok, seconds, res, why, fps = verify(rec, path)
        rate = f"{fps:g}fps" if fps else "fps?"
        print(f"{'ok  ' if ok else 'FAIL'}  {rec.get('stream_date')}  {res or '?'} {rate}  "
              f"{path.name}  {why}")
        bad += 0 if ok else 1
    return 1 if bad else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--import-scan", metavar="FILE")
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--backfill", action="store_true")
    ap.add_argument("--verify", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    if args.import_scan:
        return cmd_import_scan(args) or 0
    if args.status:
        return cmd_status(args) or 0
    if args.backfill:
        return cmd_backfill(args)
    if args.verify:
        return cmd_verify(args)
    ap.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
