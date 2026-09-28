#!/usr/bin/env python3
"""Decide a clip's layout from its own frames — shared by selection and render.

This used to live inside compose.py, which meant a clip's layout was only knowable
*after* it had been rendered. Rendering costs 25-40s per clip at `libx264 -preset
slow`, so discovering that a candidate reframes badly meant throwing away a full
render; one batch this session rendered 15 clips to ship 6.

The probe reads seven frames and costs well under a second, so selection can call
it too and simply not pick candidates that will reframe.

Also the single place that silences OpenCV's FFmpeg decoder chatter. These VODs
have keyframe gaps that make every seek emit "Missing reference picture" to
stderr; the warnings are meaningless here and used to be filtered out by hand on
essentially every command.
"""
import os

os.environ.setdefault("OPENCV_FFMPEG_LOGLEVEL", "-8")

import cv2  # noqa: E402
import numpy as np  # noqa: E402

try:  # available on modern opencv builds; harmless if not
    cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_SILENT)
except Exception:
    pass

MIN_DAW_WIDTH = 150   # below this there is not enough arrangement to fill a pane
PANE_ASPECT = 1080 / 1056     # the bottom pane the DAW rect has to fill
MAX_BROWSER_BLEED = 90        # px of Ableton's browser we may show to fill the pane
CLIP_SAT = 60                 # saturation above which a pixel reads as a coloured clip
CLIP_ROW_FRAC = 0.12          # share of a row that must be coloured to count as a lane
PROBE_FRACS = (0.08, 0.22, 0.36, 0.5, 0.64, 0.78, 0.92)


def is_daw_frame(frame) -> bool:
    """True if this frame shows the DAW. Resolution-relative.

    THE ONE COPY. calibrate.py imports this rather than keeping its own, which is
    what it used to do. This heuristic is subtle enough to have already caused a
    real failure -- at a night carnival a black jacket and dark pavement pass the
    identical test, which is how 2026-08-31 was told "the OBS scene layout may
    have changed" about a stream with no Ableton in it at all. Tuning it in one
    file and not the other is the next version of that bug.

    The Ableton browser sidebar in the lower-left is dark and desaturated; the
    same region in a full-camera shot is a warm-lit room.
    """
    h, w = frame.shape[:2]
    roi = frame[int(0.625 * h):int(0.97 * h), int(0.016 * w):int(0.33 * w)]
    if roi.size == 0:
        return False
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    return hsv[:, :, 2].mean() < 110 and hsv[:, :, 1].mean() < 60


def propose_pip(mean: np.ndarray):
    """Propose a webcam-inset rect from a temporal-mean frame."""
    h, w = mean.shape
    ys = slice(0, int(0.32 * h))
    best_x, best_cov = None, 0.0
    for x in range(int(0.47 * w), int(0.89 * w)):
        step = np.abs(mean[ys, x + 2] - mean[ys, x - 2])
        cov = (step > 8).mean()
        if cov > best_cov:
            best_cov, best_x = cov, x
    if best_x is None or best_cov < 0.6:
        return None

    xs = slice(best_x + 12, w - 12)
    bottom = None
    for y in range(int(0.29 * h), int(0.61 * h)):
        step = np.abs(mean[y + 2, xs] - mean[y - 2, xs])
        if (step > 8).mean() >= 0.85:
            bottom = y - 2
            break
    if bottom is None:
        return None
    return (int(best_x), 0, int(w - best_x), int(bottom))


# Validity gates. Without these the detector locks onto the acoustic-panel edge
# inside the camera picture and returns a ~200px slice, which then gets magnified
# 5x — the original "way too zoomed in" defect.
MIN_ASPECT, MAX_ASPECT = 1.30, 2.10
MIN_W_FRAC = 0.28
MIN_X_FRAC, MAX_X_FRAC = 0.50, 0.75
MAX_Y_FRAC = 0.04


def gate(rect, w, h):
    """Return None if the rect passes, else the name of the gate it failed."""
    x, y, rw, rh = rect
    if rh <= 0 or rw <= 0:
        return "degenerate"
    aspect = rw / rh
    if not (MIN_ASPECT <= aspect <= MAX_ASPECT):
        return f"aspect={aspect:.2f}"
    if rw < MIN_W_FRAC * w:
        return f"width={rw}"
    if not (MIN_X_FRAC * w <= x <= MAX_X_FRAC * w):
        return f"x={x}"
    if y > MAX_Y_FRAC * h:
        return f"y={y}"
    return None


def detect_camera_rect(grays, fw, fh):
    """Bounding box of the moving part of the frame = the camera."""
    if len(grays) < 3:
        return (0, 0, fw, fh)
    std = np.stack(grays).std(axis=0)
    col, row = std.mean(axis=0), std.mean(axis=1)
    if col.max() <= 0 or row.max() <= 0:
        return (0, 0, fw, fh)

    def span(profile):
        idx = np.where(profile > 0.45 * profile.max())[0]
        return (int(idx[0]), int(idx[-1] + 1)) if len(idx) else (0, len(profile))

    x0, x1 = span(col)
    y0, y1 = span(row)
    w, h = x1 - x0, y1 - y0
    if w < 0.25 * fw or h < 0.25 * fh:
        return (0, 0, fw, fh)

    cx, cy = x0 + w / 2, y0 + h / 2
    if w / h < 16 / 9:
        w = h * 16 / 9
    else:
        h = w * 9 / 16
    x0 = max(0, min(fw - w, cx - w / 2))
    y0 = max(0, min(fh - h, cy - h / 2))
    even = lambda n: int(n) // 2 * 2  # noqa: E731
    return (even(x0), even(y0), even(min(w, fw)), even(min(h, fh)))


def daw_content_rect(mean_bgr, cal, cam_x):
    """The part of the arrangement worth showing, shaped to fill the pane.

    Two things were wrong with using the whole calibrated arrangement rect. It
    spans `daw_top..daw_bottom`, but the lower half of the arrangement is usually
    EMPTY lanes, so ~40% of the pane was blank grid. And the camera-free width is
    only 217-385 px, far narrower than the near-square pane, so the rest of the
    pane became dark letterbox bars. The result read as "black bars around a
    narrow strip of empty grid" rather than as a beat being built.

    So: find the rows that actually carry coloured clips, then reach the pane's
    aspect by extending LEFT into the browser's blank right margin -- up to
    MAX_BROWSER_BLEED, which is wide enough to fill the frame and narrow enough
    that no file names show. Anything still not square enough is left to
    compose.pane_chain's existing cover-crop cap.
    """
    x1 = cam_x - 4
    x0 = cal["arrangement_left"]
    y0, y1 = cal["daw_top"], cal["daw_bottom"]
    if x1 - x0 < MIN_DAW_WIDTH:
        return None

    roi = mean_bgr[y0:y1, x0:x1]
    sat = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)[:, :, 1].astype(np.float32)
    rows = np.where((sat > CLIP_SAT).mean(axis=1) > CLIP_ROW_FRAC)[0]
    if len(rows) >= 8:
        top = y0 + int(rows[0])
        bottom = y0 + int(rows[-1]) + 1
    else:                      # nothing coloured: keep the calibrated rect
        top, bottom = y0, y1

    # Reach the pane's aspect from whichever side is short, so the pane is filled
    # with arrangement instead of dark bars.
    left = x0
    height = bottom - top
    avail = x1 - left

    if avail > height * PANE_ASPECT:
        # Too wide -- a couple of loaded tracks in a tall pane would render as a
        # thin band. Give the height back, mostly downward: Ableton adds tracks
        # top-down, so the rows below the content are the ones worth revealing.
        grow = avail / PANE_ASPECT - height
        top = max(y0, int(top - grow * 0.35))
        bottom = min(y1, int(bottom + grow * 0.65))
        height = bottom - top
    elif avail < height * PANE_ASPECT:
        # Too tall -- borrow from the browser's blank right margin.
        left = int(max(x0 - MAX_BROWSER_BLEED, x1 - height * PANE_ASPECT, 0))

    return (int(left), int(top), int(x1 - left), int(height))


def clip_layout(source, start, duration, cal):
    """Return ("split", cam_rect, daw_rect) or ("reframe", cam_rect, None).

    The webcam inset is stable within a scene but Yanchan resizes it several times
    per stream, so a stream-wide rect puts camera in the bottom pane on every clip
    from a different scene. Each clip is measured from its own frames and
    validated against the same gates calibration uses.
    """
    fw, fh = cal["frame"]["width"], cal["frame"]["height"]

    # Calibration measured the whole stream and recorded that it has no DAW on
    # screen. Re-deciding that per clip would re-run the same lower-left darkness
    # heuristic that mistook a night carnival for Ableton in the first place, and
    # on a camera-only stream a chance run of dark frames would send one clip down
    # the split path with no arrangement to put in the bottom pane. The
    # stream-wide answer is the better one; take it.
    if cal.get("mode") == "fullcam":
        return "reframe", (0, 0, fw, fh), None

    cap = cv2.VideoCapture(str(source))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    grays, colour, daw_votes, seen = [], [], 0, 0
    for frac in PROBE_FRACS:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int((start + duration * frac) * fps))
        ok, frame = cap.read()
        if not ok:
            continue
        seen += 1
        daw_votes += 1 if is_daw_frame(frame) else 0
        grays.append(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).astype(np.float32))
        colour.append(frame)
    cap.release()

    if not grays:
        return "reframe", (0, 0, fw, fh), None

    cam_box = detect_camera_rect(grays, fw, fh)
    if seen == 0 or daw_votes * 2 <= seen:
        return "reframe", cam_box, None

    rect = propose_pip(np.mean(grays, axis=0)) if len(grays) >= 3 else None
    if rect is None or gate(rect, fw, fh):
        # Camera-dominant scenes (a thin DAW strip beside a near-full-frame
        # webcam) land here: a split would be camera in both panes.
        return "reframe", cam_box, None

    mean_bgr = np.mean(np.stack(colour).astype(np.float32), axis=0).astype(np.uint8)
    daw = daw_content_rect(mean_bgr, cal, rect[0])
    if daw is None:
        return "reframe", cam_box, None
    return "split", rect, daw


def resolve_transcript(work):
    """Full transcript if there is one, else the windowed one, else None.

    compose.py can caption from either; analyze.py and detect_music.py refuse
    the windowed form (they need whole-stream coverage).
    """
    from pathlib import Path
    for name in ("transcript.json", "transcript_windows.json"):
        p = Path(work) / name
        if p.exists():
            return p
    return None
