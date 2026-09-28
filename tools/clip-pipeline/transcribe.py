#!/usr/bin/env python3
"""Transcribe audio.wav with OpenAI Whisper, chunking to keep runs bounded."""
import argparse
import json
import os
import subprocess
import time
from pathlib import Path

import numpy as np
from tqdm import tqdm

ROOT = Path(__file__).resolve().parent
WORK = Path(os.environ["CLIP_WORK"]) if os.environ.get("CLIP_WORK") else (ROOT / "work")

# Whisper needs a plain `ffmpeg` on PATH; our venv has a symlink to imageio_ffmpeg.
os.environ["PATH"] = str(ROOT / ".venv" / "bin") + os.pathsep + os.environ.get("PATH", "")

import whisper  # noqa: E402

DEFAULT_AUDIO = WORK / "audio.wav"
CHUNK_SECONDS = float(os.environ.get("WHISPER_CHUNK_SECONDS", "900"))  # 15 min default
MODEL_NAME = os.environ.get("WHISPER_MODEL", "small")
FALLBACK_MODEL = os.environ.get("WHISPER_FALLBACK_MODEL", "base")


def transcribe_chunk(model, audio_chunk: np.ndarray, initial_prompt: str = ""):
    result = model.transcribe(
        audio_chunk,
        language="en",
        word_timestamps=True,
        verbose=False,
        initial_prompt=initial_prompt,
    )
    return result.get("segments", [])


def adjust_segments(segments, offset: float):
    """Add offset to every timestamp in segments."""
    for seg in segments:
        seg["start"] = round(seg["start"] + offset, 3)
        seg["end"] = round(seg["end"] + offset, 3)
        if "words" in seg:
            for w in seg["words"]:
                w["start"] = round(w["start"] + offset, 3)
                w["end"] = round(w["end"] + offset, 3)
    return segments


def get_chunk_files(audio_path: Path, chunk_dir: Path, chunk_seconds: float):
    """Return list of (offset, duration, chunk_wav_path). Create chunk files if missing."""
    import imageio_ffmpeg
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()

    # Get duration from metadata if available.
    meta_path = WORK / "audio_meta.json"
    duration = None
    if meta_path.exists():
        with open(meta_path) as f:
            info = json.load(f)
            duration = info.get("duration")

    if duration is None:
        audio = whisper.load_audio(str(audio_path), sr=16000)
        duration = len(audio) / 16000

    chunks = []
    start = 0.0
    idx = 0
    while start < duration:
        end = min(start + chunk_seconds, duration)
        dur = end - start
        chunk_path = chunk_dir / f"chunk_{idx:03d}_{int(start):06d}.wav"
        chunks.append((start, dur, chunk_path))
        start = end
        idx += 1

    # Create missing chunk WAVs via ffmpeg (fast).
    for offset, dur, chunk_path in chunks:
        if chunk_path.exists() and chunk_path.stat().st_size > 0:
            continue
        cmd = [
            ffmpeg,
            "-hide_banner",
            "-loglevel", "error",
            "-ss", str(offset),
            "-t", str(dur),
            "-i", str(audio_path),
            "-acodec", "pcm_s16le",
            "-ar", "16000",
            "-ac", "1",
            "-y",
            str(chunk_path),
        ]
        subprocess.run(cmd, check=True)

    return chunks


def chunk_transcript_path(chunk_dir: Path, idx: int):
    return chunk_dir / f"transcript_{idx:03d}.json"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", type=Path, default=DEFAULT_AUDIO)
    parser.add_argument("--output", type=Path, default=WORK / "transcript.json")
    parser.add_argument("--model", default=MODEL_NAME)
    parser.add_argument("--chunk-seconds", type=float, default=CHUNK_SECONDS)
    args = parser.parse_args()

    WORK.mkdir(parents=True, exist_ok=True)
    chunk_dir = WORK / "chunks"
    chunk_dir.mkdir(exist_ok=True)

    if args.output.exists() and args.output.stat().st_size > 0:
        print(f"Using cached transcript: {args.output}")
        return

    chunks = get_chunk_files(args.audio, chunk_dir, args.chunk_seconds)
    print(f"Audio split into {len(chunks)} chunk(s) of ~{args.chunk_seconds}s")

    model = None
    model_name = args.model
    try:
        print(f"Loading Whisper model: {model_name}")
        model = whisper.load_model(model_name)
    except Exception as e:
        print(f"Failed to load {model_name}: {e}")
        model_name = FALLBACK_MODEL
        print(f"Falling back to {model_name}")
        model = whisper.load_model(model_name)

    all_segments = []
    initial_prompt = ""
    for idx, (offset, dur, chunk_path) in enumerate(tqdm(chunks, desc="Transcribing chunks")):
        transcript_path = chunk_transcript_path(chunk_dir, idx)
        if transcript_path.exists() and transcript_path.stat().st_size > 0:
            print(f"Using cached chunk transcript {transcript_path}")
            with open(transcript_path) as f:
                segments = json.load(f)
            # Still need to feed prompt forward.
            if segments:
                tail = " ".join(s["text"].strip() for s in segments[-3:])
                initial_prompt = tail[-200:]
            all_segments.extend(adjust_segments(segments, offset))
            continue

        audio_chunk = whisper.load_audio(str(chunk_path), sr=16000)
        try:
            segments = transcribe_chunk(model, audio_chunk, initial_prompt=initial_prompt)
        except Exception as e:
            print(f"Chunk at {offset}s failed with {model_name}: {e}")
            if model_name != FALLBACK_MODEL:
                model_name = FALLBACK_MODEL
                print(f"Falling back to {model_name} for remaining chunks")
                model = whisper.load_model(model_name)
                segments = transcribe_chunk(model, audio_chunk, initial_prompt=initial_prompt)
            else:
                raise

        # Save immediately so a timeout can resume.
        with open(transcript_path, "w") as f:
            json.dump(segments, f, indent=2)

        if segments:
            tail = " ".join(s["text"].strip() for s in segments[-3:])
            initial_prompt = tail[-200:]

        all_segments.extend(adjust_segments(segments, offset))

    transcript = {"coverage": "full", "segments": all_segments}
    with open(args.output, "w") as f:
        json.dump(transcript, f, indent=2)
    print(f"Transcript written to {args.output} ({len(all_segments)} segments)")


if __name__ == "__main__":
    main()
