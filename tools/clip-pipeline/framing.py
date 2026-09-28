#!/usr/bin/env python3
"""Which rectangles a clip actually renders with.

`layout.clip_layout()` measures the camera and DAW rects from a clip's own frames,
and it is right most of the time. The failure mode is what happened on 2026-08-17:
when it is wrong there is no recourse short of changing a constant and re-rendering
the whole batch. So measurement keeps its job and this sits in front of it.

Precedence, highest first:

  1. a rect the creator set on this clip
  2. a scene lock covering this clip's range
  3. the measurement

All three go through the same validity gates. A hand-set rect can produce a
negative crop just as easily as a mis-measured one, and the gates are the only
thing standing between that and `crop=-9:...` reaching ffmpeg.

A locked range does NOT silently absorb a scene change. If the webcam inset has
actually moved inside a lock, the clip is flagged: locking is a promise that the
framing is stable, and a broken promise should be visible rather than absorbed.
"""
import json
import os
from pathlib import Path

import layout as _layout

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent.parent
LOCKS = PROJECT_ROOT / "clips" / "framing-locks.json"

DRIFT_TOLERANCE = 24        # px the measured inset may move inside a lock


def load_locks(path: Path = LOCKS) -> dict:
    if not path.exists():
        return {"version": 1, "locks": []}
    return json.loads(path.read_text())


def save_locks(data: dict, path: Path = LOCKS) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")


def add_lock(data: dict, date: str, start: float, end: float,
             cam: list, daw: list, note: str = "") -> dict:
    lock = {"date": date, "start": start, "end": end,
            "cam": list(cam), "daw": list(daw) if daw else None, "note": note}
    data.setdefault("locks", []).append(lock)
    return lock


def lock_for(data: dict, date: str, start: float, end: float):
    """The lock covering this clip, if any. Later locks win, so a correction
    applied on top of an earlier one takes effect without deleting it."""
    hit = None
    for lock in data.get("locks", []):
        if lock.get("date") != date:
            continue
        if start >= lock["start"] and end <= lock["end"]:
            hit = lock
    return hit


def validate(cam, daw, frame_w, frame_h):
    """(ok, reason). The same gates measurement is held to."""
    if cam is None:
        return False, "no camera rect"
    failed = _layout.gate(tuple(cam), frame_w, frame_h)
    if failed:
        return False, f"camera rect rejected: {failed}"
    if daw is not None:
        x, y, w, h = daw
        if w <= 0 or h <= 0:
            return False, f"daw rect degenerate: {w}x{h}"
        if w < _layout.MIN_DAW_WIDTH:
            return False, f"daw width {w}px below the {_layout.MIN_DAW_WIDTH}px floor"
        if x < 0 or y < 0 or x + w > frame_w or y + h > frame_h:
            return False, f"daw rect {daw} outside the {frame_w}x{frame_h} frame"
    return True, "ok"


def resolve(source, clip, cal, locks=None):
    """Return (mode, cam, daw, origin, warnings) for one clip.

    `clip` is a resolved library record (creator edits already on top), so a
    creator framing arrives here as clip["framing"].
    """
    fw, fh = cal["frame"]["width"], cal["frame"]["height"]
    warnings = []
    start = clip["start"]
    duration = clip["end"] - clip["start"]

    measured_mode, measured_cam, measured_daw = _layout.clip_layout(
        source, start, duration, cal)

    # 1. creator rect on this clip
    framing = clip.get("framing")
    if framing:
        cam = framing.get("cam")
        daw = framing.get("daw")
        ok, why = validate(cam, daw, fw, fh)
        if ok:
            return ("split" if daw else "reframe"), tuple(cam), \
                   (tuple(daw) if daw else None), "creator", warnings
        warnings.append(f"creator framing rejected ({why}); using the measurement")

    # 2. a scene lock
    locks = locks if locks is not None else load_locks()
    lock = lock_for(locks, clip.get("date", ""), start, clip["end"])
    if lock:
        ok, why = validate(lock["cam"], lock["daw"], fw, fh)
        if not ok:
            warnings.append(f"scene lock rejected ({why}); using the measurement")
        else:
            if measured_cam and abs(measured_cam[0] - lock["cam"][0]) > DRIFT_TOLERANCE:
                warnings.append(
                    f"the webcam moved inside the locked range "
                    f"(measured x={measured_cam[0]}, locked x={lock['cam'][0]}) — "
                    f"this clip may need its own framing")
            daw = tuple(lock["daw"]) if lock["daw"] else None
            return ("split" if daw else "reframe"), tuple(lock["cam"]), daw, "lock", warnings

    # 3. the measurement
    return measured_mode, measured_cam, measured_daw, "measured", warnings
