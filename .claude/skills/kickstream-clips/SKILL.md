---
name: kickstream-clips
description: Turn a Kick stream VOD into finished, captioned vertical 9:16 clips in the approved Yanchan format (webcam top / Ableton bottom split, or single-pane podcast layout for talk scenes). Use when Gobbe drops a new stream VOD and asks to clip it, make vertical clips, make shorts/TikToks/Reels from a stream, or re-run the clip pipeline. Also use for questions about the clip pipeline in tools/clip-pipeline.
---

# Kickstream Vertical Clip Pipeline

## Capture first — Kick deletes VODs after ~30 days

This is the part with a deadline. The first real scan (2026-08-18) found **seven
streams on Kick that nobody had downloaded**, the oldest three days from deletion.
The streams we hold from June and July survive only because someone pulled them by
hand.

```bash
.venv/bin/python scan_kick.py           # ask Kick what it still holds
.venv/bin/python ingest.py --status     # what is safe, what is on a clock
.venv/bin/python ingest.py --backfill   # download at-risk streams, most urgent first
./capture.sh --install                  # the cron line for a daily check
```

`kick.com/api` refuses a plain CLI request (403, Cloudflare). The channel's own
browser session is not blocked, so `scan_kick.py` takes the scan through the local
browser bridge. **The download does not need that** — each VOD record carries an
HLS URL on `stream.kick.com` that serves the CLI directly at 720p30, so no Kick
developer credentials are required.

`streams/archive.json` is the record: merged, never overwritten. A stream Kick
stops listing is not deleted from it — if we hold it, it stays `archived`; if we
never captured it, it becomes `unrecoverable` and is reported. A download counts
only once the file reads back at the duration Kick advertised.

Then clip it by date: `./clip.sh --stream 2026-07-22`.


Produces finished 20–30s vertical clips (1080x1920) with burned-in captions, plus a
posting strategy doc. All code lives in `tools/clip-pipeline/` and runs with the
project venv: `tools/clip-pipeline/.venv/bin/python` (Python 3.9 — whisper, opencv,
imageio-ffmpeg, scipy, yt-dlp already installed). Never use system python or
`pip install` into it without asking.

**Clips come out ready to post.** They are captioned, watermarked, and loudness-
normalised. There is no separate captioning step any more.

## One command

```bash
cd tools/clip-pipeline
./clip.sh                                  # newest local VOD, music-first, 4 clips
./clip.sh --file /path/to/vod.mp4 --count 6
./clip.sh --url https://kick.com/video/<id>
./clip.sh --file vod.mp4 --layout split    # only two-pane clips
./clip.sh --file vod.mp4 --select speech   # old speech-ranked path (slow: full transcript)
```

`clip.sh` derives a per-VOD work dir from the source filename, so several streams
can be processed without clobbering each other and without setting `CLIP_WORK`.

**Run it in the background.** A 6-clip batch is roughly 4 minutes and will blow a
2-minute foreground timeout mid-encode, leaving a truncated MP4.

| Stage | ~time (2.7h VOD) |
|-------|------------------|
| extract audio | 60s |
| calibrate | 40s |
| detect music | 30s |
| select (+layout probe) | 5s + ~1s/candidate |
| transcribe windows | 20s |
| transcribe full (`--select speech`) | 30-60 min |
| compose | **25-40s per clip** |
| strategy + qa | ~5s per clip |

Stages, all cached and resumable:

1. `extract_audio.py` — 16 kHz mono WAV → `work/audio.wav`
2. `calibrate.py` — measures the stream's layouts → `work/calibration.json`
3. `detect_music.py` — per-second music map from kick-band pulse periodicity,
   full-band beat periodicity and chroma tonality, **plus a per-second sustained-
   vocal curve measured from the audio** → `work/music.json`
4. `select_music_clips.py` — candidates from the music map, ranked on music
   strength blended with vocal presence, **layout resolved here** so the first
   render is the final one → `work/candidates.json`
5. `transcribe_windows.py` — faster-whisper over just those windows (seconds, not
   an hour) → `work/transcript_windows.json`
6. `compose.py` — one ffmpeg pass per clip: cut → crop → stack → captions → loudnorm
   → encode → `work/rendered.json`
7. `build_strategy.py` — merges the batch into `clips/library.json`, then writes
   `clips/<date>/strategy.md` (this batch), `clips/strategy.md` (roll-up across
   every stream) and `clips/by-context/<tag>/` symlinks
8. `qa_report.py` — mechanical verification → `work/qa.json` (non-zero exit on fail)

`--select speech` swaps steps 3-5 for `transcribe.py` + `analyze.py` (full
transcript, 30-60 min).

## The approved output format

- **Canvas:** 1080x1920, 30 fps, SAR 1:1, `libx264 -crf 18 -preset slow`, AAC 192k
  @ 48 kHz, `+faststart`, audio normalised to −14 LUFS.
- **Split layout** (scenes with a usable Ableton pane):
  TOP 45% (1080x864) webcam inset, BOTTOM 55% (1080x1056) Ableton arrangement only,
  `vstack`. Fixed rectangles, no zoom, no face tracking. The bottom rect
  is measured per clip by `layout.daw_content_rect()` — see below.
- **Single-pane layout** (camera-dominant or full-camera scenes): the camera fitted
  full-width in the upper-middle over a blurred fill, captions in the lower third.
  A 16:9 two-shot cannot be cropped to 9:16 without cutting someone out, so it isn't.
- **Captions:** Arial Black uppercase, white with black outline, active word in
  Warm Amber `#F58804` (DESIGN.md's hero accent — *not* Kick green; clips get
  reposted off-platform where Kick branding means nothing).
- **Bottom mark:** the neon `kick.com/yanchanproduced` plate
  (`assets/kick-watermark.png`, `--watermark-image`), 520 px wide, centred, with its
  **bottom edge at y=1890** — where the logo used to sit, just above the loading
  bar. `--watermark-bottom` moves it; `--watermark-width` resizes it. Plus an amber loading
  bar. The Yanchan Produced logo is **off**; `--logo` brings it back at its old
  placement (300 px, 72% opacity, y=1737). `--watermark "TEXT"` and `--mark "TEXT"`
  add optional text lines at y=1858 / y=1792, both empty by default.

  This changed four times on 2026-07-28 — logo, then "LIVE ON KICK" instead of the
  logo, then no "LIVE ON KICK", then back to the logo — and twice more on
  2026-08-17, to a text URL and then to the neon plate. Every element
  (`--watermark-image`, `--logo`, `--mark`, `--watermark`) is independently
  switchable, so the next change is a flag rather than an edit.
  **Each image overlay is another ffmpeg input, and `-t` must stay after every
  `-i`.** Placed between inputs it binds the overlay instead of the video and the
  encode runs to the end of the VOD — that produced a 213 MB 30-second clip once.

### Where the mark sits, and what that costs

The plate sits at the bottom, y=1730-1890 — Gobbe's call on 2026-08-17, after
seeing it at y=1500: *"It should be placed at the bottom where the logo was, not so
high up."*

Know the trade-off before moving it back. Every platform parks its own UI over the
bottom of a 9:16 video: **Reels' caption block runs to ~350 px, TikTok's to ~320
plus a 140 px right rail, Shorts' to ~230**, and the top ~110 px is also busy. At
y=1890 the plate is inside that band, so on a feed it can be partly covered by the
caption overlay — it is never cropped off the frame itself, which is the thing that
was asked for. `--watermark-bottom 1500` clears every platform's UI if that ever
matters more than the placement.

The loading bar sits below it at y=1906 and is decorative, so losing it under a
caption costs nothing.

### The supplied plate had no alpha

`clips/yanchan produced watermark.png` ships with the transparency checkerboard
**baked in as pixels** (two neutral greys, 98 and 170; alpha is 255 everywhere).
The text keys out of that cleanly — solid letters reach chroma 250 while the neon
glow over the checker only reaches ~20 — but the 2 px frame does not: where it
crosses a light square its chroma drops below any usable threshold, so it keys as a
*dashed* line and its glow keys as a *checkered* halo. Trying to un-mix the
checkerboard is guesswork because the squares are not on an exact pixel grid
(period ~19.8 px). So `assets/kick-watermark.png` is built by taking the real text
from the asset and redrawing the frame and glow at the measured position
(rows 116-121 / 550-555, cols 18-23 / 1561-1566). Re-derive it the same way if the
source art changes. `test_guards.py` does not cover this; the check lives as a
  comment in `render()`.

Both layouts are produced automatically per clip. Nothing is silently dropped —
pass `--fullcam-mode skip` if you deliberately want only split clips.

## Where the output goes

| Path | What it is |
|------|-----------|
| `clips/<date>/*.mp4` | the finished clips for one stream |
| `clips/<date>/strategy.md` | that batch: inventory, post copy, cadence |
| **`clips/library.json`** | **store of record** — every clip from every stream |
| `clips/strategy.md` | roll-up index across all streams |
| `clips/by-context/<tag>/` | symlinks grouped by tag, across all streams |

`library.json` is **merged**, never overwritten. A pipeline re-run refreshes the
mechanical fields (path, timing, layout, tag, score) and preserves the two blocks
a human owns:

- `copy` — the per-clip hook / alt / caption written with `set_copy.py`
- `status` — `new` / `approved` / `needs_edit` / `scheduled` / `posted` / `rejected`

That is what makes approvals survive a re-render, and it is why the dashboard at
`/dashboard` reads `library.json` rather than scraping the markdown. Before this,
`build_strategy.py` wrote one global `strategy.md` and `rmtree`'d `by-context/` on
every run, so processing a second stream erased the first stream's paperwork.

**Per-clip copy is not the pipeline's job.** `tags.py` can only hold two hook
lines per *tag*, so every "beat" clip in a batch shipped an identical hook. Write
real hooks from each clip's own transcript excerpt with `set_copy.py`; the docs
render whatever is in the library.

## What goes in the bottom pane (read before touching the crop)

The camera-free part of the arrangement is only 217-385 px wide, against a pane
that is 1080x1056 and nearly square. Cropping `arrangement_left … webcam_left` over
the full `daw_top … daw_bottom` therefore produced the two things that made clips
look wrong on 2026-08-17: **dark letterbox bars** down both sides (22% of the pane
each) and **empty lanes** filling the bottom ~40%, because the lower half of an
Ableton arrangement is usually unloaded tracks. The music ended up as a narrow strip
in the middle of a mostly empty frame.

`layout.daw_content_rect()` fixes both by measuring, per clip, what is worth showing:

1. Find the rows carrying **coloured clips** (saturation > 60 across >12% of the row)
   inside the camera-free arrangement. That drops the empty lanes.
2. Reach the pane's aspect from whichever side is short:
   - too tall → extend **left** into Ableton's browser, at most `MAX_BROWSER_BLEED`
     (90 px). That is the browser's blank right margin; going further starts showing
     file names, which is what made an earlier attempt look like a file manager.
   - too wide → give height back toward the calibrated bounds, 35% up / 65% down,
     since Ableton adds tracks top-down. Without this, a clip with two loaded tracks
     rendered as a thin band across a tall pane.

Across the 28-clip batch this lands every split clip between 0.79 and 1.15 aspect
(pane is 1.02) at 2.3-3.5x magnification, with 0-90 px of browser showing.

## How the layout is decided (read this before touching constants)

The webcam inset is **not** a stream constant. Yanchan resizes it several times per
stream — the 2026-07-03 VOD contains four stable layouts (`x` = 689 / 715 / 747 / 817).
So:

- `calibrate.py` samples ~60 frames across the whole VOD, proposes an inset rect from
  each, **rejects** anything that cannot physically be a webcam inset, clusters the
  survivors, and records the clusters plus the arrangement's left edge.
- `compose.py` then measures the inset **per clip** from that clip's own frames and
  validates it against the same gates. If no valid inset is found — camera-dominant
  scenes, where a split would be camera in both panes — it falls back to the
  single-pane layout.

The validity gates are the important part. Without them the detector locks onto the
acoustic-panel edge inside the camera picture and returns a ~200px slice, which then
gets magnified 5x:

| Gate | Range |
|------|-------|
| aspect `w/h` | 1.30 – 2.10 |
| width | ≥ 0.28 × frame width |
| left edge `x` | 0.50 – 0.75 × frame width |
| top edge `y` | ≤ 0.04 × frame height |

`calibrate.py` **fails loudly** if fewer than 8 proposals survive rather than guessing.

## CLI reference

| Script | Common flags | Purpose |
|--------|--------------|---------|
| `clip.sh` | `[--url \| --file]` `--select` `--count` `--layout` `--force` | **Front door.** Everything, per-VOD work dir |
| `run_pipeline.sh` | `<vod.mp4> <YYYY-MM-DD>` `[--select] [--count]` | Same stages, explicit source + date |
| `detect_music.py` | `--threshold` `--force` | Per-second music/singing map |
| `select_music_clips.py` | `--count` `--kind` `--layout` `--source` | Music-first candidates |
| `transcribe_windows.py` | `--model` `--margin` | Transcribe only the chosen windows |
| `qa_report.py` | `--json` | Verify a batch; non-zero exit on failure |
| `fetch_vod.py` | `--url` `--file` `--output-dir` | Locate or download a VOD (pinned to 720p30) |
| `extract_audio.py` | `--source` | 16 kHz mono WAV |
| `transcribe.py` | (env vars only) | Whisper with chunk resume |
| `analyze.py` | `--max-candidates <n>` | Speech-ranked selection (needs a FULL transcript) |
| `calibrate.py` | `--source` `--samples` `--force` | Measure stream layout |
| `compose.py` | `--source` `--only a,b,c` `--limit` `--hook` `--emph` `--force` `--fullcam-mode` | Render finished clips |
| `build_strategy.py` | `--date` `--source-name` | library + strategy docs + by-context links |
| `set_copy.py` | `--path` `--hook` `--alt` `--caption` `--stdin` | write per-clip post copy into the library |
| `posters.py` | `--at` `--width` | one base64 poster frame per clip, for a review pack |
| `scan_kick.py` | — | ask Kick what VODs it still holds → `kick_scan.json` |
| `ingest.py` | `--import-scan` `--status` `--backfill` `--verify` | capture streams before Kick deletes them |
| `capture.sh` | `--install` | scheduled daily capture |
| `transcripts.py` | `--store` `--fix` `--export` | durable transcripts and corrections that stick |
| `settings.py` | (module) | selection guardrails, per stream |
| `framing.py` | (module) | creator rect → scene lock → measurement |
| `safe_areas.py` | — | which platforms cover a burned-in element |
| `build_export_pack.py` | `--date` `--include-pending` | approved clips + copy + posting order |

Env vars: `WHISPER_MODEL` (default `small`), `WHISPER_FALLBACK_MODEL` (`base`),
`WHISPER_CHUNK_SECONDS` (`900`).

## Verifying a batch

**Read `work/qa.json`. Do not extract frames.** `qa_report.py` runs as the last
pipeline stage and mechanically checks every clip: dimensions, fps, sample rate,
first PTS, duration vs the requested cut, caption presence, loudness, dead/blank
panes, and whether the bottom pane actually looks like a DAW (the camera-bleed
check). It exits non-zero if anything fails, so a failing batch stops the runner.

```bash
.venv/bin/python qa_report.py            # human summary
.venv/bin/python qa_report.py --json     # one line
```

Only look at pixels when a check fails — `work/contact.jpg` is one strip covering
the whole batch, so that is one image rather than one per clip.

The camera-bleed check is structural, not colour-based: Ableton is a grid (long
axis-aligned edges, large flat fills) and a room is not. DAW panes score 0.61-0.85,
camera panes 0.46-0.49, threshold 0.55. Colour-based versions were tried and
rejected — hue alone failed a good clip at 21.9% because Ableton audio clips are
often tan, and warm-and-moving scored a deliberately-bled test clip *lower* than
every good clip.

## Singing vs beat is measured from the audio, not the transcript

The `singing` / `beat` tag decides the hooks, hashtags and platform in the batch
doc, so getting it wrong ships wrong copy.

It used to be decided by "does the transcript have words here?", which failed
twice over. On the fast path the transcript is written **after** selection, so at
decision time there was none and every segment fell through to `beat` — the Kiki
Rowe *vocal session* produced 100% beat clips. And where a transcript did exist it
measured the wrong thing: someone is talking 89% of the 2026-07-03 stream, so
"has words" is almost always true and separates nothing.

`detect_music.sung_note_fraction()` now measures singing directly from the audio:
HPSS-lite suppresses the drums, then it reports the share of frames sitting inside
a **held** pitch (within 0.6 of a semitone over 250 ms) while the voice is audible
against the mix. Speech pitch moves constantly and dies inside 200 ms; a sung note
is held.

Validated against who was actually in the room, which is real ground truth:

| Stream | in music | outside music | tagged vocal |
|--------|----------|---------------|--------------|
| 2026-07-03 Tresor (vocalist) | 0.50 | 0.27 | 79% of segments |
| 2026-07-08 Kiki Rowe (vocalist) | 0.42 | 0.29 | 29% |
| 2026-06-26 solo beat-making | 0.31 | 0.32 (no lift) | 12% |

Segment threshold is `--sung-threshold` (0.45). `test_guards.py` checks the
detector separates a held note from noise rather than just checking it runs.

## Gotchas

- **Stale cache is the #1 failure mode.** Every stage reuses `work/`. The runners
  archive it automatically when `work/source.txt` doesn't match, but if you invoke
  scripts directly for a new VOD, move or delete `work/` first — including
  `calibration.json`, which is pixel coordinates for one specific stream.
- `work/transcript.json` (full) and `work/transcript_windows.json` (just the clip
  windows) are different things and are now marked with a `coverage` field.
  `analyze.py` refuses the windowed one — scoring a whole stream from ~90 words
  produces plausible-looking nonsense. `detect_music.py` no longer reads a
  transcript at all (see below).
- Adding a new context tag means adding it to `tags.py`. `build_strategy.py` exits
  non-zero if a manifest contains a tag with no copy, rather than silently
  shipping "One of those moments you had to clip".
- VOD filenames contain `%20` and characters like `⧸` (U+29F8) — literal filename
  characters, not URL encoding. Always quote paths.
- `fetch_vod.py` is pinned to 720p30 on purpose. If Kick starts serving higher and you
  want it, re-run `calibrate.py --force` deliberately — every layout coordinate is in
  source pixels and `compose.py` refuses to run on a mismatched frame size.
- `clips/by-context/<tag>/` are symlinks into the finished clips, rebuilt from
  the whole library. If you move or delete `clips/<date>/`, re-run
  `build_strategy.py`.

## Known ceiling (worth raising with Gobbe)

The source is 720p and the OBS webcam **overlaps the Ableton arrangement** (camera at
`x ≥ 747, y ≤ 325` over an arrangement at `x 385…1035, y 60…520`). The bottom pane can
therefore only show the camera-free left portion of the arrangement, upscaled ~2.2x.
Three upstream fixes, in order of payoff:

1. Move the webcam off the arrangement (bottom-right, over the empty device area).
2. Record locally at 1080p+ — source resolution is the biggest lever on sharpness.
3. Best: record webcam and screen as **separate OBS sources**. The compositor could
   then use two clean full-res inputs — no crop conflict, no upscale, no calibration.

## Definition of done

1. Clips in `clips/<date>/` probe at 1080x1920 / 30 fps / AAC 48 kHz, `start: 0.000000`.
2. One frame per layout type visually checked (see Verifying).
3. One caption spot-checked against the transcript.
4. `clips/library.json` and both strategy docs regenerated; clip count matches the
   number of files.
5. Report: clips produced, how many used each layout, and any constant that had to
   change — flag constant changes for Gobbe's review.
