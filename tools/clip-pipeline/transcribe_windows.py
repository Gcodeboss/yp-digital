#!/usr/bin/env python3
"""Transcribe ONLY the candidate windows, not the whole stream.

Full-VOD transcription costs 30-60 minutes per stream. When the clips have
already been chosen — by select_music_clips.py, say — the only words that matter
are the ones inside those 30-second windows. That is ~2 minutes of audio for a
whole batch instead of three hours.

Writes work/transcript.json with GLOBAL (VOD-relative) timestamps, the same shape
transcribe.py produces, so compose.py captions from it unchanged. A small margin
either side keeps Whisper from clipping the first and last word.

Usage:
    transcribe_windows.py [--model small] [--margin 3]
"""
import argparse
import json
import os
import subprocess
import tempfile
from pathlib import Path

import imageio_ffmpeg

ROOT = Path(__file__).resolve().parent
WORK = Path(os.environ["CLIP_WORK"]) if os.environ.get("CLIP_WORK") else (ROOT / "work")
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


def cut(audio: Path, start: float, dur: float, out: Path):
    subprocess.run(
        [FFMPEG, "-hide_banner", "-loglevel", "error",
         "-ss", f"{start:.3f}", "-i", str(audio), "-t", f"{dur:.3f}",
         "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", "-y", str(out)],
        check=True,
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", type=Path, default=WORK / "audio.wav")
    ap.add_argument("--candidates", type=Path, default=WORK / "candidates.json")
    ap.add_argument("--output", type=Path,
                    default=WORK / "transcript_windows.json")
    ap.add_argument("--model", default=os.environ.get("WHISPER_MODEL", "small"))
    ap.add_argument("--margin", type=float, default=3.0)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    if args.output.exists() and not args.force:
        print(f"Using cached transcript: {args.output}")
        return

    cands = json.loads(args.candidates.read_text())
    if not cands:
        raise SystemExit("No candidates to transcribe")

    from faster_whisper import WhisperModel
    print(f"Loading faster-whisper: {args.model}")
    model = WhisperModel(args.model, device="auto", compute_type="int8")

    segments = []
    for c in cands:
        start = max(0.0, c["start"] - args.margin)
        dur = (c["end"] + args.margin) - start
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as t:
            chunk = Path(t.name)
        try:
            cut(args.audio, start, dur, chunk)
            segs, _ = model.transcribe(str(chunk), language="en",
                                       word_timestamps=True, beam_size=5)
            n = 0
            for s in segs:
                words = [{"word": w.word, "start": round(w.start + start, 3),
                          "end": round(w.end + start, 3)}
                         for w in (s.words or [])]
                segments.append({
                    "start": round(s.start + start, 3),
                    "end": round(s.end + start, 3),
                    "text": s.text.strip(),
                    "words": words,
                })
                n += len(words)
            print(f"  {c['start']:.0f}-{c['end']:.0f}s -> {n} words")
        finally:
            chunk.unlink(missing_ok=True)

    segments.sort(key=lambda s: s["start"])
    args.output.write_text(json.dumps({
        "coverage": "windows",
        "ranges": [[c["start"], c["end"]] for c in cands],
        "segments": segments,
    }, indent=2))
    total = sum(len(s["words"]) for s in segments)
    print(f"Wrote {args.output} ({len(segments)} segments, {total} words)")


if __name__ == "__main__":
    main()
