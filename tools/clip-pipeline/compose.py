#!/usr/bin/env python3
"""Render finished 9:16 clips in a single ffmpeg pass, straight from the VOD.

Replaces export_clips.py + verticalize.py + burn_captions.py. One invocation per
clip does: seek -> crop -> scale -> stack -> burn captions -> loudness-normalise
-> encode.

Why one pass. The old flow cut with `-ss` before `-i` plus `-c copy`, so every
cut snapped to the previous keyframe: measured first-video-PTS was 0.20s on one
clip and 3.57s on another. verticalize.py then trimmed that lead off the audio to
restore A/V sync, which shifted the content start, while caption times were still
computed from the requested start — a different error on every clip. Re-encoding
the cut makes input seek frame-accurate, so `clip_time = vod_time - start` holds
exactly and captions need no correction at all. It also drops one of two lossy
generations.

Layout comes from work/calibration.json (see calibrate.py) — the webcam inset and
Ableton work area are stream constants, measured once.

Usage:
    compose.py --source <vod.mp4> [--only 011825] [--limit 3] [--hook "TEXT"]
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import timedelta
from pathlib import Path

import imageio_ffmpeg

import captions
import framing as _framing
import library
import safe_areas
from layout import clip_layout, resolve_transcript  # also silences decoder chatter
import layout as _layout

ROOT = Path(__file__).resolve().parent
WORK = Path(os.environ["CLIP_WORK"]) if os.environ.get("CLIP_WORK") else (ROOT / "work")
PROJECT_ROOT = ROOT.parent.parent
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

# Canvases. Portrait is the approved format and stays the default; landscape is a
# second canvas with its own geometry rather than a crop of the portrait render --
# the source is already 16:9, so it needs no split at all.
CANVASES = {
    "portrait": {"w": 1080, "h": 1920, "top_frac": 0.45, "split": True},
    "landscape": {"w": 1920, "h": 1080, "top_frac": 1.0, "split": False},
}
TARGET_W, TARGET_H = 1080, 1920
TOP_H = 864                     # approved 45% webcam pane
BOT_H = TARGET_H - TOP_H        # 1056, 55% Ableton pane
CROP_CAP = 0.22                 # never discard more than 22% of a source rect
SHARPEN = "unsharp=5:5:0.8:5:5:0.0"
PANE_BG = "0x0E0E0E"            # letterbox fill for UI panes
LOGO = ROOT / "assets" / "yanchan-logo-white.png"
LOGO_W = 300                    # rendered watermark width
LOGO_Y = 1737                   # logo top edge
HANDLE_Y = 1858                 # optional text mark, off by default
MARK_Y = 1792                   # optional extra text line (--mark), off by default

# The neon kick.com/yanchanproduced plate is the mark on every clip.
WATERMARK_IMG = ROOT / "assets" / "kick-watermark.png"
WATERMARK_W = 520               # 48% of frame width; the URL has to be readable
# Bottom edge of the plate, sitting where the logo used to (LOGO_Y 1737) and just
# clear of the loading bar. Gobbe's call on 2026-08-17, after seeing it parked at
# y=1500: "It should be placed at the bottom where the logo was, not so high up."
#
# The trade-off that 1500 was buying: every platform parks its own UI over the
# bottom of a 9:16 video -- Reels' caption block runs to about 350 px, TikTok's to
# 320 plus a 140 px right rail, Shorts' to 230. At 1890 the plate sits inside that
# band, so on a feed it can be partly covered by the caption overlay. It is never
# cropped off the frame itself. Move WATERMARK_BOTTOM to 1500 to clear the UI.
WATERMARK_BOTTOM = 1890
BAR_H = 14                      # loading-bar height
BAR_Y = TARGET_H - BAR_H        # flush with the bottom edge
REFRAME_CAM_Y = 430             # camera top edge in the single-pane layout
CAPTION_Y = {"split": 905, "reframe": 1235}   # caption band per layout

AMBER = r"\c&H0488F5&"          # Warm Amber #F58804 in ASS BGR order
WHITE = r"\c&HFFFFFF&"
FILLERS = {"um", "uh", "hmm", "mm"}
MAX_CHARS = 14

# Text fitting. Sizes mirror the Caption and Hook styles in ASS_HEADER. Both
# styles declare 40px MarginL/MarginR, which `\pos()` overrides, so any limit has
# to be applied by hand.
#
# The two limits differ, on purpose:
#
#   The hook has never been rendered — it was a per-clip field the compositor
#   never read — so it has no approved look to preserve, and task 6.3 asks for
#   the title to sit inside the safe area. It gets the widest centred box that
#   clears every platform's right-hand rail (798px on this canvas).
#
#   Captions were signed off as they are, and the renderer is explicitly not to
#   be redesigned. Holding them to the same 798px would rescale 322 of the 10,629
#   pages in the 2026-07-03 transcript — 3% of real content restyled to fix a
#   defect that does not occur. They keep the frame-edge limit, where the same
#   measurement returns 0 of 10,629. It is a backstop against a word longer than
#   the frame, not a new layout rule.
HOOK_SIZE = 60
HOOK_Y = 255
CAPTION_SIZE = 80
_SAFE = safe_areas.worst_case(TARGET_W, TARGET_H)
HOOK_MAX_W = 2 * (_SAFE["right_from"] - TARGET_W // 2)
CAPTION_MAX_W = TARGET_W - 80
FONTS_DIR = "/System/Library/Fonts/Supplemental"

ASS_HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Arial Black,80,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,-1,0,0,0,100,100,1,0,1,8,2,5,40,40,40,1
Style: Hook,Arial Black,60,&H00FFFFFF,&H00FFFFFF,&H00000000,&H50000000,-1,0,0,0,100,100,1,0,1,7,3,8,40,40,40,1
Style: Live,Arial Black,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,-1,0,0,0,100,100,3,0,1,3,0,5,40,40,40,1
Style: Mark,Arial Black,26,&H64FFFFFF,&H00FFFFFF,&H78000000,&H96000000,-1,0,0,0,100,100,2,0,1,2,0,5,40,40,40,1
Style: Bar,Arial Black,20,&H000488F5,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def even(n) -> int:
    return int(n) // 2 * 2


def ts(t: float) -> str:
    t = max(0.0, t)
    return f"{int(t // 3600)}:{int(t % 3600 // 60):02d}:{t % 60:05.2f}"


def fmt_hhmmss(seconds: float) -> str:
    td = timedelta(seconds=int(seconds))
    return f"{td.seconds // 3600:02d}{(td.seconds // 60) % 60:02d}{td.seconds % 60:02d}"


# --- geometry -------------------------------------------------------------

def pane_chain(rect, pane_w, pane_h, tag, sharpen=True, fill="blur", mirror=False):
    """ffmpeg chain cropping `rect` out of [0:v] and filling a pane.

    `mirror` horizontally flips this pane, for a camera Yanchan wants facing the
    other way. It is applied straight after the crop so the blurred letterbox
    fill is built from the already-mirrored content and cannot disagree with the
    foreground. Only ever passed for the camera: flipping a DAW pane turns
    Ableton's track names and browser into mirror writing.

    Cover-cropping is capped at CROP_CAP. Past the cap the content is fitted and
    the remainder filled with a blurred, darkened copy of itself. The old code
    always cover-cropped, which meant fitting a 1.65-aspect webcam into a 1.25
    pane by discarding 24% of its width — that is what cropped Yanchan out of
    frame entirely on half the clips.
    """
    x, y, w, h = rect
    src_a, pane_a = w / h, pane_w / pane_h

    if src_a > pane_a:                      # too wide: trim width, capped
        new_w = max(h * pane_a, w * (1 - CROP_CAP))
        new_h = h
    else:                                   # too tall: trim height, capped
        new_h = max(w / pane_a, h * (1 - CROP_CAP))
        new_w = w

    new_w, new_h = even(new_w), even(new_h)
    cx, cy = even(x + (w - new_w) / 2), even(y + (h - new_h) / 2)
    crop = f"crop={new_w}:{new_h}:{cx}:{cy}"
    if mirror:
        crop += ",hflip"
    sharp = f",{SHARPEN}" if sharpen else ""

    if abs(new_w / new_h - pane_a) < 0.01:  # cap not binding: exact fill
        return (f"[0:v]{crop},scale={pane_w}:{pane_h}:flags=lanczos"
                f"{sharp},setsar=1[{tag}];")

    # Letterbox. A blurred copy of the content reads naturally behind camera
    # footage, but behind a UI screenshot it looks like a rendering glitch —
    # so DAW panes get a flat dark card instead.
    if fill == "dark":
        return (
            f"[0:v]{crop},scale={pane_w}:{pane_h}:"
            f"force_original_aspect_ratio=decrease:flags=lanczos{sharp},"
            f"pad={pane_w}:{pane_h}:(ow-iw)/2:(oh-ih)/2:color={PANE_BG},"
            f"setsar=1[{tag}];"
        )

    return (
        f"[0:v]{crop},split=2[{tag}bg][{tag}fg];"
        f"[{tag}bg]scale={pane_w}:{pane_h}:force_original_aspect_ratio=increase,"
        f"crop={pane_w}:{pane_h},gblur=sigma=24,eq=brightness=-0.14,setsar=1[{tag}b];"
        f"[{tag}fg]scale={pane_w}:{pane_h}:force_original_aspect_ratio=decrease:"
        f"flags=lanczos{sharp},setsar=1[{tag}f];"
        f"[{tag}b][{tag}f]overlay=(W-w)/2:(H-h)/2,setsar=1[{tag}];"
    )


def split_filter(cam, daw, mirror=False):
    return (
        pane_chain(cam, TARGET_W, TOP_H, "top", mirror=mirror)
        # Never the DAW pane, whatever the setting: mirrored Ableton is unreadable.
        + pane_chain(daw, TARGET_W, BOT_H, "bot", fill="dark")
        + "[top][bot]vstack=2[stacked];"
    )


def reframe_filter(rect, mirror=False):
    """Scenes with no usable DAW pane — camera-dominant or full-camera.

    A 16:9 two-shot cannot be cover-cropped to 9:16 without cutting one of the
    two people out, so instead it is fitted full-width in the upper-middle over
    a blurred fill, leaving the lower third for the caption band. This is the
    standard podcast-clip layout and it keeps both people in frame.
    """
    rx, ry, fw, fh = rect
    cam_h = even(TARGET_W * fh / fw)
    # Single-pane is all camera, so the flip covers the frame. Anything filmed in
    # the room reverses with it -- signage, a T-shirt -- which is the trade the
    # creator is making when they turn it on.
    pre = f"[0:v]crop={fw}:{fh}:{rx}:{ry}," + ("hflip," if mirror else "")
    return (
        f"{pre}split=2[rbg][rfg];"
        f"[rbg]scale={TARGET_W}:{TARGET_H}:force_original_aspect_ratio=increase,"
        f"crop={TARGET_W}:{TARGET_H},gblur=sigma=28,eq=brightness=-0.16,setsar=1[rb];"
        f"[rfg]scale={TARGET_W}:{cam_h}:flags=lanczos,{SHARPEN},setsar=1[rf];"
        f"[rb][rf]overlay=0:{REFRAME_CAM_Y},setsar=1[stacked];"
    )


# --- captions -------------------------------------------------------------

def words_for(transcript, start, end):
    """Words inside the clip, shifted onto the clip's own timeline.

    Exact because the cut is frame-accurate (see module docstring).
    """
    out = []
    for seg in transcript:
        for w in seg.get("words", []):
            if start <= w["start"] < end:
                out.append({
                    "word": w["word"].strip(),
                    "start": w["start"] - start,
                    "end": min(w["end"], end) - start,
                })
    out.sort(key=lambda x: x["start"])
    return out


def group_pages(words):
    words = [w for w in words if re.sub(r"\W", "", w["word"]).lower() not in FILLERS
             and w["word"]]
    pages, cur = [], []
    for w in words:
        if cur:
            gap = w["start"] - cur[-1]["end"]
            chars = sum(len(x["word"]) for x in cur) + len(cur) + len(w["word"])
            if gap > 0.8 or chars > MAX_CHARS or cur[-1]["word"][-1] in ".?!,":
                pages.append(cur)
                cur = []
        cur.append(w)
    if cur:
        pages.append(cur)
    return pages


def build_ass(pages, duration, hook, hook_until, emph, watermark, caption_y, mark):
    ev = []
    for pi, page in enumerate(pages):
        page_start = page[0]["start"]
        next_start = pages[pi + 1][0]["start"] if pi + 1 < len(pages) else duration
        page_end = min(page[-1]["end"] + 0.6, next_start)

        # Backstop, not a rewrite. group_pages() breaks on a 14-character budget,
        # which held for every one of the 10,629 pages the 2026-07-03 transcript
        # produced. What it cannot break is a single word longer than the frame,
        # so measure the page and scale it down if one ever turns up.
        rendered = " ".join(x["word"].upper() for x in page)
        over = captions.too_wide(rendered, CAPTION_SIZE, CAPTION_MAX_W)
        pscale = CAPTION_MAX_W / (CAPTION_MAX_W + over) if over else 1.0
        if over:
            print(f"  caption: page scaled to {pscale:.0%} — {over}px too wide: "
                  f"{rendered!r}")
        # Every inline scale is relative to the page's, or the reset to 100 would
        # undo it on the word after the first emphasis.
        emph_pct, base_pct = round(108 * pscale), round(100 * pscale)
        pop_pct = round(82 * pscale)

        for wi, w in enumerate(page):
            t0 = w["start"] if wi else page_start
            t1 = page[wi + 1]["start"] if wi + 1 < len(page) else page_end
            if t1 <= t0:
                continue
            parts = []
            for wj, x in enumerate(page):
                txt = x["word"].upper()
                if wj == wi:
                    scale = (rf"\fscx{emph_pct}\fscy{emph_pct}"
                             if re.sub(r"\W", "", x["word"]).lower() in emph else "")
                    parts.append("{" + AMBER + scale + "}" + txt
                                 + rf"{{\fscx{base_pct}\fscy{base_pct}{WHITE}}}")
                else:
                    parts.append(txt)
            pop = (rf"\fscx{pop_pct}\fscy{pop_pct}"
                   rf"\t(0,90,\fscx{base_pct}\fscy{base_pct})") if wi == 0 else (
                rf"\fscx{base_pct}\fscy{base_pct}" if pscale != 1.0 else "")
            line = (r"{\an5\pos(540," + str(caption_y) + ")" + pop + "}"
                    + " ".join(parts))
            ev.append(f"Dialogue: 2,{ts(t0)},{ts(t1)},Caption,,0,0,0,,{line}")

    if hook:
        # Fit before styling. `WrapStyle: 2` plus `\pos()` means libass will not
        # wrap this for us and the style margins do not apply, so an unfitted
        # hook renders at full width centred on x=540 and runs off both edges --
        # 53 of the 68 hooks in the library did exactly that, the worst by 813px.
        lines, scale, why = captions.fit_lines(hook, HOOK_SIZE, HOOK_MAX_W)
        if why:
            print(f"  hook: {why}")
        # Fitting guarantees the hook is inside the canvas. Whether it is inside
        # what a platform leaves uncovered is a separate question, and per D6 the
        # answer is a warning rather than a move.
        box_h = round(len(lines) * HOOK_SIZE * 1.2 * scale)
        box_w = max((captions.text_width(ln, HOOK_SIZE, scale) for ln in lines),
                    default=0)
        for name, why_covered in safe_areas.check(
                ((TARGET_W - box_w) // 2, HOOK_Y, box_w, box_h), TARGET_W, TARGET_H):
            print(f"  note: the hook will be partly covered on {name} — {why_covered}")
        text = r"\N".join(lines).replace("{G}", "{" + AMBER + "}")
        start_pct, end_pct = round(78 * scale), round(100 * scale)
        line = (r"{\an8\pos(540," + str(HOOK_Y) + r")"
                rf"\fscx{start_pct}\fscy{start_pct}"
                rf"\t(0,110,\fscx{end_pct}\fscy{end_pct})"
                r"\fad(0,180)}" + text)
        ev.append(f"Dialogue: 3,{ts(0.10)},{ts(hook_until)},Hook,,0,0,0,,{line}")

    if mark:
        ev.append(f"Dialogue: 1,{ts(0)},{ts(duration)},Live,,0,0,0,,"
                  f"{{\\an5\\pos(540,{MARK_Y})}}{mark}")
    if watermark:
        # Drawn in the Live style, not the small translucent Mark style: with the
        # logo off this line is the only branding on the clip and it is a URL
        # someone has to be able to read on a phone.
        ev.append(f"Dialogue: 1,{ts(0)},{ts(duration)},Live,,0,0,0,,"
                  f"{{\\an5\\pos(540,{HANDLE_Y})}}{watermark}")
    track = (r"{\an7\pos(0," + str(BAR_Y) + r")\c&H2A2A2A&\alpha&H60&\bord0\shad0\p1}"
             r"m 0 0 l 1080 0 l 1080 " + str(BAR_H) + r" l 0 " + str(BAR_H) + r"{\p0}")
    ev.append(f"Dialogue: 0,{ts(0)},{ts(duration)},Bar,,0,0,0,,{track}")
    fill = (r"{\an7\pos(0," + str(BAR_Y) + r")\c&H0488F5&\bord0\shad0\p1\fscx0\fscy100"
            r"\t(0," + str(int(duration * 1000)) + r",\fscx100)}"
            r"m 0 0 l 1080 0 l 1080 " + str(BAR_H) + r" l 0 " + str(BAR_H) + r"{\p0}")
    ev.append(f"Dialogue: 1,{ts(0)},{ts(duration)},Bar,,0,0,0,,{fill}")
    return ASS_HEADER + "\n".join(ev) + "\n"




# --- render ---------------------------------------------------------------

def manifest_path_for(out_path: Path) -> str:
    """Path to record for a clip: repo-relative when it is in the repo.

    `Path.relative_to` raises rather than falling back, so an --output-dir
    outside the repo took the whole run down at the manifest step — after every
    clip had already been encoded. The paperwork must not be able to throw away
    finished work.

    Defers to `library.relative()`, which is the same rule applied to every other
    stored path and resolves first — so a *relative* --output-dir is normalised
    rather than stored verbatim as `../../clips/...`.
    """
    return library.relative(out_path)


def is_complete(path: Path, duration: float, tolerance=0.5) -> bool:
    """Is this file a finished clip, or the corpse of a killed encode?

    `-movflags +faststart` writes the moov atom last, so an interrupted render
    leaves a large, plausible-looking, undecodable file. `out_path.exists() and
    size > 100 KB` accepted one of those as a cached clip and skipped re-rendering
    it; QA then failed the batch on a file compose had just waved through.
    Reading the duration back costs about 50 ms and settles it.
    """
    out = subprocess.run([FFMPEG, "-hide_banner", "-i", str(path)],
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         text=True).stdout
    m = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", out)
    if not m:
        return False
    got = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    return abs(got - duration) <= tolerance


def render(source, start, duration, out_path, filt, ass_path,
           use_logo=False, watermark_img=None,
           watermark_w=WATERMARK_W, watermark_bottom=WATERMARK_BOTTOM):
    esc = str(ass_path).replace("\\", "\\\\").replace(":", r"\:").replace("'", r"\'")

    # Image overlays go on before the subtitles, so the caption band and the
    # loading bar sit above them in the stack. Each one is another ffmpeg input,
    # numbered in the order they are appended to the command below.
    overlays = []
    if watermark_img:
        overlays.append((watermark_img, watermark_w,
                         "(W-w)/2", f"{watermark_bottom}-h", 1.0))
    if use_logo and LOGO.exists():
        overlays.append((LOGO, LOGO_W, "(W-w)/2", str(LOGO_Y), 0.72))

    graph = filt
    stage = "stacked"
    for i, (path, width, ox, oy, opacity) in enumerate(overlays, start=1):
        alpha = f",colorchannelmixer=aa={opacity}" if opacity < 1.0 else ""
        out = f"ov{i}"
        graph += (f"[{i}:v]scale={width}:-1,format=rgba{alpha}[img{i}];"
                  f"[{stage}][img{i}]overlay={ox}:{oy}:format=auto[{out}];")
        stage = out
    graph += f"[{stage}]subtitles='{esc}':fontsdir={FONTS_DIR}[v]"

    cmd = [
        FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
        # audio.wav and the video share one timeline: verified by envelope
        # cross-correlation at t=1200s and t=8000s (offset 0.00s, corr 0.63/0.66),
        # so the container's reported non-zero start_time needs no correction.
        "-ss", f"{start:.3f}", "-i", str(source),
    ]
    for path, *_ in overlays:
        cmd += ["-loop", "1", "-i", str(path)]
    cmd += [
        # -t MUST stay after every input. Placed between them it is parsed as an
        # input option for the input that follows, which once bounded the logo
        # instead of the video and encoded to the end of the VOD (213 MB clip).
        # Every overlay adds an input, so this line stays below that loop.
        "-t", f"{duration:.3f}",
        "-filter_complex", graph,
        "-map", "[v]", "-map", "0:a:0",
        "-af", "loudnorm=I=-14:TP=-1.5:LRA=11",
        "-c:v", "libx264", "-crf", "18", "-preset", "slow",
        "-pix_fmt", "yuv420p", "-r", "30",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-movflags", "+faststart",
        str(out_path),
    ]
    subprocess.run(cmd, check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", type=Path, required=True)
    ap.add_argument("--calibration", type=Path, default=WORK / "calibration.json")
    ap.add_argument("--candidates", type=Path, default=WORK / "candidates.json")
    ap.add_argument("--transcript", type=Path, default=None)
    ap.add_argument("--output-dir", type=Path, default=PROJECT_ROOT / "clips" / "vertical")
    ap.add_argument("--fullcam-mode", choices=["skip", "reframe"], default="reframe",
                    help="what to do with scenes that have no usable DAW pane "
                         "(default: reframe to a single-pane podcast layout)")
    ap.add_argument("--only", default="", help="comma-separated substrings to match on the clip name")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--hook", default="", help="hook banner text; {G} switches to green")
    ap.add_argument("--emph", nargs="*", default=[])
    ap.add_argument("--watermark", default="",
                    help="optional TEXT mark under the plate; empty by default")
    ap.add_argument("--watermark-image", type=Path, default=WATERMARK_IMG,
                    help="the neon kick.com plate; pass '' to drop it")
    ap.add_argument("--watermark-width", type=int, default=WATERMARK_W)
    ap.add_argument("--watermark-bottom", type=int, default=WATERMARK_BOTTOM,
                    help="y of the plate's bottom edge (1890 = where the logo sat; "
                         "1500 clears every platform's UI overlay)")
    ap.add_argument("--logo", action="store_true",
                    help="also overlay the Yanchan Produced logo above the mark "
                         "(off by default; the mark alone is the current look)")
    ap.add_argument("--mark", default="",
                    help="optional second mark line above the handle "
                         "(e.g. 'LIVE ON KICK'); empty = omitted")
    ap.add_argument("--mirror", action="store_true",
                    help="horizontally flip the camera — for a webcam facing the "
                         "wrong way. Never flips the DAW pane; mirrored Ableton "
                         "is unreadable. Per-clip and per-stream settings win "
                         "over this flag only when they are set.")
    ap.add_argument("--stream", default=None,
                    help="stream date, so transcript corrections are applied")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--json", action="store_true", help="one-line summary only")
    args = ap.parse_args()

    cal = json.loads(args.calibration.read_text())
    if cal.get("source") != str(args.source):
        raise SystemExit(
            f"Calibration was built from a different source:\n"
            f"  calibration: {cal.get('source')}\n  requested:   {args.source}\n"
            f"Re-run calibrate.py --source <this vod> --force."
        )

    # Task 1.7: the calibration is a set of pixel coordinates. If the source
    # frame size changed, every one of them is wrong.
    probe = _layout.cv2.VideoCapture(str(args.source))
    fw = int(probe.get(_layout.cv2.CAP_PROP_FRAME_WIDTH))
    fh = int(probe.get(_layout.cv2.CAP_PROP_FRAME_HEIGHT))
    probe.release()
    if (fw, fh) != (cal["frame"]["width"], cal["frame"]["height"]):
        raise SystemExit(
            f"Source is {fw}x{fh} but calibration was measured on "
            f"{cal['frame']['width']}x{cal['frame']['height']}. Re-calibrate."
        )

    candidates = json.loads(args.candidates.read_text())
    # Creator edits (moved ranges, corrected tags, hand-set framing) live in the
    # library, not in candidates.json. Overlay them before anything is rendered,
    # so "fix it and re-render" actually renders the fix.
    lib = library.load()
    locks = _framing.load_locks()
    by_start = {round(c.get("start", -1), 1): c for c in library.clips(lib)}
    for cand in candidates:
        edited = by_start.get(round(cand["start"], 1))
        if edited:
            for field in ("start", "end", "context_tag"):
                if (edited.get("creator") or {}).get(field) is not None:
                    cand[field] = edited[field]
            if (edited.get("creator") or {}).get("framing"):
                cand["framing"] = edited["framing"]
            cand["date"] = edited.get("date", "")
            # The hook is a per-clip field in the library and a flag here, and
            # nothing joined the two: `--hook` defaulted to "" and no caller ever
            # set it, so the hook a creator wrote reached the export pack's copy
            # and never the burned-in frame. Per-clip wins; --hook stays as the
            # override for a one-off render.
            cand["hook"] = library.hook_for(edited, "")
            if (edited.get("creator") or {}).get("mirror") is not None:
                cand["mirror"] = edited["creator"]["mirror"]
    tpath = args.transcript or resolve_transcript(WORK)
    if tpath is None:
        raise SystemExit(f"No transcript in {WORK}. Run transcribe.py or "
                         "transcribe_windows.py first.")
    transcript = json.loads(Path(tpath).read_text())["segments"]
    # A correction the creator typed must reach the burned captions, otherwise the
    # fix only looks applied. Corrections live per stream, keyed on segment start.
    if args.stream:
        import transcripts as _tr
        edits = _tr.load_edits(args.stream)["edits"]
        if edits:
            transcript = _tr.apply_edits(transcript, edits)
            print(f"applied {len(edits)} transcript correction(s)")
    args.output_dir.mkdir(parents=True, exist_ok=True)

    emph = {w.lower() for w in args.emph}

    # Mirror resolves per clip, then per stream, then off. A webcam is mirrored
    # for a whole session far more often than for one clip, so the stream default
    # is the one that gets used; the per-clip field is the exception.
    stream_mirror = bool((library.settings_for(lib, args.stream or "") or {})
                         .get("mirror", False)) if args.stream else False
    if stream_mirror:
        print("mirror: on for this stream (camera pane only)")

    # The mark sits where Gobbe put it. Warn once per run about which platforms
    # will cover it, rather than moving it or staying quiet.
    if args.watermark_image:
        from PIL import Image as _Img
        try:
            _w, _h = _Img.open(args.watermark_image).size
            mw = args.watermark_width
            mh = round(mw * _h / _w)
            box = ((TARGET_W - mw) // 2, args.watermark_bottom - mh, mw, mh)
            for name, why in safe_areas.check(box, TARGET_W, TARGET_H):
                print(f"note: the mark will be partly covered on {name} — {why}")
        except Exception:
            pass
    wm_img = args.watermark_image if (args.watermark_image
                                      and Path(args.watermark_image).exists()) else None
    if args.watermark_image and not wm_img:
        raise SystemExit(f"Watermark image not found: {args.watermark_image}")

    produced, skipped, failed = [], [], []
    rendered_now = 0
    manifest_path = WORK / "rendered.json"
    prior_modes = {}
    if manifest_path.exists():
        prior_modes = {e["name"]: e.get("mode")
                       for e in json.loads(manifest_path.read_text())}
    for cand in candidates:
        name = f"{fmt_hhmmss(cand['start'])}_{cand['context_tag']}"
        if args.only and not any(t.strip() and t.strip() in name
                                 for t in args.only.split(",")):
            continue
        if args.limit and rendered_now >= args.limit:
            break

        out_path = args.output_dir / f"{name}.mp4"
        if (out_path.exists() and out_path.stat().st_size > 100_000 and not args.force
                and is_complete(out_path, cand["end"] - cand["start"])):
            # Record the REAL layout, not "existing". qa_report.py keys its
            # per-pane and camera-bleed checks off this field, so a cached clip
            # labelled "existing" silently skipped the bleed check — the exact
            # defect this pipeline exists to catch.
            prior = prior_modes.get(name)
            if prior in ("split", "reframe"):
                mode = prior
            else:
                mode, _, _ = clip_layout(args.source, cand["start"],
                                         cand["end"] - cand["start"], cal)
            print(f"skip (exists) {out_path.name} [{mode}]")
            produced.append({"name": name, "path": manifest_path_for(out_path),
                             "mode": mode, **{k: cand[k] for k in
                                              ("start", "end", "context_tag", "score")}})
            continue

        if out_path.exists() and not args.force:
            print(f"re-rendering {out_path.name}: on disk but incomplete")

        start, duration = cand["start"], cand["end"] - cand["start"]
        mode, cam, daw, origin, warns = _framing.resolve(args.source, cand, cal, locks)
        for w in warns:
            print(f"  note: {name}: {w}")
        if mode == "reframe" and args.fullcam_mode == "skip":
            skipped.append(name)
            print(f"[no-split] {name} -> SKIP (no usable DAW pane in this scene)")
            continue

        words = words_for(transcript, cand["start"], cand["end"])
        pages = group_pages(words)
        if not pages:
            print(f"  note: {name} has no words in range — rendering without captions")
        ass = build_ass(pages, duration, args.hook or cand.get("hook", ""), 3.4,
                        emph, args.watermark, CAPTION_Y[mode], args.mark)
        with tempfile.NamedTemporaryFile("w", suffix=".ass", delete=False,
                                         dir=args.output_dir) as f:
            f.write(ass)
            ass_path = Path(f.name)
        try:
            geom = f" cam={cam}" + (f" daw={daw}" if mode == "split" else "")
            tag = "" if origin == "measured" else f" [{origin}]"
            print(f"[{mode}]{tag} {name} ({duration:.1f}s, {len(pages)} caption pages){geom}")
            mirror = bool(cand.get("mirror", args.mirror or stream_mirror))
            render(args.source, start, duration, out_path,
                   split_filter(cam, daw, mirror) if mode == "split"
                   else reframe_filter(cam, mirror),
                   ass_path, use_logo=args.logo, watermark_img=wm_img,
                   watermark_w=args.watermark_width,
                   watermark_bottom=args.watermark_bottom)
        except subprocess.CalledProcessError as exc:
            # One bad encode must not cost the batch. This aborted mid-run once
            # (ffmpeg took a SIGKILL on a blur-heavy reframe) and the exception
            # propagated before the manifest was written, so seven finished clips
            # were dropped from the paperwork and QA then reported them missing.
            failed.append(name)
            out_path.unlink(missing_ok=True)
            print(f"  FAILED {name}: ffmpeg exited {exc.returncode}; continuing")
            continue
        finally:
            ass_path.unlink(missing_ok=True)

        rendered_now += 1
        produced.append({"name": name, "path": manifest_path_for(out_path),
                         "mode": mode, "framing_origin": origin,
                         # The rects the render actually used. Recorded so the editor
                         # can compose a live 9:16 preview without re-measuring.
                         "cam": list(cam), "daw": list(daw) if daw else None,
                         **{k: cand[k] for k in
                            ("start", "end", "context_tag", "score")}})

    # Merge rather than overwrite: a --only run used to leave a manifest holding
    # just those clips, and build_strategy.py then documented only those.
    manifest = manifest_path
    merged = {}
    if manifest.exists():
        for e in json.loads(manifest.read_text()):
            if (PROJECT_ROOT / e["path"]).exists():
                merged[e["name"]] = e
    for e in produced:
        merged[e["name"]] = e
    produced = sorted(merged.values(), key=lambda e: e["start"])
    manifest.write_text(json.dumps(produced, indent=2))
    if args.json:
        print(json.dumps({"rendered": rendered_now, "manifest": len(produced),
                          "skipped": len(skipped), "failed": failed,
                          "output_dir": str(args.output_dir)}))
        return
    print(f"\nRendered {rendered_now} clip(s); manifest holds {len(produced)} "
          f"-> {args.output_dir}")
    if skipped:
        print(f"Skipped {len(skipped)} full-camera clip(s): {', '.join(skipped)}")
    print(f"Manifest: {manifest}")
    if failed:
        # Manifest is written first, then the failure is reported: the batch is
        # usable and the runner still stops.
        print(f"\n{len(failed)} clip(s) FAILED to encode: {', '.join(failed)}",
              file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
