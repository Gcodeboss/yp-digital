# YP Digital

Turns a Kick stream into finished vertical clips, ready to post.

This is the handoff repo: the full system — clipping engine, dashboard with
the Yanchan branding and themes, installer, guides, and the system's state —
so a fresh clone on a new Mac looks and behaves exactly like the operator's
machine. Nothing that a machine can regenerate (stream footage, rendered
clips, the Python environment, `node_modules`) is here.

**→ Read [HOW-TO-GUIDE.md](HOW-TO-GUIDE.md).** That's the one you want for
day-to-day use. Everything below is for whoever is setting it up or working
on the code.

---

## Getting running

Requires **macOS**, **Python 3.9–3.12** (the built-in `/usr/bin/python3` is
fine — no Homebrew needed) and **Node.js 20+** (from [nodejs.org](https://nodejs.org),
the LTS installer is a double-click).

```
git clone https://github.com/Gcodeboss/yp-digital.git
cd yp-digital
./install.sh     # once — sets everything up and checks its own work
./start.sh       # opens the dashboard
```

If `install.sh` stops, it prints what's missing and the command to fix it. It's
safe to run again as many times as you like.

To check an install that isn't behaving:

```
tools/clip-pipeline/.venv/bin/python tools/clip-pipeline/doctor.py
```

## Sending it to someone

```
./package.sh
```

The working repo is about 37 GB — nearly all of it stream footage, rendered clips,
the Python environment and `node_modules`. `package.sh` copies out the program,
leaves the rest, and writes a zip you can actually send. The other machine unzips
it and runs `./install.sh`.

**About 23 MB.** The code is a small part of that — roughly 1.5 MB of TypeScript
and Python. The rest is `site/public`: brand imagery and the legacy site's
assets, which ship because the dashboard and the public site are one Next app and
the pages 404 their images without them.

## What's in here

| | |
|---|---|
| `tools/clip-pipeline/` | The clipping engine. Python. Finds moments, measures the layout, cuts, captions and renders. |
| `site/` | The dashboard. Next.js. Drives the engine and is where the work gets reviewed. See `site/DESIGN-CONSOLE.md` for its visual system and three themes. |
| `clips/library.json` | The store of record — every clip, its timing, tag, score, copy and review state. Merged across runs, never overwritten. |
| `HOW-TO-GUIDE.md` | The guide for using it. |
| `DESIGN.md` | Brand system. |
| `install.sh` / `start.sh` | Setup and launch. |

This repo also ships the system's state, so a fresh clone looks exactly like
the operator's machine: `clips/library.json` + `framing-locks.json` +
`strategy.md`, `streams/archive.json`, the per-stream transcripts, waveforms,
prepare state, and each stream's music map + calibration (the timeline's two
data lanes). What is deliberately NOT here: source VODs (`streams/*.mp4`,
~36 GB) and rendered clips (`clips/<date>/*.mp4`) — too large for git. Clip
cards and review pages render fully from the library; a clip's video plays
once its MP4 exists on the machine (re-rendered from the archive, or copied
over from the operator's Drive).

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

## Connecting an AI agent (Muse)

The dashboard exposes a local MCP endpoint at `http://localhost:3000/api/mcp`
— the same actions as the UI (archive streams, prepare, select, render,
review the library) for AI agents such as Muse. Connect Muse with the
Streamable-HTTP transport at that URL. Set `YP_MCP_TOKEN` in `site/.env` to
require a bearer token (paste the same value into Muse); leave it unset on a
single-operator Mac and the endpoint trusts localhost. The endpoint only
exists while the dashboard runs and only when `OPS_DASHBOARD=1`.

## Two things worth knowing

**Kick deletes a non-verified channel's VODs after about 30 days.** Archiving is
the only step with a deadline. Everything else works fine on a stream that's been
sitting on disk for a month; a stream that was never downloaded is gone.

`install.sh` offers to install a LaunchAgent (`com.yanchan.capture`) that runs
`capture.sh` at 04:00 daily and on wake, so this no longer depends on anyone
remembering. Declining is fine and leaves the manual path working. The scan tries
three ways into Kick in order — stdlib with a browser User-Agent, `curl_cffi` TLS
impersonation, then the local browser bridge — and records which one answered, so
a silent downgrade to the one that needs a human at the keyboard is visible rather
than invisible. **A scan older than three days reports its own staleness instead
of a count**, because a confident `0 at risk` over stale data is worse than no
number.

**The clip score is not a virality prediction.** It measures how strongly music is
playing and how much sustained vocal is in it — signal processing, not judgement.
It ranks moments within one stream and is not comparable across streams. It's good
at finding music and blind to a funny moment with no beat under it.

## Nothing leaves the machine

No auto-posting, no uploads, no external services. Two kinds of outbound request
exist, both to Kick and both about your own channel:

- `yt-dlp` fetching a VOD.
- `kick_api.py` asking `kick.com/api/v2/channels/<you>/videos` which VODs still
  exist — a public endpoint, no credentials, read-only. This runs on the daily
  capture schedule if you installed it, and when you press scan.

Export produces a folder for a person to post from.

One caveat, stated so it can never become a surprise. `discover_moments.py` can send a
stream's transcript to a language model to look for talk moments. **It is off, and it
is off by default**: it runs only when an API key is configured, and with no key it
skips and the batch is selected exactly as described above. Nothing in `install.sh`
sets a key. If you ever set one, this section stops being true — the transcript of the
stream, including anything said in it, is sent to that provider. `analyze.py` already
finds talk moments locally with no model involved, which is why the default is off.
