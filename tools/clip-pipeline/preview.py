#!/usr/bin/env python3
"""Fast previews for the editor: one composed frame, or a throwaway draft clip.

Two tiers, because the approved render is far too slow to edit against. A finished
clip takes 25-40s at `-crf 18 -preset slow`; a creator nudging one edge three times
would wait two minutes. The format must not change, so instead:

  --still   one frame through the real composition, ~0.3s. This is what the
            preview pane and the framing screen show. Scrubbing and rect edits
            need to feel immediate, and a still is the only way to get there.
  --draft   the clip, reduced resolution, `-preset ultrafast`, no unsharp, ~1-2s.
            For checking motion and caption timing.

Draft output is written to `work/preview/` and is never added to the library or an
export pack -- it exists to be looked at and thrown away.

    preview.py --source VOD --start 4581 --end 4602 --still out.png
    preview.py --source VOD --start 4581 --end 4602 --draft out.mp4 --stream 2026-07-08
"""
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import imageio_ffmpeg

import compose as _c
import framing as _framing
import library
from layout import resolve_transcript

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent.parent
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

DRAFT_SCALE = 0.5          # half the approved canvas; enough to judge framing
DRAFT_CRF = "30"


def build_filter(mode, cam, daw):
    return _c.split_filter(cam, daw) if mode == "split" else _c.reframe_filter(cam)


def still(source, at, mode, cam, daw, out: Path, safe_areas=False):
    """One composed frame. No captions, no mark — the geometry is the question."""
    graph = build_filter(mode, cam, daw) + "[stacked]null[v]"
    if safe_areas:
        import safe_areas as sa
        z = sa.worst_case(_c.TARGET_W, _c.TARGET_H)
        graph = (build_filter(mode, cam, daw)
                 + f"[stacked]drawbox=x=0:y={z['bottom_from']}:w={_c.TARGET_W}:"
                   f"h={_c.TARGET_H - z['bottom_from']}:color=red@0.28:t=fill,"
                   f"drawbox=x={z['right_from']}:y=0:w={_c.TARGET_W - z['right_from']}:"
                   f"h={_c.TARGET_H}:color=red@0.28:t=fill[v]")
    cmd = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
           "-ss", f"{at:.3f}", "-i", str(source), "-frames:v", "1",
           "-filter_complex", graph, "-map", "[v]", str(out)]
    subprocess.run(cmd, check=True)
    return out


def draft(source, start, duration, mode, cam, daw, out: Path, transcript=None,
          stream=None):
    """The clip at draft quality. Marked as a draft by living under work/preview/."""
    w = _c.even(_c.TARGET_W * DRAFT_SCALE)
    h = _c.even(_c.TARGET_H * DRAFT_SCALE)
    graph = build_filter(mode, cam, daw)

    ass_path = None
    if transcript is not None:
        words = _c.words_for(transcript, start, start + duration)
        pages = _c.group_pages(words)
        if pages:
            ass = _c.build_ass(pages, duration, "", 3.4, set(), "",
                               _c.CAPTION_Y[mode], "")
            f = tempfile.NamedTemporaryFile("w", suffix=".ass", delete=False)
            f.write(ass)
            f.close()
            ass_path = Path(f.name)

    if ass_path:
        esc = str(ass_path).replace("\\", "\\\\").replace(":", r"\:").replace("'", r"\'")
        graph += f"[stacked]subtitles='{esc}':fontsdir={_c.FONTS_DIR},scale={w}:{h}[v]"
    else:
        graph += f"[stacked]scale={w}:{h}[v]"

    cmd = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
           "-ss", f"{start:.3f}", "-i", str(source), "-t", f"{duration:.3f}",
           "-filter_complex", graph, "-map", "[v]", "-map", "0:a:0",
           "-c:v", "libx264", "-crf", DRAFT_CRF, "-preset", "ultrafast",
           "-pix_fmt", "yuv420p", "-r", "30",
           "-c:a", "aac", "-b:a", "96k", "-ar", "48000",
           "-movflags", "+faststart", str(out)]
    try:
        subprocess.run(cmd, check=True)
    finally:
        if ass_path:
            ass_path.unlink(missing_ok=True)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", type=Path, required=True)
    ap.add_argument("--calibration", type=Path, required=True)
    ap.add_argument("--start", type=float, required=True)
    ap.add_argument("--end", type=float, required=True)
    ap.add_argument("--at", type=float, help="frame time for --still (default: 3s in)")
    ap.add_argument("--still", type=Path)
    ap.add_argument("--source-frame", type=Path,
                    help="the raw source frame, for dragging rects over")
    ap.add_argument("--draft", type=Path)
    ap.add_argument("--stream", help="stream date, for transcript corrections")
    ap.add_argument("--cam", help="x,y,w,h override")
    ap.add_argument("--daw", help="x,y,w,h override, or 'none' for single-pane")
    ap.add_argument("--safe-areas", action="store_true")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    cal = json.loads(args.calibration.read_text())
    clip = {"start": args.start, "end": args.end, "date": args.stream or ""}
    if args.cam:
        clip["framing"] = {
            "cam": [int(v) for v in args.cam.split(",")],
            "daw": None if (args.daw or "none") == "none"
                   else [int(v) for v in args.daw.split(",")],
        }

    if args.cam:
        # Fast path. Measuring costs seven seeks into a multi-hour file (~3s) and
        # the editor already knows the rects it is asking about — re-deriving them
        # is exactly what makes a preview feel slow.
        cam = tuple(int(v) for v in args.cam.split(","))
        daw = None if (args.daw or "none") == "none" else tuple(
            int(v) for v in args.daw.split(","))
        mode = "split" if daw else "reframe"
        ok, why = _framing.validate(cam, daw, cal["frame"]["width"], cal["frame"]["height"])
        if not ok:
            print(json.dumps({"error": why}))
            return 1
        origin, warns = "supplied", []
    else:
        mode, cam, daw, origin, warns = _framing.resolve(args.source, clip, cal)
    for w in warns:
        print(f"note: {w}", file=sys.stderr)

    result = {"mode": mode, "cam": list(cam), "daw": list(daw) if daw else None,
              "origin": origin, "warnings": warns}

    if args.source_frame:
        # The uncomposed frame: framing is a spatial decision, so it has to be made
        # against what the camera actually saw, not a pair of number boxes.
        at = args.at if args.at is not None else args.start + min(3.0, (args.end - args.start) / 3)
        args.source_frame.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
                        "-ss", f"{at:.3f}", "-i", str(args.source), "-frames:v", "1",
                        str(args.source_frame)], check=True)
        result["source_frame"] = str(args.source_frame)
        result["frame"] = {"width": cal["frame"]["width"], "height": cal["frame"]["height"]}
        result["arrangement_left"] = cal.get("arrangement_left")

    if args.still:
        at = args.at if args.at is not None else args.start + min(3.0, (args.end - args.start) / 3)
        args.still.parent.mkdir(parents=True, exist_ok=True)
        still(args.source, at, mode, cam, daw, args.still, args.safe_areas)
        result["still"] = str(args.still)
        # What the geometry actually costs, for the framing screen's readouts.
        if daw:
            result["magnification"] = round(_c.TARGET_W / daw[2], 2)
            result["pane_aspect"] = round(daw[2] / daw[3], 2)
            result["browser_px"] = max(0, cal["arrangement_left"] - daw[0])

    if args.draft:
        transcript = None
        tp = resolve_transcript(args.calibration.parent)
        if tp:
            transcript = json.loads(Path(tp).read_text())["segments"]
            if args.stream:
                import transcripts as _tr
                transcript = _tr.apply_edits(transcript, _tr.load_edits(args.stream)["edits"])
        args.draft.parent.mkdir(parents=True, exist_ok=True)
        draft(args.source, args.start, args.end - args.start, mode, cam, daw,
              args.draft, transcript, args.stream)
        result["draft"] = str(args.draft)

    print(json.dumps(result) if args.json else json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
