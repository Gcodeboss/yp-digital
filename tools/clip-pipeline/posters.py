#!/usr/bin/env python3
"""One small poster frame per clip, as a base64 JPEG, for the review pack.

A review page cannot carry 400 MB of video, but a reviewer still has to see what
they are approving. One frame per clip at thumbnail size is ~30 KB, so the whole
batch fits comfortably inside an artifact.

    posters.py --at 2.0 --width 270 > posters.json
"""
import argparse
import base64
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import imageio_ffmpeg

import library

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


def poster(path: Path, at: float, width: int, quality: int):
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
        out = Path(f.name)
    try:
        subprocess.run(
            [FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
             "-ss", str(at), "-i", str(path), "-frames:v", "1",
             "-vf", f"scale={width}:-2", "-q:v", str(quality), str(out)],
            check=True)
        return base64.b64encode(out.read_bytes()).decode("ascii")
    finally:
        out.unlink(missing_ok=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--at", type=float, default=2.0, help="seconds into the clip")
    ap.add_argument("--width", type=int, default=270)
    ap.add_argument("--quality", type=int, default=6, help="ffmpeg -q:v, 2=best")
    args = ap.parse_args()

    data = library.load()
    out = {}
    for clip in library.clips(data):
        src = PROJECT_ROOT / clip["path"]
        if not src.exists():
            print(f"missing: {clip['path']}", file=sys.stderr)
            continue
        out[clip["path"]] = poster(src, args.at, args.width, args.quality)
    print(json.dumps(out))
    total = sum(len(v) for v in out.values())
    print(f"{len(out)} posters, {total/1024:.0f} KB of base64", file=sys.stderr)


if __name__ == "__main__":
    main()
