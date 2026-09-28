#!/usr/bin/env python3
"""Audio peaks for the timeline, cached per stream.

The timeline's existing lanes show the music-detection SCORE, which is a judgement
about the audio, not the audio. Silence and speech look identical on it, so you
cannot see where a sentence starts — and finding the edge of a sentence is most of
what trimming a clip is.

This writes a peak envelope: for each bucket, the loudest sample in it. Peaks
rather than averages, because an average smooths away exactly the transients
(a drum hit, a word starting) you are looking for.

    waveform.py --stream 2026-07-08                 build it
    waveform.py --stream 2026-07-08 --buckets 8000  finer
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile

import library

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent.parent
STORE = PROJECT_ROOT / "streams" / "waveform"

DEFAULT_BUCKETS = 6000      # ~1.8s per bucket on a 3h stream; zooming reads a slice


def build(audio: Path, buckets: int) -> dict:
    sr, data = wavfile.read(str(audio))
    if data.ndim > 1:
        data = data.mean(axis=1)
    data = np.abs(data.astype(np.float32))
    duration = len(data) / sr

    edges = np.linspace(0, len(data), buckets + 1).astype(np.int64)
    peaks = np.zeros(buckets, dtype=np.float32)
    for i in range(buckets):
        a, b = edges[i], max(edges[i + 1], edges[i] + 1)
        peaks[i] = data[a:b].max()

    ceiling = float(np.percentile(peaks, 99.5)) or 1.0
    peaks = np.clip(peaks / ceiling, 0, 1)
    return {
        "duration": duration,
        "buckets": buckets,
        "peaks": [round(float(v), 3) for v in peaks],
    }


def work_dir_for(stream: str):
    # A stream being prepared for the first time has no batch recorded yet — the
    # batch is written once preparation succeeds. CLIP_WORK is how every other
    # stage is told which work directory it is operating on, so honour it here too.
    env = __import__("os").environ.get("CLIP_WORK")
    if env and (Path(env) / "audio.wav").exists():
        return Path(env)
    lib = library.load()
    batch = (lib.get("batches") or {}).get(stream) or {}
    return library.resolve_path(batch.get("work_dir"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stream", required=True)
    ap.add_argument("--buckets", type=int, default=DEFAULT_BUCKETS)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    out = STORE / f"{args.stream}.json"
    if out.exists() and not args.force:
        print(f"cached: {out}")
        return 0

    wd = work_dir_for(args.stream)
    if not wd or not (wd / "audio.wav").exists():
        print(f"no audio.wav for {args.stream} — run the pipeline's extract_audio "
              f"stage first", file=sys.stderr)
        return 1

    data = build(wd / "audio.wav", args.buckets)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data))
    print(f"{args.stream}: {args.buckets} buckets over {data['duration']/3600:.2f}h "
          f"-> {out} ({out.stat().st_size/1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
