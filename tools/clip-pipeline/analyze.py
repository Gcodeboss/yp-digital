#!/usr/bin/env python3
"""Analyze transcript + audio to rank viral 20-30s clip candidates."""
import argparse
import json
import os
import math
import re
import bisect
from collections import defaultdict
from pathlib import Path

import numpy as np
from scipy.io import wavfile

ROOT = Path(__file__).resolve().parent
WORK = Path(os.environ["CLIP_WORK"]) if os.environ.get("CLIP_WORK") else (ROOT / "work")
DEFAULT_AUDIO = WORK / "audio.wav"
DEFAULT_TRANSCRIPT = WORK / "transcript.json"

# Keyword tags tuned for Yanchan as a music producer / artist streamer.
# Multi-word phrases are listed first so they match before their sub-words.
KEYWORDS = {
    "freestyle": ["freestyle", "rap", "bar", "spit", "flow", "rhyme", "track", "verse"],
    "vocal": ["sing", "vocal", "hook", "chorus", "adlib", "melody"],
    "production": [
        "ableton", "production", "produce", "producer", "beat", "drop", "loop",
        "sample", "808", "kick", "snare", "drum", "bass", "synth", "melody",
        "chord", "arrangement", "mix", "mixing", "master", "mastering", "plugin",
        "vst", "midi", "daw", "session", "studio", "eq", "compressor",
    ],
    "collab": ["collab", "feat", "featuring", "guest", "together", "jam", "write", "with tresor"],
    "culture": ["tamil", "mridangam", "mrithangam", "desi", "indian", "scarborough", "toronto", "heritage", "tradition"],
    "advice": ["how to", "why you", "tip", "trick", "never", "always", "mistake", "fix", "secret", "learn"],
    "roast": ["roast", "cook", "burn", "diss", "clown", "lame", "mid"],
    "reaction": ["react", "reaction", "no way", "bro", "damn", "what", "hell", "omg", "crazy", "wild"],
    "story": ["story", "remember", "back then", "one time", "happened", "went to"],
    "chat": ["chat", "yall", "y'all", "donate", "donation", "sub", "follow"],
    "laugh": ["laugh", "haha", "hehe", "lol", "lmao"],
}


def load_transcript(path: Path):
    with open(path) as f:
        data = json.load(f)
    if data.get("coverage") == "windows":
        raise SystemExit(
            f"{path} only covers selected clip windows, not the whole stream. "
            "Scoring the full stream from it produces nonsense candidates. "
            "Run transcribe.py for a full transcript, or use --select music."
        )
    return data.get("segments", [])


def build_word_timeline(segments):
    """Return list of {start, end, text, segment_idx} for every word."""
    words = []
    for i, seg in enumerate(segments):
        seg_words = seg.get("words")
        if seg_words:
            for w in seg_words:
                words.append({
                    "start": w["start"],
                    "end": w["end"],
                    "text": w["word"].strip().lower(),
                    "segment_idx": i,
                })
        else:
            # Evenly distribute words across segment duration.
            text = seg.get("text", "").strip()
            tokens = re.findall(r"[\w']+", text.lower())
            if not tokens:
                continue
            dur = seg["end"] - seg["start"]
            step = dur / len(tokens)
            for j, tok in enumerate(tokens):
                words.append({
                    "start": seg["start"] + j * step,
                    "end": seg["start"] + (j + 1) * step,
                    "text": tok,
                    "segment_idx": i,
                })
    words.sort(key=lambda x: x["start"])
    return words


def detect_spikes(audio_path: Path, output: Path):
    """Detect seconds where RMS energy > 1.5x rolling 60s mean."""
    if output.exists():
        with open(output) as f:
            return np.array(json.load(f), dtype=bool)

    print(f"Loading audio for spike detection: {audio_path}")
    sr, data = wavfile.read(str(audio_path))
    if data.ndim > 1:
        data = data.mean(axis=1)
    data = data.astype(np.float32)

    # Per-second RMS.
    seconds = math.ceil(len(data) / sr)
    rms = np.zeros(seconds)
    for s in range(seconds):
        chunk = data[s * sr:(s + 1) * sr]
        if len(chunk) == 0:
            continue
        rms[s] = np.sqrt(np.mean(chunk ** 2))

    # Rolling 60s mean (avoid edge effects).
    window = 60
    rolling = np.convolve(rms, np.ones(window) / window, mode="same")
    rolling[rolling == 0] = 1e-6
    spikes = rms > (1.5 * rolling)

    with open(output, "w") as f:
        json.dump(spikes.tolist(), f)
    print(f"Spikes written to {output} ({int(spikes.sum())} spike seconds)")
    return spikes


class WordIndex:
    """`words` sorted by start, with a range lookup that does not rescan the list.

    `score_window()` runs on a 30 s window every 5 s across the whole stream --
    1,962 windows on the 2026-07-03 VOD -- and each call filtered the entire word
    list. On that stream's 24,843 words that is 48.7 million comparisons to place
    ten clips, and it grows with the product of stream length and how much was
    said.

    The words are already sorted by start time, so the window is a contiguous
    slice. The lower bound backs off by the longest single word: any word
    starting earlier than that cannot still be sounding at `start`, because its
    end is at most `start + max_len` away from its own beginning. So the slice is
    exactly the same set the scan produced, and the filter below is only tidying
    its two edges.
    """

    def __init__(self, words):
        self.words = words
        self._starts = [w["start"] for w in words]
        self._max_len = max((w["end"] - w["start"] for w in words), default=0.0)

    def __len__(self):
        return len(self.words)

    def overlapping(self, start: float, end: float):
        """Words sounding at any point in [start, end) -- the scan's own test."""
        lo = bisect.bisect_left(self._starts, start - self._max_len)
        hi = bisect.bisect_left(self._starts, end)
        return [w for w in self.words[lo:hi]
                if w["end"] > start and w["start"] < end]

    def contained(self, start: float, end: float):
        """Words that begin AND end inside [start, end]."""
        lo = bisect.bisect_left(self._starts, start)
        hi = bisect.bisect_right(self._starts, end)
        return [w for w in self.words[lo:hi]
                if w["start"] >= start and w["end"] <= end]


def score_window(start: float, end: float, words, spikes: np.ndarray, segments):
    """Return composite score and feature dict for a window.

    `words` may be a plain list or a WordIndex; the callers pass an index.
    """
    wds = (words.overlapping(start, end) if isinstance(words, WordIndex)
           else [w for w in words if w["end"] > start and w["start"] < end])
    duration = end - start
    word_count = len(wds)
    word_rate = word_count / duration if duration > 0 else 0

    # Conversational turn density: distinct segment indices in window.
    seg_idxs = {w["segment_idx"] for w in wds}
    # Approximate turns by pauses / segment switches.
    turn_density = len(seg_idxs) / duration if duration > 0 else 0

    # Keyword matches.
    tag_scores = defaultdict(int)
    for w in wds:
        for tag, kws in KEYWORDS.items():
            for kw in kws:
                if kw in w["text"]:
                    tag_scores[tag] += 1
    best_tag = max(tag_scores, key=lambda k: tag_scores[k]) if tag_scores else "energy"
    keyword_score = sum(tag_scores.values()) / duration if duration > 0 else 0

    # Rhythmic density proxy: bursts of short words / high local word rate variance.
    if len(wds) >= 3:
        local_gaps = [wds[i + 1]["start"] - wds[i]["end"] for i in range(len(wds) - 1)]
        avg_gap = np.mean(local_gaps) if local_gaps else 1.0
        rhythm_score = min(2.0, 1.0 / (avg_gap + 0.05))
    else:
        rhythm_score = 0

    # Spike overlap.
    s0, s1 = int(start), min(int(end) + 1, len(spikes))
    spike_overlap = spikes[s0:s1].mean() if s1 > s0 else 0.0

    # Composite (tuned weights).
    score = (
        2.0 * word_rate +
        1.5 * turn_density +
        2.0 * keyword_score +
        0.8 * rhythm_score +
        3.0 * spike_overlap
    )

    return score, {
        "word_rate": word_rate,
        "turn_density": turn_density,
        "keyword_score": keyword_score,
        "rhythm_score": rhythm_score,
        "spike_overlap": spike_overlap,
        "best_tag": best_tag,
        "word_count": word_count,
    }


def extract_excerpt(segments, start: float, end: float, max_words: int = 35):
    """Return representative transcript excerpt for a time range."""
    text = " ".join(
        seg.get("text", "").strip()
        for seg in segments
        if seg["end"] > start and seg["start"] < end
    )
    words = text.split()
    if len(words) > max_words:
        text = " ".join(words[:max_words]) + "..."
    return text


def context_tag(features):
    """Map best keyword tag to a short folder-safe context label."""
    tag = features["best_tag"]
    if tag in ("freestyle", "roast", "reaction", "story"):
        return tag
    if tag == "chat":
        return "banter"
    if tag == "laugh":
        return "laugh"
    # Yanchan-specific contexts.
    if tag == "production":
        return "production"
    if tag == "vocal":
        return "vocal"
    if tag == "collab":
        return "collab"
    if tag == "culture":
        return "culture"
    if tag == "advice":
        return "advice"
    if features["spike_overlap"] > 0.3:
        return "energy"
    if features["word_rate"] > 2.5:
        return "fasttalk"
    return "moment"


def trim_to_peak(start: float, end: float, words, spikes, segments, end_time: float,
                 target_min=20.0, target_max=30.0):
    """Adjust window to 20-30s centered on local density peak, clamped to stream bounds."""
    start = max(0.0, start)
    end = min(end_time, end)
    duration = end - start
    if duration <= target_max and duration >= target_min:
        return start, end

    # Find densest sub-second inside window by word count.
    best_center = (start + end) / 2
    best_count = 0
    step = 1.0
    t = start
    while t + 1 <= end:
        cnt = (len(words.contained(t, t + 1)) if isinstance(words, WordIndex)
               else sum(1 for w in words if w["start"] >= t and w["end"] <= t + 1))
        if cnt > best_count:
            best_count = cnt
            best_center = t + 0.5
        t += step

    half = min(max(target_min / 2, duration / 2), target_max / 2)
    new_start = max(0.0, best_center - half)
    new_end = min(end_time, new_start + min(target_max, max(target_min, 2 * half)))
    # Re-clamp start if end hit the stream boundary.
    if new_end == end_time and new_end - new_start < target_min:
        new_start = max(0.0, new_end - target_min)
    return new_start, new_end


def merge_candidates(candidates, min_gap=15.0):
    """Sort by score and greedily select non-overlapping/adjacent candidates."""
    candidates = sorted(candidates, key=lambda c: c["score"], reverse=True)
    selected = []
    for cand in candidates:
        overlap = any(
            not (cand["end"] + min_gap < s["start"] or cand["start"] - min_gap > s["end"])
            for s in selected
        )
        if not overlap:
            selected.append(cand)
    selected.sort(key=lambda c: c["start"])
    return selected


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--transcript", type=Path, default=DEFAULT_TRANSCRIPT)
    parser.add_argument("--audio", type=Path, default=DEFAULT_AUDIO)
    parser.add_argument("--output", type=Path, default=WORK / "candidates.json")
    parser.add_argument("--spikes", type=Path, default=WORK / "spikes.json")
    parser.add_argument("--max-candidates", type=int, default=30)
    args = parser.parse_args()

    WORK.mkdir(parents=True, exist_ok=True)
    segments = load_transcript(args.transcript)
    words = WordIndex(build_word_timeline(segments))
    if not words:
        raise RuntimeError("No words in transcript")

    print(f"Loaded {len(segments)} segments, {len(words)} words")

    spikes = detect_spikes(args.audio, args.spikes)
    print(f"Spike array length: {len(spikes)}")

    # Sliding 30s windows, 5s step.
    window = 30.0
    step = 5.0
    end_time = max(seg["end"] for seg in segments)
    raw = []
    t = 0.0
    while t + window <= end_time:
        score, feats = score_window(t, t + window, words, spikes, segments)
        raw.append({
            "start": t,
            "end": t + window,
            "score": score,
            "features": feats,
        })
        t += step

    print(f"Scored {len(raw)} windows")

    # Pick the best window from each 5-minute bin so clips are spread across
    # the whole stream, not clustered in one high-energy section.
    bin_size = 300.0
    best_by_bin = {}
    for r in raw:
        bin_idx = int(r["start"] // bin_size)
        if bin_idx not in best_by_bin or r["score"] > best_by_bin[bin_idx]["score"]:
            best_by_bin[bin_idx] = r

    # Convert bin winners to candidate objects; skip low-speech bins.
    candidates = []
    for r in best_by_bin.values():
        if r["features"]["word_rate"] < 0.5:
            continue
        s, e = trim_to_peak(r["start"], r["end"], words, spikes, segments, end_time)
        feats = r["features"]
        tag = context_tag(feats)
        excerpt = extract_excerpt(segments, s, e)
        reason_parts = [
            f"word_rate={feats['word_rate']:.1f}",
            f"turns={feats['turn_density']:.1f}",
            f"keyword={feats['keyword_score']:.1f}",
            f"spike={feats['spike_overlap']:.2f}",
        ]
        candidates.append({
            "start": round(s, 3),
            "end": round(e, 3),
            "score": round(r["score"], 3),
            "reason": f"{tag}: " + "; ".join(reason_parts),
            "context_tag": tag,
            "excerpt": excerpt,
            "features": feats,
        })

    # Take the best N, THEN order them chronologically. merge_candidates returns
    # its picks sorted by start time, so slicing it directly kept the N earliest
    # rather than the N best — on a 9839s stream that meant every clip came from
    # the first 4705s and the back half was never eligible.
    selected = sorted(merge_candidates(candidates, min_gap=5.0),
                      key=lambda c: c["score"], reverse=True)[:args.max_candidates]
    selected.sort(key=lambda c: c["start"])

    # Re-trim selected to ensure 20-30s and clamp to stream bounds.
    final = []
    for c in selected:
        s, e = trim_to_peak(c["start"], c["end"], words, spikes, segments, end_time)
        dur = e - s
        # Ensure minimum, clamped to stream end.
        if dur < 20.0:
            e = min(end_time, s + 20.0)
            s = max(0.0, e - 20.0)
        c["start"] = round(s, 3)
        c["end"] = round(e, 3)
        c["duration"] = round(c["end"] - c["start"], 3)
        # See select_music_clips.py: the review queue distinguishes the bets.
        c.setdefault("selector", "speech")
        final.append(c)

    with open(args.output, "w") as f:
        json.dump(final, f, indent=2)
    print(f"Wrote {len(final)} candidates to {args.output}")


if __name__ == "__main__":
    main()
