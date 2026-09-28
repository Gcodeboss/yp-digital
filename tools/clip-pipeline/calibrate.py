#!/usr/bin/env python3
"""Measure the stream's layout ONCE per VOD and write work/calibration.json.

The webcam inset and the Ableton work area are OBS scene constants — they do not
change shot to shot. The previous per-clip detector treated them as variables and
produced eight different answers for one stream, five of which were a ~200px
slice of the right edge of the camera picture (it locked onto the acoustic-panel
edge inside the shot instead of the inset border). Cover-cropping that sliver up
to 1080x864 is a 5x magnification — the "way too zoomed in" defect.

So: sample many frames across the whole VOD, propose a rect from each, throw out
everything that cannot physically be a webcam inset, and take the median of what
survives. If too few survive, fail loudly rather than guess.

Usage:
    calibrate.py --source <vod.mp4> [--samples 60] [--force]
"""
import argparse
import json
import os
from pathlib import Path

import numpy as np

# is_daw_frame lives in layout.py -- one copy, deliberately. Importing cv2
# from there also silences OpenCV's decoder chatter.
from layout import cv2, is_daw_frame

ROOT = Path(__file__).resolve().parent
WORK = Path(os.environ["CLIP_WORK"]) if os.environ.get("CLIP_WORK") else (ROOT / "work")

# --- Validity gates -------------------------------------------------------
# Every one of the five bad detections on the 2026-07-03 VOD violated at least
# two of these. Expressed as fractions of frame size so they survive a
# resolution change.
MIN_ASPECT, MAX_ASPECT = 1.30, 2.10   # a webcam feed is 16:9 or 4:3
MIN_W_FRAC = 0.28                     # 185-223px on a 1280 frame is a sliver
MIN_X_FRAC, MAX_X_FRAC = 0.50, 0.75   # anchored top-right, but not past 75%
MAX_Y_FRAC = 0.04                     # anchored to the top of the frame
MIN_SURVIVORS = 8

# --- DAW content bounds ---------------------------------------------------
DAW_TOP_FRAC = 0.061      # below the macOS menu bar + Live title bar (~44/720)
DAW_BOTTOM_FRAC = 0.736   # above the empty device strip + dock (~530/720)
PIP_MARGIN = 4            # keep the DAW crop this far clear of the inset


def propose_pip(mean: np.ndarray):
    """Propose a webcam-inset rect from a temporal-mean frame.

    On a mean of frames several seconds apart, moving content blurs out and
    static UI stays sharp, so the inset border reads as a step edge spanning the
    full inset height. Returns (x, y, w, h) or None.
    """
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


def measure_daw_rect(frames, pip_x, w, h):
    """Derive the Ableton work area from column motion + saturation.

    The browser sidebar is static and grey; the arrangement is saturated and
    moves (playhead, clips, meters). We take the left edge of saturated content
    as the arrangement's left edge, and clamp the right edge to stay clear of
    the webcam inset so there is never camera bleed in the bottom pane.
    """
    # Average across every sampled DAW frame — a single frame is not enough.
    # Measured on the 2026-07-03 VOD this gives a clean step: the browser
    # columns sit at saturation 2-7, the arrangement at 43-71.
    band = np.mean(
        [cv2.cvtColor(f, cv2.COLOR_BGR2HSV)[int(0.08 * h):int(0.72 * h), :, 1]
         .astype(np.float32).mean(axis=0) for f in frames],
        axis=0,
    )

    # First sustained run of saturated columns = start of the arrangement.
    left = None
    run = 0
    for x in range(int(0.10 * w), int(0.70 * w)):
        run = run + 1 if band[x] > 25 else 0
        if run > 20:
            left = x - run + 1
            break
    if left is None or left >= pip_x - 120:
        print(f"WARNING: arrangement left edge unreliable ({left}); using 0.30*W")
        left = int(0.30 * w)

    right = pip_x - PIP_MARGIN
    top = int(DAW_TOP_FRAC * h)
    bottom = int(DAW_BOTTOM_FRAC * h)
    return (int(left), top, int(right - left), int(bottom - top))


def write_fullcam(args, w, h, daw_frames, fullcam, rejects, why):
    """Record a camera-only stream as a state instead of failing the run.

    A stream with no DAW on screen is not a broken stream, and until now it was
    treated as one: both exits below raised SystemExit, so an IRL stream
    dead-ended at preparation with nothing written and no way forward from the
    dashboard. `compose.py --fullcam-mode reframe` could always render it; there
    was simply no record saying that was the right thing to do.
    """
    out = {
        "source": str(args.source),
        "frame": {"width": w, "height": h},
        "mode": "fullcam",
        "reason": why,
        "webcam_layouts": [],
        "webcam_default": None,
        "arrangement_left": None,
        "daw_top": None,
        "daw_bottom": None,
        "samples": {"daw_frames": len(daw_frames), "fullcam_frames": fullcam,
                    "accepted": 0, "rejected": rejects},
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(out, indent=2) + "\n")
    print(f"Camera-only stream: {why}")
    print("Clips render single-pane; there is no DAW to show.")
    print(f"Calibration written to {args.output}")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", type=Path, required=True)
    ap.add_argument("--samples", type=int, default=60)
    ap.add_argument("--output", type=Path, default=WORK / "calibration.json")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--json", action="store_true", help="one-line summary only")
    args = ap.parse_args()

    WORK.mkdir(parents=True, exist_ok=True)
    if args.output.exists() and not args.force:
        cached = json.loads(args.output.read_text())
        if cached.get("source") == str(args.source):
            n = len(cached.get("webcam_layouts", []))
            if args.json:
                print(json.dumps({"layouts": n, "cached": True,
                                  "arrangement_left": cached.get("arrangement_left"),
                                  "output": str(args.output)}))
            else:
                print(f"Using cached calibration: {args.output} "
                      f"({n} webcam layout(s), arrangement_left="
                      f"{cached.get('arrangement_left')})")
            return

    cap = cv2.VideoCapture(str(args.source))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total <= 0:
        raise SystemExit(f"Could not read frame count from {args.source}")
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"Source: {w}x{h}, {total} frames @ {fps:.2f} fps")

    # Sample across the whole VOD, skipping the first/last 3% (intros/outros).
    daw_frames = []
    fullcam = 0
    for i in range(args.samples):
        frac = 0.03 + 0.94 * i / max(1, args.samples - 1)
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(total * frac))
        ok, frame = cap.read()
        if not ok:
            continue
        if is_daw_frame(frame):
            daw_frames.append(frame)
        else:
            fullcam += 1
    cap.release()
    print(f"Sampled {len(daw_frames)} DAW frames, {fullcam} full-camera frames")

    if len(daw_frames) < 4:
        return write_fullcam(args, w, h, daw_frames, fullcam, {},
                             f"only {len(daw_frames)} of {args.samples} sampled "
                             "frames show a DAW at all")

    # Propose a rect from each overlapping group of 6 frames.
    grays = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32) for f in daw_frames]
    proposals, rejects = [], {}
    for i in range(0, max(1, len(grays) - 5)):
        group = grays[i:i + 6]
        if len(group) < 3:
            continue
        rect = propose_pip(np.mean(group, axis=0))
        if rect is None:
            rejects["no-edge"] = rejects.get("no-edge", 0) + 1
            continue
        why = gate(rect, w, h)
        if why:
            key = why.split("=")[0]
            rejects[key] = rejects.get(key, 0) + 1
            continue
        proposals.append(rect)

    print(f"Proposals: {len(proposals)} accepted, rejected {rejects or '{}'}")
    if len(proposals) < MIN_SURVIVORS:
        # Two very different failures used to share one message, and the message
        # described the rarer of them.
        #
        # `is_daw_frame()` decides a frame shows the DAW when its lower-left is
        # dark and desaturated -- Ableton's browser sidebar. At a night carnival a
        # black jacket, dark pavement and a sleeve pass the same test: measured on
        # 2026-08-31, an IRL stream with no Ableton in it at all scored 40% "DAW"
        # frames against a real studio stream's 57%. So the `len(daw_frames) < 4`
        # guard above cannot separate them and never fires, and an IRL stream
        # arrived here to be told its OBS scene layout had changed. It has no OBS
        # scene.
        #
        # The signal that does separate them is already computed. `propose_pip`
        # looks for the inset's edge; when every group comes back `no-edge`, there
        # is no inset anywhere in the stream, which is what camera-only means.
        # A genuine layout change looks different: edges ARE found and then
        # rejected on aspect or size (2026-08-26 moved the camera to a 514x373
        # panel and still produced 33 accepted proposals).
        only_no_edge = set(rejects) <= {"no-edge"} and not proposals
        if only_no_edge:
            return write_fullcam(
                args, w, h, daw_frames, fullcam, rejects,
                "no webcam inset edge found in any sampled group, so there is no "
                "picture-in-picture layout in this stream")
        raise SystemExit(
            f"Calibration failed: only {len(proposals)} valid webcam-inset "
            f"measurements (need {MIN_SURVIVORS}). Rejections: {rejects}. "
            "Edges were found and refused, so this is a layout change rather than "
            "a camera-only stream — inspect a frame before rendering."
        )

    # Yanchan resizes the webcam inset during a stream — this VOD contains four
    # stable layouts (x = 689 / 715 / 747 / 817), each holding for a contiguous
    # block. A single median would be wrong for most of the stream and would put
    # camera in the bottom pane. So cluster them: the clusters are what a clip's
    # own measurement gets validated against, and compose.py measures per clip.
    clusters = []
    for rect in sorted(proposals, key=lambda r: r[0]):
        for c in clusters:
            if abs(rect[0] - c["x"]) <= 20 and abs(rect[3] - c["h"]) <= 30:
                c["members"].append(rect)
                break
        else:
            clusters.append({"x": rect[0], "h": rect[3], "members": [rect]})
    for c in clusters:
        arr = np.array(c["members"])
        med = np.median(arr, axis=0)
        c.update(x=int(med[0]), y=int(med[1]), w=int(med[2]), h=int(med[3]),
                 count=len(c["members"]))
        del c["members"]
    clusters.sort(key=lambda c: c["count"], reverse=True)

    default = clusters[0]
    arrangement_left = measure_daw_rect(daw_frames, default["x"], w, h)[0]
    print(f"Webcam layouts found ({len(clusters)}):")
    for c in clusters:
        print(f"  x={c['x']:4d} y={c['y']} w={c['w']:4d} h={c['h']:4d}  "
              f"({c['count']} samples)")
    print(f"Arrangement left edge: x={arrangement_left}")

    result = {
        "source": str(args.source),
        "frame": {"width": w, "height": h},
        "webcam_layouts": clusters,
        "webcam_default": {k: default[k] for k in ("x", "y", "w", "h")},
        "arrangement_left": arrangement_left,
        "daw_top": int(DAW_TOP_FRAC * h),
        "daw_bottom": int(DAW_BOTTOM_FRAC * h),
        "samples": {
            "daw_frames": len(daw_frames),
            "fullcam_frames": fullcam,
            "accepted": len(proposals),
            "rejected": rejects,
        },
    }
    args.output.write_text(json.dumps(result, indent=2))
    if args.json:
        print(json.dumps({"layouts": len(clusters),
                          "arrangement_left": arrangement_left,
                          "frame": f"{w}x{h}", "output": str(args.output)}))
    else:
        print(f"Calibration written to {args.output}")


if __name__ == "__main__":
    main()
