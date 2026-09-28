# YP Digital

Turns a Kick stream into finished vertical clips, ready to post.

This is the handoff repo: everything needed to install and run the clipping
system on a fresh Mac, and nothing that a machine can regenerate (no stream
footage, no rendered clips, no Python environment, no `node_modules`).

**→ Read [HOW-TO-GUIDE.md](HOW-TO-GUIDE.md).** That's the one you want for
day-to-day use. Everything below is for whoever is setting it up or working on
the code.

## Install

Requires **macOS**, **Python 3.9–3.12** (the built-in `/usr/bin/python3` is
fine — no Homebrew needed) and **Node.js 20+** (from [nodejs.org](https://nodejs.org),
the LTS installer is a double-click).

```
git clone https://github.com/Gcodeboss/yp-digital.git
cd yp-digital
./install.sh
```

`install.sh` checks what you have, builds the pipeline's Python environment
(about 250–300 MB to download, 5–15 minutes — leave it running), installs the
dashboard, creates the working folders, then runs its own preflight check. It
is safe to run as many times as you like. If it stops, it prints what's missing
and the command to fix it.

Then:

```
./start.sh       # opens the dashboard at http://localhost:3000
```

To check an install that isn't behaving:

```
tools/clip-pipeline/.venv/bin/python tools/clip-pipeline/doctor.py
```

No Homebrew and no system ffmpeg are required — ffmpeg comes bundled inside the
Python packages. Whisper's speech model (~480 MB) downloads itself the first
time you transcribe.

## Clipping from the terminal

```bash
cd tools/clip-pipeline
./clip.sh                          # newest local VOD, music-first, 4 clips
./clip.sh --file /path/to/vod.mp4 --count 6
./clip.sh --url https://kick.com/video/<id>
./clip.sh --file vod.mp4 --layout split    # only two-pane clips
```

Clips come out ready to post: captioned, watermarked, loudness-normalised
1080x1920 MP4s under `clips/<date>/`, plus a posting strategy doc. Run it in the
background — a 6-clip batch is roughly 4 minutes.

## Capturing streams

Kick deletes a non-verified channel's VODs after about 30 days, so archiving is
the only step with a deadline. `install.sh` offers to install a daily 04:00
capture check (`com.yanchan.capture` LaunchAgent); declining leaves the manual
path working:

```bash
tools/clip-pipeline/capture.sh            # scan + download what's at risk
```

## What's in here

| | |
|---|---|
| `tools/clip-pipeline/` | The clipping engine. Python. Finds moments, measures the layout, cuts, captions and renders. |
| `site/` | The dashboard. Next.js. Drives the engine and is where the work gets reviewed. See `site/DESIGN-CONSOLE.md` for its visual system and three themes. |
| `clips/library.json` | The store of record — every clip, its timing, tag, score, copy and review state. Merged across runs, never overwritten. |
| `HOW-TO-GUIDE.md` | The guide for using it. |
| `DESIGN.md` | Brand system. |
| `install.sh` / `start.sh` | Setup and launch. |
| `package.sh` | Builds a portable zip archive of this program. |

## How it fits together

The dashboard doesn't reimplement any clipping logic — it runs the same Python
scripts you could run by hand and reads the same files they write. `library.json`
is the single source of truth for both. That's deliberate: the CLI and the UI can
never disagree about what exists, and anything the dashboard can do remains
doable from a terminal if it breaks.

Work runs one direction:

```
archive  →  prepare  →  select  →  frame  →  caption  →  render  →  approve  →  export
```

## Two things worth knowing

**The clip score is not a virality prediction.** It measures how strongly music
is playing and how much sustained vocal is in it — signal processing, not
judgement. It ranks moments within one stream and is not comparable across
streams. It's good at finding music and blind to a funny moment with no beat
under it.

**A scan result older than three days reports its own staleness instead of a
count**, because a confident `0 at risk` over stale data is worse than no
number. The scan tries three ways into Kick in order — stdlib with a browser
User-Agent, `curl_cffi` TLS impersonation, then the local browser bridge — and
records which one answered.

## Nothing leaves the machine

No auto-posting, no uploads, no external services. The only outbound requests
are to Kick and both are about your own channel: `yt-dlp` fetching a VOD, and
`kick_api.py` asking which VODs still exist (a public, read-only endpoint, no
credentials).

Export produces a folder for a person to post from.

One caveat, stated so it can never become a surprise: `discover_moments.py` can
send a stream's transcript to a language model to look for talk moments. **It
is off, and it is off by default** — it runs only when an API key is configured,
and with no key it skips. `analyze.py` already finds talk moments locally with
no model involved.
