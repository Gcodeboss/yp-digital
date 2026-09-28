#!/usr/bin/env python3
"""Find clippable moments in what was *said*, not in what was played.

`detect_music.py` scores periodicity — kick-drum pulse, onset autocorrelation,
chroma peakedness. A funny exchange with no beat under it scores near zero by
construction; that is not a tuning problem. Measured on the working tree, the
music map covers 13% of the 2026-06-26 stream and 15% of 2026-07-03. This module
reads the whole-stream transcript and proposes moments from the rest.

**This is OFF unless a key is configured, and shipping it off is a decision, not an
oversight (design D12a).** `analyze.py` already selects on speech with no model in it
-- word rate, turn-taking, keyword hits, audio spikes -- and it produced all 9 clips
of the 2026-07-31 IRL stream, which has no music in it at all. What this module adds
over those heuristics is judgment, not coverage, and that gain is unmeasured. Running
it costs the guarantee in README.md that nothing leaves the machine, so the default is
off until someone runs the $0.27 comparison on 2026-07-03 that would settle it.

It runs *alongside* the music selector and never instead of it (design D12). The
music path is validated against ground truth — Ableton's transport read 100 BPM,
the detector reported 99 — and it produces the approved split-layout clips.
Discovery adds a lane; it does not take one away.

Three things stop being true of the pipeline the moment a model is in it, and
each is handled here rather than discovered later:

1. **It stops being deterministic.** Every verdict is cached against the stream,
   a hash of the transcript it read, and the prompt version, so a re-run neither
   re-bills nor silently reshuffles a batch the creator already reviewed.
2. **It stops being self-contained.** No key, a failed call or an unparseable
   response degrades to music-only with a recorded warning. A batch never fails
   because this was unavailable.
3. **It can be confidently wrong.** A model will return a plausible timestamp for
   a moment that does not exist, so every proposed range is resolved against real
   transcript segments before it is allowed to become a candidate, and every
   rejection is logged.

Usage:
    discover_moments.py --transcript work/<stream>/transcript.json \\
                        --stream 2026-07-03 [--out work/<stream>/speech.json]
                        [--force] [--model anthropic/claude-opus-5]
"""
import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

import tags as _tags

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent.parent

# Bump when the prompt changes in a way that should invalidate cached verdicts.
PROMPT_VERSION = 1

ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "anthropic/claude-haiku-4.5"

# Measured on 2026-08-18 against live OpenRouter pricing, USD per million tokens.
# Recorded so the cost stamped on a batch is a real figure and not a guess; a
# model missing from here still runs, it just reports no cost.
PRICING = {
    "anthropic/claude-opus-5": (5.00, 25.00),
    "anthropic/claude-sonnet-5": (2.00, 10.00),
    "anthropic/claude-haiku-4.5": (1.00, 5.00),
    "google/gemini-2.5-flash-lite": (0.10, 0.40),
}

# The transcript is chunked with overlap rather than sent in one shot: recall
# matters more than the token difference, and a moment that straddles a chunk
# boundary is exactly the kind a single pass drops.
CHUNK_SECONDS = 1800.0
CHUNK_OVERLAP = 180.0

# Tags a discovered moment may carry. Taken from tags.py rather than restated:
# it already owns the speech-side vocabulary and the copy behind each one, and a
# second list here would drift from it. A tag invented by a model would otherwise
# take the batch down at the strategy step, long after the spend.
SPEECH_TAGS = _tags.SPEECH_TAGS

SYSTEM_PROMPT = """You find moments in a livestream transcript that would work as \
short vertical clips.

The stream is a music producer working in his studio: making beats, recording \
vocalists, coaching them, and talking to chat.

You are reading the part of the stream that has no strong music under it, so do not \
look for musical moments. Look for what was SAID:

- a story with a beginning and an end
- a piece of advice or teaching that stands on its own
- a genuine reaction — surprise, delight, disbelief
- a joke, a roast, or an exchange that is actually funny
- a strong opinion stated plainly

Reject: filler, dead air, logistics, repeated takes of the same line, anything \
that needs context from outside the quoted range to make sense.

A clip must stand alone to someone who has never seen this stream.

Return ONLY a JSON array. Each element:
  {"start": <seconds, number>, "end": <seconds, number>,
   "tag": <one of: TAGS>,
   "reason": "<one sentence, what makes it clippable>",
   "quote": "<the most striking line, verbatim from the transcript>"}

Rules:
- start and end MUST be timestamps that appear in the transcript you were given.
- 15 to 60 seconds long. Prefer 20-35.
- Return at most MAX moments, the strongest ones. Fewer is fine. [] is fine.
- Do not invent timestamps. Do not return a moment you are not confident about."""


# --- transcript ------------------------------------------------------------

def load_segments(path: Path) -> list:
    data = json.loads(Path(path).read_text())
    segs = data["segments"] if isinstance(data, dict) else data
    return [s for s in segs if (s.get("text") or "").strip()]


def transcript_hash(segments: list) -> str:
    """Identity of the text that was read, so a corrected transcript re-analyses."""
    h = hashlib.sha256()
    for s in segments:
        h.update(f"{s['start']:.2f}|{s['end']:.2f}|{s.get('text','').strip()}\n"
                 .encode("utf-8"))
    return h.hexdigest()[:16]


def chunk(segments: list, span: float = CHUNK_SECONDS,
          overlap: float = CHUNK_OVERLAP) -> list:
    """Overlapping windows of segments, so a moment on a boundary is still seen."""
    if not segments:
        return []
    out, start = [], segments[0]["start"]
    end_of_stream = segments[-1]["end"]
    while start < end_of_stream:
        stop = start + span
        window = [s for s in segments if s["start"] < stop and s["end"] > start]
        if window:
            # The step back for overlap can leave a tail already fully covered by
            # the previous window -- on 2026-07-03 that was a 122s chunk sitting
            # entirely inside its predecessor, a whole request billed for nothing.
            if out and window[-1]["end"] <= out[-1][-1]["end"]:
                break
            out.append(window)
        start = stop - overlap
    return out


def render_chunk(segments: list) -> str:
    return "\n".join(f"[{s['start']:.1f}] {s.get('text','').strip()}"
                     for s in segments)


# --- grounding -------------------------------------------------------------

def ground(proposed: dict, segments: list, min_len=15.0, max_len=60.0) -> tuple:
    """Resolve a proposed range against real transcript segments.

    Returns `(candidate_range, reason_rejected)`; exactly one is None. A model
    will return a plausible timestamp for a moment that does not exist, so a
    range only survives if it overlaps transcribed speech, and it is clamped to
    the segments it actually covers rather than passed through as given.
    """
    try:
        start = float(proposed["start"])
        end = float(proposed["end"])
    except (KeyError, TypeError, ValueError):
        return None, f"unparseable range: {proposed!r}"

    if not (end > start):
        return None, f"end not after start ({start}, {end})"

    covered = [s for s in segments if s["end"] > start and s["start"] < end]
    if not covered:
        return None, (f"{start:.1f}-{end:.1f}s matches no transcript segment "
                      "(fabricated timestamp)")

    # Clamp to real speech. A range that drifts past the end of the transcript is
    # clamped to real content, never handed to the compositor as given.
    start = max(start, covered[0]["start"])
    end = min(end, covered[-1]["end"])
    if end - start < min_len:
        return None, (f"{start:.1f}-{end:.1f}s is {end - start:.1f}s of real "
                      f"speech, under the {min_len:.0f}s floor")
    if end - start > max_len:
        end = start + max_len
    return (round(start, 3), round(end, 3)), None


# --- the call --------------------------------------------------------------

def api_key() -> str:
    return (os.environ.get("OPENROUTER_API_KEY")
            or os.environ.get("OPENROUTER_KEY") or "").strip()


def ask(text: str, model: str, key: str, max_moments: int, timeout=120) -> tuple:
    """One chunk to the model. Returns `(moments, usage)`; raises on failure."""
    prompt = (SYSTEM_PROMPT
              .replace("TAGS", ", ".join(SPEECH_TAGS))
              .replace("MAX", str(max_moments)))
    body = json.dumps({
        "model": model,
        "temperature": 0,
        "messages": [{"role": "system", "content": prompt},
                     {"role": "user", "content": text}],
    }).encode("utf-8")
    req = urllib.request.Request(
        ENDPOINT, data=body,
        headers={"Authorization": f"Bearer {key}",
                 "Content-Type": "application/json",
                 "X-Title": "yanchan-clip-pipeline"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    content = payload["choices"][0]["message"]["content"]
    return parse_moments(content), payload.get("usage") or {}


def parse_moments(content: str) -> list:
    """Pull the JSON array out of a reply, fenced or not."""
    content = content.strip()
    fence = re.search(r"```(?:json)?\s*(.+?)```", content, re.S)
    if fence:
        content = fence.group(1).strip()
    if not content.startswith("["):
        bracket = re.search(r"\[.*\]", content, re.S)
        if not bracket:
            raise ValueError(f"no JSON array in reply: {content[:200]!r}")
        content = bracket.group(0)
    parsed = json.loads(content)
    if not isinstance(parsed, list):
        raise ValueError(f"expected a JSON array, got {type(parsed).__name__}")
    return parsed


def cost_for(model: str, usage: dict) -> float:
    rate = PRICING.get(model)
    if not rate or not usage:
        return 0.0
    ins, outs = rate
    return round(usage.get("prompt_tokens", 0) / 1e6 * ins
                 + usage.get("completion_tokens", 0) / 1e6 * outs, 6)


# --- discovery -------------------------------------------------------------

def cache_path(work: Path, stream: str) -> Path:
    return work / "speech-verdict.json"


def discover(segments: list, model: str, key: str, per_chunk: int = 6,
             log=print) -> dict:
    """Run every chunk. Returns a verdict dict; never raises on a call failure."""
    windows = chunk(segments)
    moments, usage_total, failures = [], {"prompt_tokens": 0, "completion_tokens": 0}, []
    for i, window in enumerate(windows, 1):
        span = f"{window[0]['start']:.0f}-{window[-1]['end']:.0f}s"
        try:
            got, usage = ask(render_chunk(window), model, key, per_chunk)
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError,
                KeyError, json.JSONDecodeError, TimeoutError, OSError) as exc:
            # One bad chunk must not cost the others.
            failures.append(f"chunk {i} ({span}): {type(exc).__name__}: {exc}")
            log(f"  chunk {i}/{len(windows)} {span}: FAILED — {exc}")
            continue
        for k in usage_total:
            usage_total[k] += usage.get(k, 0)
        moments.extend(got)
        log(f"  chunk {i}/{len(windows)} {span}: {len(got)} proposed")
    return {
        "prompt_version": PROMPT_VERSION,
        "model": model,
        "chunks": len(windows),
        "proposed": moments,
        "usage": usage_total,
        "cost_usd": cost_for(model, usage_total),
        "failures": failures,
    }


def to_candidates(verdict: dict, segments: list, log=print) -> tuple:
    """Ground every proposal and emit records in the `candidates.json` shape.

    Returns `(candidates, rejections)`. The shape has to match what
    `select_music_clips.py` writes exactly, because `compose.py` and
    `build_strategy.py` consume both without knowing which selector produced a
    record.
    """
    out, rejected = [], []
    for p in verdict.get("proposed", []):
        rng, why = ground(p, segments)
        if rng is None:
            rejected.append({"proposed": p, "reason": why})
            log(f"  rejected: {why}")
            continue
        start, end = rng
        tag = p.get("tag") if p.get("tag") in SPEECH_TAGS else "moment"
        quote = (p.get("quote") or "").strip()
        out.append({
            "start": start,
            "end": end,
            "duration": round(end - start, 3),
            # Speech candidates carry no music score. Left at 0.0 rather than
            # invented: the field ranks within the music selector's own scale and
            # a fabricated number here would rank speech against music as though
            # the two measured the same thing.
            "score": 0.0,
            "context_tag": tag,
            "rank": 0.0,
            "sung_fraction": 0.0,
            "reason": (p.get("reason") or "speech moment").strip(),
            "excerpt": quote,
            "bpm": 0.0,
            "layout": None,
            "selector": "speech",
        })
    out.sort(key=lambda c: c["start"])
    return out, rejected


def merge(music: list, speech: list, spacing: float, log=print) -> tuple:
    """One spacing rule across both selectors, so neither claims the same minute.

    Music wins a collision: it is the validated path and it resolves layout by
    probing the frame, which a speech candidate has not done.
    """
    for c in music:
        c.setdefault("selector", "music")
    for c in speech:
        c.setdefault("selector", "speech")
    kept, dropped = list(music), []
    for c in sorted(speech, key=lambda c: c["start"]):
        clash = next((k for k in kept if abs(c["start"] - k["start"]) < spacing), None)
        if clash:
            dropped.append((c, clash))
            log(f"  spacing: speech {c['start']:.0f}s dropped, within {spacing:.0f}s "
                f"of {clash['selector']} {clash['start']:.0f}s")
            continue
        kept.append(c)
    kept.sort(key=lambda c: c["start"])
    return kept, dropped


def stamp_batch(stream: str, fields: dict) -> None:
    """Record what discovery did, next to the selection settings from 5.1.

    A surprising batch has to be explainable after the fact: the model and prompt
    version that proposed its speech moments belong beside the thresholds that
    produced its music ones. Best-effort — bookkeeping must not take down a run
    that has already produced candidates.
    """
    try:
        import library
        lib = library.load()
        library.record_settings(lib, stream, fields)
        library.save(lib)
    except Exception as exc:                                  # noqa: BLE001
        print(f"note: could not stamp the batch ({exc})", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--transcript", type=Path, required=True)
    ap.add_argument("--stream", required=True, help="stream date, e.g. 2026-07-03")
    ap.add_argument("--out", type=Path, default=None,
                    help="where to write the speech candidates "
                         "(default: alongside the transcript)")
    ap.add_argument("--model", default=os.environ.get("DISCOVERY_MODEL", DEFAULT_MODEL))
    ap.add_argument("--per-chunk", type=int, default=6)
    ap.add_argument("--force", action="store_true",
                    help="re-analyse even when a cached verdict matches")
    ap.add_argument("--candidates", type=Path, default=None,
                    help="merge the speech moments into this candidates.json, "
                         "under the same spacing rule the music selector used")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    segments = load_segments(args.transcript)
    work = args.transcript.parent
    out_path = args.out or (work / "speech.json")
    thash = transcript_hash(segments)

    if not segments:
        print(f"no transcribed speech in {args.transcript}", file=sys.stderr)
        out_path.write_text("[]\n")
        stamp_batch(args.stream, {"discovery": {"status": "no transcript"}})
        return 0

    cache = cache_path(work, args.stream)
    verdict = None
    if cache.exists() and not args.force:
        cached = json.loads(cache.read_text())
        if (cached.get("transcript_hash") == thash
                and cached.get("prompt_version") == PROMPT_VERSION
                and cached.get("model") == args.model):
            verdict = cached
            print(f"reusing the cached verdict ({len(cached.get('proposed', []))} "
                  f"proposed, no request made)")

    if verdict is None:
        key = api_key()
        if not key:
            # Degrade, never fail: the batch still renders from the music path.
            print("discovery SKIPPED: no OPENROUTER_API_KEY in the environment. "
                  "The batch will be music-only.", file=sys.stderr)
            out_path.write_text("[]\n")
            stamp_batch(args.stream, {"discovery": {
                "status": "skipped", "reason": "no OPENROUTER_API_KEY configured"}})
            return 0
        print(f"discovering speech moments with {args.model} "
              f"over {len(segments)} segments")
        verdict = discover(segments, args.model, key, args.per_chunk)
        verdict["transcript_hash"] = thash
        cache.write_text(json.dumps(verdict, indent=2) + "\n")

    candidates, rejected = to_candidates(verdict, segments)
    out_path.write_text(json.dumps(candidates, indent=2) + "\n")

    u = verdict.get("usage") or {}
    print(f"\n{len(candidates)} speech candidate(s) -> {out_path}")
    print(f"  {len(rejected)} rejected at grounding")
    if verdict.get("failures"):
        print(f"  {len(verdict['failures'])} chunk(s) failed; "
              "the batch still renders from what came back")
    print(f"  model={verdict.get('model')} prompt=v{verdict.get('prompt_version')} "
          f"in={u.get('prompt_tokens', 0)} out={u.get('completion_tokens', 0)} "
          f"cost=${verdict.get('cost_usd', 0):.4f}")

    merged_note = {}
    if args.candidates and args.candidates.exists():
        # One spacing rule across both selectors, and the *same* one the music
        # selector ran with -- read from settings rather than re-specified here,
        # or the two halves of a batch could be spaced by different rules.
        import settings as _settings
        spacing = _settings.resolve(args.stream).get("spacing", 240.0)
        music = json.loads(args.candidates.read_text())
        kept, dropped = merge(music, candidates, spacing)
        args.candidates.write_text(json.dumps(kept, indent=2) + "\n")
        speech_kept = sum(1 for c in kept if c.get("selector") == "speech")
        merged_note = {"merged_into_candidates": True,
                       "speech_kept": speech_kept,
                       "speech_dropped_on_spacing": len(dropped),
                       "spacing": spacing}
        print(f"\nmerged into {args.candidates}: {len(kept)} candidate(s) "
              f"({speech_kept} speech, {len(dropped)} dropped on {spacing:.0f}s spacing)")

    stamp_batch(args.stream, {"discovery": {
        "status": "ok",
        "model": verdict.get("model"),
        "prompt_version": verdict.get("prompt_version"),
        "transcript_hash": verdict.get("transcript_hash"),
        "chunks": verdict.get("chunks"),
        "proposed": len(verdict.get("proposed", [])),
        "grounded": len(candidates),
        "rejected": len(rejected),
        "chunk_failures": len(verdict.get("failures") or []),
        "prompt_tokens": u.get("prompt_tokens", 0),
        "completion_tokens": u.get("completion_tokens", 0),
        "cost_usd": verdict.get("cost_usd", 0.0),
        **merged_note,
    }})
    return 0


if __name__ == "__main__":
    sys.exit(main())
