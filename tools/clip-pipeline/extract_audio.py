#!/usr/bin/env python3
"""Extract 16 kHz mono WAV from source MP4 using imageio_ffmpeg."""
import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg

ROOT = Path(__file__).resolve().parent
WORK = Path(os.environ["CLIP_WORK"]) if os.environ.get("CLIP_WORK") else (ROOT / "work")
# No default source. This used to point at one VOD on the machine this was
# written on, which meant running the script bare on any other machine either
# failed confusingly or silently analysed the wrong file. Callers pass --source;
# prepare_stream.py always does.
DEFAULT_SOURCE = None

# 16 kHz, mono, 16-bit is exactly what extract_audio() writes, so a complete WAV
# is 44 bytes of header plus this many bytes per second. That makes truncation
# detectable from the file size alone, with no second decode.
WAV_BYTES_PER_SECOND = 16000 * 1 * 2
WAV_TOLERANCE = 0.98


def audio_is_complete(path: Path, seconds) -> bool:
    """Is this WAV the whole stream, or the stub a killed run left behind?

    The cache test used to be `size > 0`. Extraction of a two-hour stream takes
    minutes and writes the WAV progressively, so interrupting it -- Ctrl-C, a
    closed laptop, a full disk -- leaves a valid-looking file holding the first
    few minutes. Every later stage then reads it happily and produces a music map
    and a set of clips for a stream that appears to end early, and the error, if
    one ever surfaces, names the later stage. Nothing re-extracts, because the
    file exists.
    """
    if not path.exists():
        return False
    if not seconds:                     # unprobeable source: only emptiness is a fault
        return path.stat().st_size > 44
    return path.stat().st_size >= WAV_TOLERANCE * (44 + WAV_BYTES_PER_SECOND * seconds)


def get_ffmpeg():
    exe = imageio_ffmpeg.get_ffmpeg_exe()
    if not Path(exe).exists():
        raise RuntimeError(f"ffmpeg not found at {exe}")
    # Verify it runs.
    subprocess.run([exe, "-version"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return exe


def probe_source(ffmpeg: str, source: Path):
    """Return dict with duration, start_time, width, height, fps."""
    result = subprocess.run(
        [ffmpeg, "-i", str(source)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    out = result.stdout
    info = {}
    m = re.search(r"Duration:\s+(\d+):(\d+):(\d+\.\d+)", out)
    if m:
        h, mi, s = m.groups()
        info["duration"] = int(h) * 3600 + int(mi) * 60 + float(s)
    m = re.search(r"start:\s+([\d.]+)", out)
    info["start_time"] = float(m.group(1)) if m else 0.0
    m = re.search(r",\s+(\d+)x(\d+)[,\s]", out)
    if m:
        info["width"] = int(m.group(1))
        info["height"] = int(m.group(2))
    m = re.search(r"(\d+(?:\.\d+)?)\s+fps", out)
    if m:
        info["fps"] = float(m.group(1))
    return info


def extract_audio(ffmpeg: str, source: Path, output: Path, info: dict):
    """Extract 16kHz mono WAV."""
    cmd = [
        ffmpeg,
        "-hide_banner",
        "-loglevel", "error",
        "-i", str(source),
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        "-y",
        str(output),
    ]
    print(f"Extracting audio to {output} ...")
    subprocess.run(cmd, check=True)
    # Verify output.
    result = subprocess.run(
        [ffmpeg, "-i", str(output)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    if "16000 Hz" not in result.stdout or "mono" not in result.stdout:
        raise RuntimeError("Audio extraction did not produce 16 kHz mono WAV")
    print(f"Audio extracted: {output} ({output.stat().st_size / 1e6:.1f} MB)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=WORK / "audio.wav")
    args = parser.parse_args()

    # Fail on the missing argument rather than on a None deep inside ffmpeg.
    if args.source is None:
        raise SystemExit("extract_audio.py needs --source /path/to/vod.mp4")
    if not args.source.exists():
        raise SystemExit(f"no such file: {args.source}")

    WORK.mkdir(parents=True, exist_ok=True)
    ffmpeg = get_ffmpeg()

    info = probe_source(ffmpeg, args.source)
    if audio_is_complete(args.output, info.get("duration")):
        print(f"Using cached audio: {args.output}")
    else:
        if args.output.exists():
            want = (44 + WAV_BYTES_PER_SECOND * (info.get("duration") or 0)) / 1e6
            print(f"Cached audio is short: {args.output.stat().st_size / 1e6:.1f} MB "
                  f"against ~{want:.1f} MB for a {info.get('duration', 0) / 60:.0f} min "
                  f"source. Re-extracting.")
        extract_audio(ffmpeg, args.source, args.output, info)

    meta_path = WORK / "audio_meta.json"
    with open(meta_path, "w") as f:
        json.dump(info, f, indent=2)
    print(f"Source info: {info}")


if __name__ == "__main__":
    main()
