# YP Digital Dash — How To

Turns a Kick stream into finished vertical clips, ready to post.

You give it a stream. It finds the moments where you're actually cooking, cuts them
to 9:16 with your webcam on top and Ableton underneath, burns in captions, and puts
them in front of you to approve. Nothing leaves your machine and nothing posts
itself — the last step is always you.

---

## Before you start

You need three things installed once. If you don't have them, the installer tells
you the exact command to run.

| | Why |
|---|---|
| **Python 3.9+** | runs the clipping engine |
| **Node 20+** | runs the dashboard |
| **yt-dlp** | downloads the VOD from Kick |

You also need **disk space**. Each stream is around **2.8 GB**, and the tool keeps
the original because clips are cut from it. A weekly stream is roughly **145 GB a
year**, and **nothing here ever deletes a stream** — not after clipping, not after
exporting. That is deliberate: a deleted VOD cannot be re-downloaded once Kick has
dropped it. It does mean the drive fills up on a schedule you can predict, so plan
to move old streams onto an external disk once a year rather than being surprised.

Streams on an external disk still work. The dashboard only looks inside the
project folder by default, so tell it where else to look:

```
export YP_MEDIA_DIRS=/Volumes/Archive/yanchan:/Volumes/Other/streams
./start.sh
```

Colon-separated, absolute paths, set before starting. Without it, pointing the
Streams screen at a file on another drive is refused — correctly, but with a
message that does not say this is the fix.

---

## Install it

Open Terminal, go to the folder, and run:

```
./install.sh
```

It sets everything up and finishes by checking its own work. If a check fails it
says what's missing and how to fix it. Run it again after fixing — it's safe to
run as many times as you like.

## Start it

```
./start.sh
```

That opens the dashboard in your browser. Leave the Terminal window open while
you're using it — closing it stops the dashboard.

The first time it opens, a **How this works** panel appears. That's the same
workflow described below. Close it with Escape; reopen it any time with the **?**
button, bottom right.

---

## The workflow

Work moves in one direction. A stream has to be brought in before it can be
clipped, framed before it's captioned, and approved before it can leave.

### 1 · Streams — bring the stream in

**Most of the time you do nothing here.** If you said yes to automatic capture
during the install, the Mac checks Kick every day at 04:00 and downloads anything
new on its own — including on a day it was asleep at 04:00, in which case it runs
when you next open the lid. New streams simply appear on this screen already
archived.

To bring one in by hand: paste the Kick link, or point it at a file already on
your machine. If a stream is showing as at risk, use the **Archive now** button on
its row instead of copying a link — the row already knows the exact video Kick is
serving, and a link typed by hand can point at a different video record for the
same broadcast, which fails with a confusing 404.

**Why any of this matters.** Kick deletes a non-verified channel's VODs after
about **30 days**. Once a stream is gone it can't be clipped, ever.

**Read the top of this screen before you trust the number.** If it says the scan
is out of date, then *what is at risk is unknown* — and the screen shows a dash
rather than a count. It will not tell you "0 at risk" from an old scan, because
that is exactly what it did on 2026-09-06 while three streams sat uncaptured, two
of them a fortnight from deletion. A green line at the top means the count below
it is current.

Downloading takes a few minutes on a decent connection.

**Done when:** the stream reads `ready` instead of `not prepared`.

> Preparing runs five passes — extracting the audio, measuring where the webcam
> and Ableton sit in frame, building the music-and-vocal map, drawing the
> waveform, and making a copy the browser can actually play. Two or three
> minutes. You can leave it running.
>
> If a stream has no Ableton in it at all — an IRL walk, a performance, anything
> filmed on one camera — that is a supported case, not a failure. It reads
> `single-pane · no DAW on screen`, and clipping, framing and rendering all work
> normally on it.

### 2 · Timeline — get your clips

Open the stream. You'll see five lanes stacked on one time axis:

| Lane | What it shows |
|---|---|
| **Stream time** | the ruler |
| **Audio** | the waveform for the whole stream |
| **Music map** | **gold** where you're singing, **grey** where it's instrumental |
| **Transcript** | where words were spoken |
| **Clips** | the clips you've made |

Two ways to work:

- **Let it find them.** Hit *Find clips* and it picks the strongest music moments,
  spread out across the stream so you don't get eight clips off one beat.
- **Do it yourself.** Scrub to a moment, press **Mark in**, then **New clip**.

Either way you can drag a clip's edges to adjust it.

**Keys:** `space` play · `←` `→` one second · `shift` + `←` `→` ten seconds ·
`,` `.` one frame · `i` `o` set in and out · `[` `]` zoom

**Mirror.** If you're facing the wrong way for the shot, the **mirror** toggle on
the transport flips the camera horizontally. It's a per-stream setting, because a
webcam is mirrored for a whole session far more often than for one clip — but you
can override it on a single clip and that choice survives re-rendering. It only
ever flips the camera; the Ableton pane is never mirrored, since mirrored track
names are unreadable. Captions and the kick.com plate stay the right way round.

**Done when:** the clips lane holds the moments you want.

### 3 · Framing — check the crop

The tool measures where your webcam and Ableton window sit and crops to them. It
gets this right most of the time. When it doesn't, fix it here — drag the boxes,
then **lock** it so a re-render can't move it again.

On a stream with no Ableton in it, this screen says `single-pane · no DAW on
screen` and tells you why on hover. That is the correct reading of a
one-camera stream, not a measurement that failed, and the crop controls work the
same way.

**Check this before rendering, not after.** Every clip takes 25-40 seconds to
render. On a ten-clip batch that's about five minutes, and a bad crop found
afterwards costs you the whole five minutes again.

**Done when:** every clip is framed, and anything you set by hand is locked.

### 4 · Captions — fix what it misheard

The captions are burned in from the transcript, so if a word is wrong here it's
wrong in the video. Names and lyrics are where it slips most.

If a stream has no transcript yet, hit **Transcribe this stream**. It takes
**30-60 minutes** and runs in the background — keep working while it does.

**Done when:** the lines say what you actually said.

### 5 · Review — approve and export

Every clip, its hook, its tag and its length in one list. Mark each one
**Approved**, **Needs edit**, or **Rejected**, then **Build export pack**.

**Watch it before you approve it.** The ▶ on a rendered clip plays the actual MP4
under its own row. Approving from a filename and a score is guessing.

**Fix the words here.** Click a hook or a caption to edit it in place. What you
type survives re-rendering — the pipeline will not overwrite it on the next run.
A clip with no hook says so in sienna; leave it and the export pack falls back to
a generic per-tag line.

**Each clip says which selector found it.** `music` means the audio got loud and
tonal there — a narrow, reliable claim. `speech` means a transcript heuristic
thought the talking was worth hearing, which is a bigger claim and wrong more
often. `hand` means you drew it yourself. Give them different amounts of trust.

Once the pack is built it appears at the top of the screen with its clip count and
size. **Download** saves it as a single zip through the browser; **Reveal** opens
the folder in Finder. If nothing is approved yet, the button offers to build the
pack anyway so you can see the shape of it.

The pack is what you hand to whoever posts: the finished MP4s, the caption text,
the hooks and hashtags, and the order to post them in.

**Nothing posts from here.** That's deliberate. The pack is a handoff to a person.

---

## What the numbers mean

**Be careful with the score.** It measures how strongly music is playing and how
much sustained singing is in it. It does **not** predict how well a clip will do.
It's useful for ranking moments *inside one stream* — it is not comparable between
streams, and a 14 is not "more viral" than an 11, it's just more musical.

Nothing in the tool has watched a video and formed an opinion. The clip picking is
signal processing: it listens for a kick drum, a steady pulse, and a held sung
note. That's why it's good at finding you at the desk making music, and blind to
the funny thing you said with no beat under it. Those you still have to find
yourself.

**Colours mean one thing each:**

- **Amber** — now. The playhead, and whatever's selected.
- **Gold** — singing.
- **Warm grey** — beat, instrumental.
- **Sienna** — something wants your attention.
- **Mint** — a machine check passed.

Anything else is deliberately colourless, so when you see colour it means something.

---

## How long things take

Measured on a 2h45m stream, on an M-series Mac.

| | |
|---|---|
| Download a VOD | a few minutes |
| Prepare a stream | 2-3 minutes |
| Find clips | seconds |
| Full transcript | **30-60 minutes** (background) |
| Render one clip | 25-40 seconds |
| Render a batch of 10 | about 5 minutes |

The transcript is the slow one. Start it and go do something else.

---

## When something goes wrong

| What you see | What it means |
|---|---|
| Dashboard won't open | `./start.sh` isn't running, or the Terminal window was closed. Start it again. |
| Page says 404 | Started the wrong way — use `./start.sh`, not `npm run dev`. |
| "run ./install.sh first" | The install didn't finish. Run it and read the last few lines. |
| Stream won't download | yt-dlp is missing or out of date, or the Kick link is wrong. Run `./install.sh` again — it checks. |
| Timeline is empty | The stream isn't prepared. Go back to Streams. |
| Transcript lane empty | No transcript yet. Captions screen → Transcribe this stream. |
| Crop is wrong on every clip | Fix it once on the Framing screen and **lock** it, then re-render. |
| Clip preview won't play | The MP4 hasn't been rendered yet. Render from the Review screen. |
| "the scan is stale" on Streams | Nothing has been able to reach Kick for 3+ days. Usually the Mac was off. Run `./tools/clip-pipeline/capture.sh`, or just leave it — the next 04:00 run will clear it. |
| A stream on an external drive is refused | Set `YP_MEDIA_DIRS` to that drive before `./start.sh` — see **Before you start**. |
| A pasted Kick link 404s | One broadcast can have more than one video record. Use **Archive now** on the at-risk row instead of a copied link. |
| Nothing is downloading overnight | The daily capture wasn't installed, or isn't loaded. `tools/clip-pipeline/doctor.py` says which, and how to fix it. |

Still stuck: run `tools/clip-pipeline/doctor.py`. It checks every part of the
install and tells you which piece is missing.

---

## What it won't do

Worth knowing up front so nothing is a surprise.

- **It won't post for you.** By design. It gets clips to approved and hands them over.
- **It won't tell you what will go viral.** It finds where the music is. Judgement is yours.
- **It won't find your funny moments reliably.** The music selector needs a beat.
  There is a second, transcript-based selector that does find talking moments and
  it produced every clip of the 2026-07-31 IRL stream — but it is a rougher
  instrument than the music one. The rest you clip by hand, which the timeline is
  built for.
- **It won't work on a stream Kick has deleted.** Archive first, always.
- **It doesn't send anything anywhere.** Everything runs on your machine. There is one
  optional feature that would — sending a transcript to a language model to look for
  talk moments — and it is off unless someone sets an API key. Nothing in the install
  sets one.

---

## One rule worth keeping

Archive every stream the week it happens. Everything else here can be done later —
clipping, framing, captions, all of it works on a stream sitting on your drive a
month from now. But a VOD you didn't download is gone, and no part of this tool
can get it back.
