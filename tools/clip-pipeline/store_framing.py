#!/usr/bin/env python3
"""Backfill the camera and DAW rects onto clips rendered before they were recorded.

The editor draws its live 9:16 preview from these rects. Measuring them on demand
costs about three seconds per clip — seven seeks into a multi-hour file — which is
far too slow for switching between clips. Resolving them once and storing them
makes the preview instant.
"""
import json
import sys
from pathlib import Path

import framing as _framing
import library

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


def main():
    lib = library.load()
    batches = lib.get("batches") or {}
    done = skipped = 0

    for date, batch in sorted(batches.items()):
        src = library.resolve_path((batch or {}).get("source"))
        calp = library.resolve_path((batch or {}).get("calibration"))
        if not src or not calp or not calp.exists():
            print(f"{date}: no recorded source/calibration — skipped", file=sys.stderr)
            continue
        cal = json.loads(calp.read_text())
        for path, clip in lib["clips"].items():
            if clip.get("date") != date:
                continue
            if clip.get("cam") and not ("--force" in sys.argv):
                skipped += 1
                continue
            resolved = library.resolve(dict(clip, path=path))
            mode, cam, daw, origin, _ = _framing.resolve(src, resolved, cal)
            clip["cam"] = list(cam)
            clip["daw"] = list(daw) if daw else None
            clip["mode"] = mode
            clip["framing_origin"] = origin
            done += 1
            print(f"  {date} {path.split('/')[-1]:24} {mode:8} cam={cam} daw={daw}")

    library.save(lib)
    print(f"\nstored rects for {done} clip(s); {skipped} already had them")
    return 0


if __name__ == "__main__":
    sys.exit(main())
