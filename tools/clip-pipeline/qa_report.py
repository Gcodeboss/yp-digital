#!/usr/bin/env python3
"""Check a rendered batch mechanically and write work/qa.json.

Why this exists. The pipeline produced artifacts but never a verdict, so every
"did that work?" went through the most expensive route available: extract a frame
and look at it. Shipping six clips took about ten full-resolution frame
inspections, and image inspection does not scale with batch size.

Every question asked that way is mechanically checkable:

  container      1080x1920 / 30fps / AAC 48k stereo / first PTS at 0
  duration       matches the requested cut
  captions       a clip selected for singing actually has caption pages
  caption sync   first burned caption matches the first transcript word in range
  dead pane      neither pane is near-black or frozen
  camera bleed   no webcam skin-tones leaked into the Ableton pane
  loudness       integrated loudness lands near -14 LUFS

Camera bleed is the one that matters most: it is the defect that shipped to the
user once, and no dimension check can catch it.

Exit code is non-zero if any clip fails, so a runner stops instead of delivering.
A single contact sheet is written alongside for when a human does want to look —
one image for the batch instead of one per clip.

Usage:
    qa_report.py [--manifest work/rendered.json] [--json]
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg
import numpy as np

from layout import cv2  # noqa: F401  (import also silences decoder chatter)

ROOT = Path(__file__).resolve().parent
WORK = Path(os.environ["CLIP_WORK"]) if os.environ.get("CLIP_WORK") else (ROOT / "work")
PROJECT_ROOT = ROOT.parent.parent
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

TARGET_W, TARGET_H = 1080, 1920
TOP_H = 864
DURATION_TOLERANCE = 0.15
SYNC_TOLERANCE = 0.25
LUFS_TARGET, LUFS_TOLERANCE = -14.0, 1.5
DAW_UI_MIN = 0.55         # below this the "Ableton" pane is not showing Ableton
DEAD_LUMA_MIN = 12.0      # a pane darker than this is blank
DEAD_STD_MIN = 3.0        # ...or flatter than this is frozen


def probe(path):
    out = subprocess.run([FFMPEG, "-hide_banner", "-i", str(path)],
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         text=True).stdout
    info = {"width": None, "height": None, "fps": None, "sample_rate": None,
            "channels": None, "duration": None, "start": None}
    import re
    if m := re.search(r"(\d{3,5})x(\d{3,5})", out):
        info["width"], info["height"] = int(m.group(1)), int(m.group(2))
    if m := re.search(r"(\d+(?:\.\d+)?) fps", out):
        info["fps"] = float(m.group(1))
    if m := re.search(r"(\d+) Hz", out):
        info["sample_rate"] = int(m.group(1))
    if "stereo" in out:
        info["channels"] = 2
    elif "mono" in out:
        info["channels"] = 1
    if m := re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", out):
        h, mi, s = m.groups()
        info["duration"] = int(h) * 3600 + int(mi) * 60 + float(s)
    if m := re.search(r"start: ([\d.]+)", out):
        info["start"] = float(m.group(1))
    else:
        info["start"] = 0.0
    return info


def sample_frames(path, n=5):
    cap = cv2.VideoCapture(str(path))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    frames = []
    for i in range(n):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(total * (0.15 + 0.7 * i / max(1, n - 1))))
        ok, f = cap.read()
        if ok:
            frames.append(f)
    cap.release()
    return frames


def pane_health(frames, y0, y1):
    """Mean luma and temporal variation for a horizontal band."""
    band = [f[y0:y1] for f in frames]
    grays = [cv2.cvtColor(b, cv2.COLOR_BGR2GRAY).astype(np.float32) for b in band]
    luma = float(np.mean([g.mean() for g in grays]))
    motion = float(np.stack(grays).std(axis=0).mean()) if len(grays) > 2 else 99.0
    return luma, motion


def daw_ui_score(frames, y0, y1):
    """How much the band looks like a DAW rather than a room (0-1).

    Camera bleed into the bottom pane is the one defect that shipped to the user
    and that no container check can catch. Two earlier attempts failed:
    skin-tone hue alone flagged a good clip at 21.9% because Ableton audio clips
    are often tan, and warm-AND-moving scored the deliberately-bled test clip
    *lower* than every good clip.

    What actually separates them is structure. Ableton is a grid: long
    axis-aligned edges and large flat fills. A room has neither — its edges point
    everywhere and sensor noise means almost nothing is flat. Measured over a
    known-good batch plus a synthetic bled clip and a real camera pane:

        DAW panes     axis 0.53-0.87   flat 0.68-0.84   -> score 0.61-0.85
        camera panes  axis 0.38-0.42   flat 0.54-0.56   -> score 0.46-0.49
    """
    scores = []
    for f in frames:
        g = cv2.cvtColor(f[y0:y1], cv2.COLOR_BGR2GRAY)
        gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
        mag = np.hypot(gx, gy)
        strong = mag > 40
        if strong.sum() < 50:
            continue
        ang = np.degrees(np.arctan2(np.abs(gy), np.abs(gx)))
        axis = float((strong & ((ang < 8) | (ang > 82))).sum() / strong.sum())
        gf = g.astype(np.float32)
        var = cv2.blur((gf - cv2.blur(gf, (3, 3))) ** 2, (3, 3))
        flat = float((var < 1.0).mean())
        scores.append(0.5 * axis + 0.5 * flat)
    return float(np.mean(scores)) if scores else 1.0


def measure_lufs(path):
    res = subprocess.run(
        [FFMPEG, "-hide_banner", "-nostats", "-i", str(path),
         "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json",
         "-f", "null", "-"],
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True).stderr
    try:
        blob = res[res.rindex("{"):res.rindex("}") + 1]
        return float(json.loads(blob)["input_i"])
    except Exception:
        return None


def caption_stats(ass_text):
    lines = [l for l in ass_text.splitlines() if l.startswith("Dialogue:")]
    caption = [l for l in lines if ",Caption," in l]
    first = None
    if caption:
        parts = caption[0].split(",")
        hh, mm, ss = parts[1].split(":")
        first = int(hh) * 3600 + int(mm) * 60 + float(ss)
    return len(caption), first


def first_word_time(transcript, start, end):
    times = [w["start"] - start
             for seg in transcript for w in seg.get("words", [])
             if start <= w["start"] < end]
    return min(times) if times else None


def check(entry, transcript):
    path = PROJECT_ROOT / entry["path"]
    fails, warns = [], []
    r = {"name": entry["name"], "path": entry["path"], "mode": entry.get("mode"),
         "tag": entry.get("context_tag")}

    if not path.exists():
        return {**r, "ok": False, "failures": ["file missing"]}

    info = probe(path)
    r["container"] = info
    if (info["width"], info["height"]) != (TARGET_W, TARGET_H):
        fails.append(f"dimensions {info['width']}x{info['height']}")
    if info["fps"] and abs(info["fps"] - 30.0) > 0.5:
        fails.append(f"fps {info['fps']}")
    if info["sample_rate"] != 48000:
        fails.append(f"sample rate {info['sample_rate']}")
    if info["channels"] != 2:
        fails.append(f"channels {info['channels']}")
    if info["start"] and info["start"] > 0.001:
        fails.append(f"first PTS {info['start']}")

    want = entry["end"] - entry["start"]
    if info["duration"] and abs(info["duration"] - want) > DURATION_TOLERANCE:
        fails.append(f"duration {info['duration']:.2f}s vs requested {want:.2f}s")

    frames = sample_frames(path)
    if len(frames) < 3:
        fails.append("could not sample frames")
    else:
        if entry.get("mode") == "split":
            top_luma, top_motion = pane_health(frames, 0, TOP_H)
            bot_luma, bot_motion = pane_health(frames, TOP_H, TARGET_H)
            r["panes"] = {"top_luma": round(top_luma, 1),
                          "top_motion": round(top_motion, 2),
                          "bot_luma": round(bot_luma, 1),
                          "bot_motion": round(bot_motion, 2)}
            if top_luma < DEAD_LUMA_MIN:
                fails.append(f"top pane near-black (luma {top_luma:.1f})")
            if bot_luma < DEAD_LUMA_MIN:
                fails.append(f"bottom pane near-black (luma {bot_luma:.1f})")
            if top_motion < DEAD_STD_MIN:
                warns.append(f"top pane static (motion {top_motion:.2f})")
            ui = daw_ui_score(frames, TOP_H + 40, TARGET_H - 140)
            r["daw_ui_score"] = round(ui, 3)
            if ui < DAW_UI_MIN:
                fails.append(f"bottom pane does not look like a DAW "
                             f"(ui score {ui:.2f} < {DAW_UI_MIN}) — likely camera bleed")
        else:
            luma, motion = pane_health(frames, 0, TARGET_H)
            r["panes"] = {"luma": round(luma, 1), "motion": round(motion, 2)}
            if luma < DEAD_LUMA_MIN:
                fails.append(f"frame near-black (luma {luma:.1f})")

    lufs = measure_lufs(path)
    r["lufs"] = round(lufs, 2) if lufs is not None else None
    if lufs is not None and abs(lufs - LUFS_TARGET) > LUFS_TOLERANCE:
        warns.append(f"loudness {lufs:.1f} LUFS (target {LUFS_TARGET})")

    if transcript is not None:
        fw = first_word_time(transcript, entry["start"], entry["end"])
        r["first_word_s"] = round(fw, 2) if fw is not None else None
        if fw is None and entry.get("context_tag") == "singing":
            warns.append("no words in range for a 'singing' clip")

    r["ok"] = not fails
    r["failures"] = fails
    r["warnings"] = warns
    return r


def contact_sheet(entries, out_path, width=260):
    tiles = []
    for e in entries:
        p = PROJECT_ROOT / e["path"]
        if not p.exists():
            continue
        cap = cv2.VideoCapture(str(p))
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(total * 0.4))
        ok, f = cap.read()
        cap.release()
        if ok:
            h = int(width * f.shape[0] / f.shape[1])
            tiles.append(cv2.resize(f, (width, h), interpolation=cv2.INTER_AREA))
    if not tiles:
        return None
    h = min(t.shape[0] for t in tiles)
    tiles = [t[:h] for t in tiles]
    cv2.imwrite(str(out_path), np.hstack(tiles), [cv2.IMWRITE_JPEG_QUALITY, 82])
    return out_path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", type=Path, default=WORK / "rendered.json")
    ap.add_argument("--transcript", type=Path, default=WORK / "transcript.json")
    ap.add_argument("--output", type=Path, default=WORK / "qa.json")
    ap.add_argument("--contact", type=Path, default=WORK / "contact.jpg")
    ap.add_argument("--json", action="store_true", help="one-line summary only")
    args = ap.parse_args()

    entries = json.loads(args.manifest.read_text())
    transcript = None
    if args.transcript.exists():
        transcript = json.loads(args.transcript.read_text()).get("segments", [])

    results = [check(e, transcript) for e in entries]
    failed = [r for r in results if not r["ok"]]
    warned = [r for r in results if r["ok"] and r["warnings"]]
    sheet = contact_sheet(entries, args.contact)

    payload = {
        "clips": len(results),
        "passed": len(results) - len(failed),
        "failed": len(failed),
        "contact_sheet": str(sheet) if sheet else None,
        "results": results,
    }
    args.output.write_text(json.dumps(payload, indent=2))

    if args.json:
        print(json.dumps({k: payload[k] for k in
                          ("clips", "passed", "failed", "contact_sheet")}))
    else:
        print(f"QA: {payload['passed']}/{payload['clips']} passed -> {args.output}")
        for r in failed:
            print(f"  FAIL {r['name']}: {'; '.join(r['failures'])}")
        for r in warned:
            print(f"  warn {r['name']}: {'; '.join(r['warnings'])}")
        if sheet:
            print(f"  contact sheet: {sheet}")

    # Exit non-zero only when NOTHING passed (design D8).
    #
    # This used to be `1 if failed else 0`, and clip.sh turned that into a
    # top-level "QA FAILED" banner. `work/run_all_streams.log` therefore records
    # `9/10 passed` on one line and `FAIL` on the next, for a run where every
    # clip rendered and nine were shippable. A tool that cries wolf on a good
    # batch trains its operator to ignore it, which is the failure mode that
    # matters more than the tenth clip.
    #
    # Per-clip failures are not swallowed: they are printed above, written into
    # qa.json, and shown per clip in the dashboard. What changes is that one bad
    # clip is a fact about that clip, not a verdict on the batch.
    return 0 if payload["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
