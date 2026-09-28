#!/usr/bin/env python3
"""Make a stream playable and scrubbable in a browser.

Two problems stop a raw capture from working in the editor's video element, and
both were invisible until a real player was pointed at one:

  1. Some captures are MPEG-TS with an .mp4 name -- they start with 0x47, not
     `ftyp`. No browser plays them. Two of the first three streams were like this.
  2. An MP4 whose `moov` index sits after the media cannot be seeked without
     downloading to the end, so a three-hour file is unscrubable.

A remux fixes both without re-encoding: stream-copy into MP4 with `+faststart`.
It costs a minute and no quality.

    make_proxy.py --stream 2026-07-03           remux to a seekable MP4
    make_proxy.py --all                          every stream that needs it
    make_proxy.py --stream 2026-07-03 --small    also a 640x360 scrub proxy

The `--small` proxy is for comfort rather than correctness: a 3 GB file seeks
fine over localhost, but a 640-wide copy seeks instantly and costs ~250 MB.
Nothing downstream uses either — the compositor always renders from the original.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg

import library

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent.parent
PROXIES = PROJECT_ROOT / "streams" / "proxy"
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


def container_of(path: Path) -> str:
    """'mp4-faststart', 'mp4-slow', 'mpegts' or 'unknown' — from the bytes."""
    with path.open("rb") as fh:
        head = fh.read(12)
    if head[:1] == b"G":
        return "mpegts"
    if head[4:8] == b"ftyp":
        with path.open("rb") as fh:
            import struct
            off, order = 0, []
            for _ in range(4):
                fh.seek(off)
                hdr = fh.read(8)
                if len(hdr) < 8:
                    break
                size = struct.unpack(">I", hdr[:4])[0]
                order.append(hdr[4:8].decode("latin1", "replace"))
                if size == 1:
                    size = struct.unpack(">Q", fh.read(8))[0]
                if size <= 0:
                    break
                off += size
        return "mp4-faststart" if "moov" in order[:3] else "mp4-slow"
    return "unknown"


def needs_proxy(path: Path) -> bool:
    return container_of(path) != "mp4-faststart"


def remux(src: Path, dest: Path) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part.mp4")
    proc = subprocess.run(
        [FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-fflags", "+genpts",
         "-i", str(src), "-c", "copy", "-movflags", "+faststart", str(tmp)],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if proc.returncode != 0:
        tmp.unlink(missing_ok=True)
        print(proc.stdout.strip().splitlines()[-1] if proc.stdout else "remux failed",
              file=sys.stderr)
        return False
    tmp.replace(dest)
    return True


def small(src: Path, dest: Path) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part.mp4")
    proc = subprocess.run(
        [FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-i", str(src),
         "-vf", "scale=640:-2", "-c:v", "libx264", "-crf", "30", "-preset", "veryfast",
         "-g", "60", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", str(tmp)],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if proc.returncode != 0:
        tmp.unlink(missing_ok=True)
        return False
    tmp.replace(dest)
    return True


def sources() -> dict:
    """stream date -> source path.

    Both the streams that have been clipped (recorded on the batch) and everything
    the archive holds. A freshly captured stream has no batch yet, and that is
    exactly when someone wants to open it in the editor and start clipping.
    """
    import archive
    out = {}
    for rec in archive.archived(archive.load()):
        src, date = rec.get("path"), rec.get("stream_date")
        if not src or not date:
            continue
        p = Path(src)
        if not p.is_absolute():
            p = PROJECT_ROOT / p
        if p.exists():
            out[date] = p
    for date, batch in (library.load().get("batches") or {}).items():
        src = (batch or {}).get("source")
        if src and Path(src).exists():
            out[date] = Path(src)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stream")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--small", action="store_true",
                    help="also build a 640-wide scrub proxy (slow, re-encodes)")
    ap.add_argument("--status", action="store_true")
    args = ap.parse_args()

    found = sources()
    if args.status or not (args.stream or args.all):
        for date, src in sorted(found.items()):
            proxy = PROXIES / f"{date}.mp4"
            state = container_of(src)
            print(f"{date}  {state:14} {'proxy ready' if proxy.exists() else 'needs proxy' if state != 'mp4-faststart' else 'plays directly'}")
        return 0

    targets = [args.stream] if args.stream else sorted(found)
    for date in targets:
        src = found.get(date)
        if not src:
            print(f"{date}: no recorded source", file=sys.stderr)
            continue
        state = container_of(src)
        proxy = PROXIES / f"{date}.mp4"
        if state == "mp4-faststart" and not args.small:
            print(f"{date}: already seekable ({src.name}) — no proxy needed")
            continue
        if not proxy.exists():
            print(f"{date}: {state} -> remuxing to a seekable MP4")
            if not remux(src, proxy):
                continue
            print(f"  {proxy.name}  {proxy.stat().st_size/1e9:.2f} GB")
        if args.small:
            sm = PROXIES / f"{date}.small.mp4"
            print(f"{date}: building a 640-wide scrub proxy (this re-encodes)")
            if small(proxy if proxy.exists() else src, sm):
                print(f"  {sm.name}  {sm.stat().st_size/1e6:.0f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
