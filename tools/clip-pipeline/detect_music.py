#!/usr/bin/env python3
"""Find the stretches where music is actually PLAYING (and where it is sung).

Speech-vs-music discrimination on top of the 16 kHz mono WAV that
extract_audio.py already produces. No new dependencies — numpy + scipy only.

The signal that separates a producer's session from a conversation is
periodicity. Speech has no steady pulse; a beat does. So the primary feature is
the autocorrelation of the onset envelope over musically plausible lags, taken
twice:

  * beat_strength  — onset envelope over the full band
  * pulse_strength — onset envelope restricted to 30-160 Hz, i.e. the kick drum.
                     Nothing in speech produces a periodic sub-bass pulse, which
                     makes this the single most reliable indicator of a beat.

Two supporting features separate *sung* music from an instrumental:

  * tonality   — how peaked the 12-bin chroma distribution is. Music dwells on a
                 handful of pitch classes; speech smears across all of them.
  * sung       — a HELD, PITCHED voice in the mix, measured from the audio alone.

Combined into a 0-1 music score per second, smoothed, then thresholded into
segments. A segment carrying a sustained vocal is tagged "singing"; music
without one is "instrumental".

The vocal test used to read the transcript and ask "were there words here?".
Two things were wrong with that. The transcript is written AFTER selection on
the fast path, so at decision time there was none and EVERY segment fell
through to "instrumental" -- a vocalist session was tagged 100% beats.
And even with a transcript it measured the wrong thing: on the 2026-07-03 VOD
the transcript says someone is talking 89% of the stream, so "has words" is
nearly always true and separates nothing.

So the vocal cue is now audio-only and measures singing rather than talking:
speech pitch moves constantly and dies inside 200 ms, a sung note is HELD.
`sung_note_fraction()` reports the share of frames sitting inside a stable
pitch while the voice is actually present in the mix.

Validated against what was in the room, which is real ground truth: the two
sessions with a vocalist lift sharply inside music (Tresor 0.50, Kiki Rowe 0.42
median) while the solo beat-making stream does not lift at all (0.31 inside
music vs 0.32 outside it). Segment threshold 0.45 tags 79% of the Tresor
session, 29% of the Kiki Rowe session and 12% of the solo stream as vocal.

Tempo validation: the detector also reports the tempo it locked onto. On the
2026-07-03 VOD Ableton's transport reads 100.00 BPM on screen, so a correct
detector should report ~100 BPM over the music segments — that is a real ground
truth, not a vibe check.

Usage:
    detect_music.py [--audio work/audio.wav]
"""
import argparse
import json
import os
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.ndimage import median_filter
from scipy.signal import stft

ROOT = Path(__file__).resolve().parent
WORK = Path(os.environ["CLIP_WORK"]) if os.environ.get("CLIP_WORK") else (ROOT / "work")

SR = 16000
NFFT = 1024                 # 64 ms window
HOP = 256                   # 16 ms hop -> 62.5 frames/sec
FPS = SR / HOP

# Musically plausible tempo range. 60-190 BPM covers everything Yanchan makes.
MIN_BPM, MAX_BPM = 60.0, 190.0
ANALYSIS_WIN = 8.0          # seconds of onset envelope per autocorrelation
KICK_LO, KICK_HI = 30.0, 160.0

VOC_LO, VOC_HI = 200.0, 4000.0   # vocal fundamental + formants
VOCAL_BLOCK_SEC = 120.0          # chunked: a full-stream vocal spectrogram is 1.4 GB
SUNG_THRESHOLD = 0.45            # segment median above this is a vocal take

MUSIC_THRESHOLD = 0.55      # score above this counts as music
MIN_SEGMENT = 8.0           # ignore blips shorter than this
MERGE_GAP = 4.0             # bridge gaps shorter than this


def onset_envelope(mag, lo_bin=None, hi_bin=None):
    """Half-wave rectified spectral flux — an onset strength curve."""
    band = mag[lo_bin:hi_bin] if lo_bin is not None else mag
    diff = np.diff(band, axis=1)
    flux = np.maximum(diff, 0).sum(axis=0)
    flux = np.concatenate([[0.0], flux])
    if flux.max() > 0:
        flux = flux / flux.max()
    return flux


def periodicity(env, fps):
    """Return (strength, bpm) from the autocorrelation of an onset envelope.

    Strength is the dominant periodic peak relative to the local baseline, so a
    steady pulse scores high and noise scores near zero regardless of loudness.
    """
    env = env - env.mean()
    if not np.any(env):
        return 0.0, 0.0
    ac = np.correlate(env, env, mode="full")[len(env) - 1:]
    if ac[0] <= 0:
        return 0.0, 0.0
    ac = ac / ac[0]

    lo = int(fps * 60.0 / MAX_BPM)
    hi = int(fps * 60.0 / MIN_BPM)
    hi = min(hi, len(ac) - 1)
    if hi <= lo:
        return 0.0, 0.0

    window = ac[lo:hi]
    peak_idx = int(np.argmax(window))
    peak = float(window[peak_idx])
    baseline = float(np.median(window))
    strength = max(0.0, peak - baseline)
    lag = (lo + peak_idx) / fps
    bpm = 60.0 / lag if lag > 0 else 0.0
    # Autocorrelation routinely locks onto a metrical multiple rather than the
    # notated tempo (the classic octave error). Fold into 70-140 BPM so the
    # reported tempo is comparable across segments.
    while bpm > 140:
        bpm /= 2.0
    while 0 < bpm < 70:
        bpm *= 2.0
    return strength, bpm


def chroma_tonality(mag, freqs):
    """How concentrated the energy is across the 12 pitch classes (0-1)."""
    valid = (freqs > 55) & (freqs < 2000)
    f = freqs[valid]
    m = mag[valid]
    midi = 69 + 12 * np.log2(np.maximum(f, 1e-6) / 440.0)
    pc = np.mod(np.round(midi).astype(int), 12)
    chroma = np.zeros((12, m.shape[1]), dtype=np.float32)
    for k in range(12):
        sel = pc == k
        if sel.any():
            chroma[k] = m[sel].sum(axis=0)
    total = chroma.sum(axis=0)
    total[total == 0] = 1e-9
    chroma = chroma / total
    # Low entropy => energy sits on a few pitch classes => tonal.
    entropy = -(chroma * np.log(chroma + 1e-9)).sum(axis=0) / np.log(12)
    return 1.0 - entropy


def vocal_frames(data, sr):
    """Per-frame vocal-band harmonic energy, total energy and dominant pitch.

    Computed in 2-minute blocks with overlap: the median filters are local, so
    blocking is exact, and it keeps a three-hour stream off the 1.4 GB
    full-spectrogram path.
    """
    fps = sr / HOP
    pad = 64
    block = int(VOCAL_BLOCK_SEC * fps) * HOP
    ve, te, pitch = [], [], []
    n = len(data)
    pos = 0
    while pos < n:
        a = max(0, pos - pad * HOP)
        b = min(n, pos + block + pad * HOP)
        freqs, _, Z = stft(data[a:b], fs=sr, nperseg=NFFT, noverlap=NFFT - HOP,
                           window="hann", padded=False, boundary=None)
        mag = np.abs(Z).astype(np.float32)
        lo = int(np.searchsorted(freqs, VOC_LO))
        hi = int(np.searchsorted(freqs, VOC_HI))
        band = mag[lo:hi]
        # HPSS-lite: smoothing along time keeps sustained tones, smoothing along
        # frequency keeps transients. Drums land in the second one, voice in the
        # first, so the mask suppresses the beat before we look for a voice.
        H = median_filter(band, size=(1, 17), mode="nearest")
        P = median_filter(band, size=(17, 1), mode="nearest")
        harm = band * (H ** 2) / (H ** 2 + P ** 2 + 1e-12)
        # Dominant harmonic peak below 1 kHz tracks the fundamental (or its first
        # harmonic) without needing a real f0 estimator.
        p_hi = max(int(np.searchsorted(freqs, 1000.0)) - lo, 1)
        band_f = freqs[lo:hi][:p_hi]
        peak_f = band_f[np.argmax(harm[:p_hi], axis=0)]
        lead = (pos - a) // HOP
        want = min(block, n - pos) // HOP
        ve.append(harm.sum(axis=0)[lead:lead + want])
        te.append(mag.sum(axis=0)[lead:lead + want])
        pitch.append(peak_f[lead:lead + want])
        pos += block
    return np.concatenate(ve), np.concatenate(te), np.concatenate(pitch)


def sung_note_fraction(data, sr, n_seconds, hold_ms=250, tol_semitones=0.6):
    """Per second: share of frames inside a HELD pitch with the voice audible.

    This is the singing-vs-talking discriminator. A note counts as held when the
    pitch stays within ~0.6 of a semitone across a 250 ms window, which speech
    almost never does and a sung or hummed note almost always does.
    """
    fps = sr / HOP
    ve, te, pitch = vocal_frames(data, sr)
    semitones = 12 * np.log2(np.maximum(pitch, 1e-6) / 440.0)
    hold = max(2, int(hold_ms / 1000.0 * fps))
    stable = np.abs(semitones - median_filter(semitones, size=hold, mode="nearest")) < tol_semitones
    ratio = ve / np.maximum(te, 1e-9)
    present = ratio > np.percentile(ratio, 40)
    good = (stable & present).astype(np.float32)

    out = np.zeros(n_seconds)
    step = int(fps)
    for s in range(n_seconds):
        a, b = int(s * step), min(len(good), int(s * step) + step)
        if b > a:
            out[s] = good[a:b].mean()
    return out


def smooth(x, win):
    if win <= 1:
        return x
    k = np.ones(win) / win
    return np.convolve(x, k, mode="same")


def segments_from_mask(mask, min_len, merge_gap):
    """Contiguous True runs, gaps bridged, short runs dropped."""
    idx = np.where(mask)[0]
    if len(idx) == 0:
        return []
    runs = []
    start = prev = idx[0]
    for i in idx[1:]:
        if i - prev > merge_gap:
            runs.append((start, prev + 1))
            start = i
        prev = i
    runs.append((start, prev + 1))
    return [(float(a), float(b)) for a, b in runs if b - a >= min_len]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", type=Path, default=WORK / "audio.wav")
    ap.add_argument("--output", type=Path, default=WORK / "music.json")
    ap.add_argument("--threshold", type=float, default=MUSIC_THRESHOLD)
    ap.add_argument("--sung-threshold", type=float, default=SUNG_THRESHOLD,
                    help="segment median sung-note fraction to tag it a vocal take")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--json", action="store_true", help="one-line summary only")
    args = ap.parse_args()

    WORK.mkdir(parents=True, exist_ok=True)
    if args.output.exists() and not args.force:
        if args.json:
            cached = json.loads(args.output.read_text())
            print(json.dumps({"segments": len(cached.get("segments", [])),
                              "cached": True, "output": str(args.output)}))
        else:
            print(f"Using cached music map: {args.output}")
        return

    sr, data = wavfile.read(str(args.audio))
    if data.ndim > 1:
        data = data.mean(axis=1)
    data = data.astype(np.float32) / 32768.0
    duration = len(data) / sr
    print(f"Audio: {duration/60:.1f} min @ {sr} Hz")

    print("Computing spectrogram ...")
    freqs, _, Z = stft(data, fs=sr, nperseg=NFFT, noverlap=NFFT - HOP,
                       window="hann", padded=False, boundary=None)
    mag = np.abs(Z).astype(np.float32)
    fps = sr / HOP

    kick_lo = int(np.searchsorted(freqs, KICK_LO))
    kick_hi = int(np.searchsorted(freqs, KICK_HI))
    print("Computing onset envelopes ...")
    env_full = onset_envelope(mag)
    env_kick = onset_envelope(mag, kick_lo, kick_hi)

    print("Computing tonality ...")
    tonal_frames = chroma_tonality(mag, freqs)

    n_seconds = int(np.ceil(duration))
    step = int(fps)
    win = int(ANALYSIS_WIN * fps)

    beat = np.zeros(n_seconds)
    pulse = np.zeros(n_seconds)
    bpm_est = np.zeros(n_seconds)
    tonal = np.zeros(n_seconds)

    print(f"Scanning {n_seconds} seconds ...")
    for s in range(n_seconds):
        a = max(0, int(s * step) - win // 2)
        b = min(mag.shape[1], a + win)
        if b - a < win // 2:
            continue
        bs, bpm = periodicity(env_full[a:b], fps)
        ps, _ = periodicity(env_kick[a:b], fps)
        beat[s] = bs
        pulse[s] = ps
        bpm_est[s] = bpm
        tonal[s] = tonal_frames[a:b].mean()

    # Normalise each feature against its own distribution so the score is
    # comparable across streams recorded at different levels.
    def norm(x):
        lo, hi = np.percentile(x, 10), np.percentile(x, 95)
        return np.clip((x - lo) / max(hi - lo, 1e-6), 0, 1)

    score = 0.45 * norm(pulse) + 0.35 * norm(beat) + 0.20 * norm(tonal)
    score = smooth(score, 7)

    print("Detecting sustained vocals ...")
    # NOT `sung`: that name is taken further down for the list of sung segments.
    sung_curve = smooth(sung_note_fraction(data, sr, n_seconds), 5)

    mask = score >= args.threshold
    music_segs = segments_from_mask(mask, MIN_SEGMENT, MERGE_GAP)

    out_segs = []
    for a, b in music_segs:
        a_i, b_i = int(a), int(b)
        seg_sung = float(np.median(sung_curve[a_i:b_i])) if b_i > a_i else 0.0
        kind = "singing" if seg_sung >= args.sung_threshold else "instrumental"
        # nan is truthy, so `np.median(empty) or 0` returned nan and wrote
        # invalid `NaN` into music.json. Guard the empty slice explicitly.
        valid_bpm = bpm_est[a_i:b_i][bpm_est[a_i:b_i] > 0]
        seg_bpm = float(np.median(valid_bpm)) if valid_bpm.size else 0.0
        out_segs.append({
            "start": a, "end": b, "duration": b - a,
            "kind": kind,
            "score": round(float(score[a_i:b_i].mean()), 3),
            "bpm": round(seg_bpm, 1),
            "sung_fraction": round(seg_sung, 3),
        })

    total = sum(s["duration"] for s in out_segs)
    sung_segs = [s for s in out_segs if s["kind"] == "singing"]
    all_bpm = [s["bpm"] for s in out_segs if 60 <= s["bpm"] <= 190]
    print(f"\nMusic segments: {len(out_segs)} covering {total/60:.1f} min "
          f"({100*total/duration:.0f}% of the stream)")
    print(f"  singing: {len(sung_segs)}   instrumental: {len(out_segs)-len(sung_segs)}")
    if all_bpm:
        print(f"  tempo: median {np.median(all_bpm):.1f} BPM "
              f"(range {min(all_bpm):.0f}-{max(all_bpm):.0f})")
    for s in out_segs[:12]:
        m0, m1 = int(s["start"] // 60), int(s["end"] // 60)
        print(f"    {m0:>3}:{int(s['start']%60):02d}-{m1:>3}:{int(s['end']%60):02d} "
              f"{s['kind']:<12} score={s['score']:.2f} bpm={s['bpm']:.0f}")

    args.output.write_text(json.dumps({
        "audio": str(args.audio),
        "duration": duration,
        "threshold": args.threshold,
        "per_second_score": [round(float(v), 3) for v in score],
        "per_second_sung": [round(float(v), 3) for v in sung_curve],
        "sung_threshold": args.sung_threshold,
        "segments": out_segs,
    }, indent=2))
    if args.json:
        print(json.dumps({"segments": len(out_segs),
                          "music_minutes": round(total / 60, 1),
                          "singing": len(sung_segs),
                          "median_bpm": round(float(np.median(all_bpm)), 1) if all_bpm else None,
                          "output": str(args.output)}))
    else:
        print(f"\nWritten to {args.output}")


if __name__ == "__main__":
    main()
