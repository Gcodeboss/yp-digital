import { execFile, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { INTERNAL_TOOLS_ENABLED } from "@/lib/internal-only";
import { getLibrary, type Clip , resolveRepoPath} from "@/lib/yp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..");
const PIPELINE = path.join(/*turbopackIgnore: true*/ REPO, "tools", "clip-pipeline");
const PY = path.join(/*turbopackIgnore: true*/ PIPELINE, ".venv", "bin", "python");
const runPy = promisify(execFile);
const CLIPS = path.join(/*turbopackIgnore: true*/ REPO, "clips");
const STATE = path.join(/*turbopackIgnore: true*/ REPO, "streams", "render");

/**
 * Render a stream's clips at approved quality, and report where the batch is.
 *
 * The dashboard could already produce a still and a half-size draft (preview.py
 * --draft), which is what a nudge-and-look loop needs and is not what ships. The
 * finished 1080x1920 clip only ever came out of `compose.py` on the CLI, so
 * "selected" and "on disk as an MP4" were two different states with no way to
 * cross between them from a screen. This crosses it.
 *
 * compose.py is the FULL-quality path — there is no --draft on it; the draft mode
 * lives in preview.py. One clip is 25-40s, so a 10-clip batch is several minutes:
 * the POST starts a detached job exactly as prepare/route.ts does and returns
 * immediately, and the GET says which clip it is on.
 *
 * Progress is compose.py's own stdout, not a second bookkeeping file invented
 * here. It already prints one line per clip as it starts it, one for a cached
 * skip, one for a failure, and a machine-readable summary at the end under
 * --json; the run's log is that stream, and this parses it. The only thing this
 * route records itself is what compose cannot know from inside the loop — the
 * pid, the denominator, and when it was started.
 */

type RenderState = {
  stream: string;
  clip: string | null;
  only: string | null;
  pid: number;
  total: number;
  startedAt: number;
  force: boolean;
  workDir: string;
  outputDir: string;
};

const stateFile = (stream: string) => path.join(STATE, `${stream}.json`);
const logFile = (stream: string) => path.join(STATE, `${stream}.log`);

/** compose.py names a clip `HHMMSS_tag` from its in-point. Mirrors fmt_hhmmss. */
function clipName(clip: Clip) {
  const s = Math.floor(clip.start);
  const stamp = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join("");
  return `${stamp}_${clip.context_tag}`;
}

/**
 * Is the recorded pid still ours to wait on? EPERM means the process exists and
 * belongs to someone else, which for our purposes is still "running" — treating
 * it as finished is how a second render gets launched over a live one.
 */
function alive(pid?: number | null) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

// compose.py's progress vocabulary, verbatim. Each of these is a line it already
// prints; nothing here asks it to print anything new.
const STARTED = /^\[(?:split|reframe)\](?:\s+\[[^\]]+\])?\s+(\S+)\s+\(/;
const CACHED = /^skip \(exists\) (.+?)\.mp4 \[/;
const FAILED = /^\s+FAILED (\S+): (.+?)(?:; continuing)?$/;
const NO_SPLIT = /^\[no-split\] (\S+) -> SKIP \((.+)\)$/;

type Phase = "rendering" | "done" | "cached" | "failed" | "skipped";

type Progress = {
  stream: string;
  scope: "stream" | "clip";
  clip: string | null;
  running: boolean;
  finished: boolean;
  total: number;
  done: number;
  remaining: number;
  current: string | null;
  failed: { name: string; reason: string }[];
  skipped: { name: string; reason: string }[];
  startedAt: number | null;
  error: string | null;
  tail: string[];
};

const IDLE: Progress = {
  stream: "",
  scope: "stream",
  clip: null,
  running: false,
  finished: false,
  total: 0,
  done: 0,
  remaining: 0,
  current: null,
  failed: [],
  skipped: [],
  startedAt: null,
  error: null,
  tail: [],
};

/**
 * Where the batch is, read from compose.py's log.
 *
 * A clip is "in flight" from the line that announces it until the next event —
 * compose prints the announcement before it hands the encode to ffmpeg and
 * prints nothing on success, so the next line settles the previous clip. The
 * final summary settles whatever was still open.
 */
async function progressFor(stream: string): Promise<Progress> {
  let state: RenderState | null = null;
  try {
    state = JSON.parse(await readFile(stateFile(stream), "utf8")) as RenderState;
  } catch {
    return { ...IDLE, stream };
  }

  let log = "";
  try {
    log = await readFile(logFile(stream), "utf8");
  } catch {
    /* the child may not have written a byte yet */
  }
  const lines = log.split("\n");

  const phase = new Map<string, { phase: Phase; reason?: string }>();
  const order: string[] = [];
  const mark = (name: string, p: Phase, reason?: string) => {
    if (!phase.has(name)) order.push(name);
    phase.set(name, { phase: p, reason });
  };
  let pending: string | null = null;
  const settle = () => {
    if (pending) mark(pending, "done");
    pending = null;
  };

  let summary: { rendered?: number; manifest?: number; failed?: string[] } | null = null;
  for (const line of lines) {
    let m: RegExpMatchArray | null;
    if ((m = line.match(STARTED))) {
      settle();
      pending = m[1];
      mark(pending, "rendering");
    } else if ((m = line.match(CACHED))) {
      settle();
      mark(m[1], "cached");
    } else if ((m = line.match(FAILED))) {
      if (pending === m[1]) pending = null;
      mark(m[1], "failed", m[2]);
    } else if ((m = line.match(NO_SPLIT))) {
      settle();
      mark(m[1], "skipped", m[2]);
    } else if (line.startsWith('{"rendered"')) {
      try {
        summary = JSON.parse(line);
      } catch {
        /* a torn write; the next poll gets the whole line */
      }
    }
  }
  if (summary) settle();

  const entries = order.map((name) => ({ name, ...phase.get(name)! }));
  const failed = entries
    .filter((e) => e.phase === "failed")
    .map((e) => ({ name: e.name, reason: e.reason ?? "ffmpeg exited non-zero" }));
  const skipped = entries
    .filter((e) => e.phase === "skipped")
    .map((e) => ({ name: e.name, reason: e.reason ?? "no usable DAW pane" }));
  const done = entries.filter((e) => e.phase === "done" || e.phase === "cached").length;
  const current = pending;
  const finished = summary !== null;
  const running = !finished && alive(state.pid);

  const tail = lines.map((l) => l.trimEnd()).filter(Boolean).slice(-8);

  // A run that stopped without printing its summary died: a traceback, a missing
  // module, a SystemExit from the calibration guard. Say so and hand over what it
  // actually printed rather than reporting a batch that is quietly 3 of 10.
  let error: string | null = null;
  if (!finished && !running) {
    error =
      tail.length > 0
        ? `compose.py stopped after ${done} of ${state.total}: ${tail[tail.length - 1]}`
        : `compose.py stopped after ${done} of ${state.total} without writing any output`;
  }

  return {
    stream,
    scope: state.clip ? "clip" : "stream",
    clip: state.clip,
    running,
    finished,
    total: state.total,
    done,
    remaining: Math.max(0, state.total - done - failed.length - skipped.length),
    current,
    failed,
    skipped,
    startedAt: state.startedAt,
    error,
    tail: error ? tail : [],
  };
}

/**
 * Which library clips actually exist as MP4s, and whether the file on disk is
 * still the file the clip's current definition produces.
 *
 * This is what keeps the export pack honest. build_export_pack.py copies
 * `clip["path"]`, skips a clip whose file is missing, and says so on stderr —
 * which the export route drops. So an approved clip that was never rendered used
 * to vanish from the pack in silence.
 *
 * `stale` is the second half of the same problem, found by running this route
 * against 2026-07-08. compose.py names its output from the clip's in-point and
 * tag, so retagging a clip in the dashboard changes the filename it renders to
 * (011032_beat -> 011032_singing) while the library keeps the original path as
 * its key. The old file stays on disk, so "rendered" is true and the pack copies
 * a clip that predates the retag. Reporting the name compose WILL use, next to
 * the one the pack WILL copy, is enough for a screen to say so out loud.
 *
 * Size, not just existence: `-movflags +faststart` leaves a large but undecodable
 * corpse when an encode is killed, and compose.py uses the same 100 KB floor
 * before it trusts a file on disk. It also reads the duration back, which this
 * does not — thirty ffmpeg probes do not belong in a poll.
 */
async function renderedState(clips: Clip[]) {
  return Promise.all(
    clips.map(async (c) => {
      const expected = c.date ? `clips/${c.date}/${clipName(c)}.mp4` : c.path;
      const [onDisk, current] = await Promise.all([
        stat(path.join(REPO, c.path)).catch(() => null),
        expected === c.path ? null : stat(path.join(REPO, expected)).catch(() => null),
      ]);
      return {
        path: c.path,
        expected,
        rendered: (onDisk?.size ?? 0) > 100_000,
        stale: expected !== c.path,
        currentRendered: expected === c.path ? (onDisk?.size ?? 0) > 100_000 : (current?.size ?? 0) > 100_000,
        bytes: onDisk?.size ?? 0,
        mtime: onDisk?.mtimeMs ?? 0,
      };
    })
  );
}

export async function GET(req: Request) {
  if (!INTERNAL_TOOLS_ENABLED) return new NextResponse(null, { status: 404 });
  const stream = new URL(req.url).searchParams.get("stream") ?? "";
  if (stream && !/^\d{4}-\d{2}-\d{2}$/.test(stream)) {
    return NextResponse.json({ error: "expected a stream date" }, { status: 400 });
  }

  const { clips } = await getLibrary();
  const mine = stream ? clips.filter((c) => c.date === stream) : clips;
  const files = await renderedState(mine);
  if (!stream) return NextResponse.json({ clips: files });
  return NextResponse.json({ stream, progress: await progressFor(stream), clips: files });
}

export async function POST(req: Request) {
  if (!INTERNAL_TOOLS_ENABLED) return new NextResponse(null, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as {
    stream?: string;
    clip?: string;
    force?: boolean;
  };
  const stream = String(body.stream ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stream)) {
    return NextResponse.json({ error: "expected a stream date" }, { status: 400 });
  }

  // Refuse rather than queue. Two compose.py runs on one stream write the same
  // output files and the same work/rendered.json, so the second would race the
  // first over half-written MP4s. A repeat run after this one finishes is cheap
  // and safe on its own: without --force compose skips every clip already on
  // disk and complete, so "render again" costs a duration probe per clip.
  const live = await progressFor(stream);
  if (live.running) {
    return NextResponse.json(
      {
        error: `a render is already running for ${stream} — ${live.done} of ${live.total} done`,
        progress: live,
      },
      { status: 409 }
    );
  }

  const { clips, batches } = await getLibrary();
  const batch = (batches[stream] ?? {}) as Record<string, string>;
  if (!batch.source || !batch.calibration || !batch.work_dir) {
    return NextResponse.json(
      { error: `${stream} has no recorded source or calibration — prepare the stream first` },
      { status: 409 }
    );
  }

  // One clip, or the batch. compose.py's --only matches substrings against the
  // clip name it derives from the in-point and tag, so the name has to come from
  // the RESOLVED clip: a creator who retagged a clip changed the name compose
  // will use, and the library path still carries the old one.
  let only: string | null = null;
  let clipPath: string | null = null;
  if (body.clip) {
    clipPath = String(body.clip);
    const abs = path.resolve(REPO, clipPath);
    if (!abs.startsWith(CLIPS + path.sep)) {
      return NextResponse.json(
        { error: "clip path must be inside the repo's clips/ directory" },
        { status: 400 }
      );
    }
    const clip = clips.find((c) => c.path === clipPath);
    if (!clip) return NextResponse.json({ error: `unknown clip: ${clipPath}` }, { status: 400 });
    if (clip.date !== stream) {
      return NextResponse.json(
        { error: `${clipPath} belongs to ${clip.date}, not ${stream}` },
        { status: 400 }
      );
    }
    only = clipName(clip);
  }

  const workDir = resolveRepoPath(batch.work_dir)!;
  const candidates = path.join(workDir, "candidates.json");
  const outputDir = path.join(CLIPS, stream);

  for (const [what, file, fix] of [
    ["the pipeline venv python", PY, "create it: python3 -m venv tools/clip-pipeline/.venv && .venv/bin/pip install -r requirements"],
    ["compose.py", path.join(PIPELINE, "compose.py"), "the clip pipeline is missing from this checkout"],
    // Through resolveRepoPath, like work_dir above and calibration below. Stored
    // relative since the portability migration, so a raw `access()` looked under
    // the server's cwd and refused to render a stream whose file was right there.
    ["the stream source", resolveRepoPath(batch.source)!, "re-capture the VOD, or fix batches[].source in clips/library.json"],
    ["the calibration", resolveRepoPath(batch.calibration)!, "run prepare_stream.py --stream " + stream],
    ["the candidate list", candidates, "select clips first — compose.py renders from candidates.json, not the library"],
  ] as const) {
    try {
      await access(file);
    } catch {
      return NextResponse.json({ error: `${what} is missing: ${file}. ${fix}` }, { status: 409 });
    }
  }

  // compose.py renders candidates.json; a clip drawn by hand in the timeline
  // exists only in the library, so it was invisible to the renderer — it could be
  // created, reviewed and approved, and then quietly have no MP4 behind it. Top
  // the candidate list up from the library first, so "New clip" on the timeline
  // is actually renderable. Idempotent: it adds only starts that are missing.
  try {
    await runPy(PY, [path.join(PIPELINE, "sync_candidates.py"), "--date", stream, "--json"], {
      cwd: PIPELINE,
      env: { ...process.env, CLIP_WORK: workDir },
      timeout: 30_000,
    });
  } catch (err) {
    // Not fatal: a stream whose clips all came from the selector needs nothing
    // added. Fall through to the check below, which reports the real problem.
    console.warn(`sync_candidates failed for ${stream}: ${String(err).slice(0, 200)}`);
  }

  // Anything still missing after the top-up is a genuine mismatch, so name it.
  let total = 0;
  try {
    const list = JSON.parse(await readFile(candidates, "utf8")) as { start: number }[];
    total = list.length;
    if (only && clipPath) {
      const clip = clips.find((c) => c.path === clipPath)!;
      const hit = list.some((c) => Math.abs(c.start - clip.start) < 0.05);
      if (!hit) {
        return NextResponse.json(
          {
            error:
              `no candidate in this stream starts at ${clip.start.toFixed(1)}s, so compose.py ` +
              `has nothing to render for ${clipPath}. Clips created in the timeline are not in ` +
              `candidates.json and could not be added — re-run selection for ${stream}.`,
          },
          { status: 409 }
        );
      }
      total = 1;
    }
  } catch (err) {
    return NextResponse.json(
      { error: `could not read ${candidates}: ${String(err).slice(0, 200)}` },
      { status: 409 }
    );
  }

  const args = [
    path.join(PIPELINE, "compose.py"),
    "--source", resolveRepoPath(batch.source)!,
    "--calibration", resolveRepoPath(batch.calibration)!,
    "--candidates", candidates,
    "--output-dir", outputDir,
    "--fullcam-mode", "reframe",
    "--stream", stream,
    "--json",
  ];
  if (only) args.push("--only", only);
  if (body.force) args.push("--force");

  await mkdir(STATE, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  // The log IS the progress report, so it is opened before the child and truncated
  // per run — a previous run's lines would otherwise be counted as this one's.
  const fd = openSync(logFile(stream), "w");
  try {
    const child = spawn(PY, args, {
      cwd: PIPELINE,
      detached: true,
      stdio: ["ignore", fd, fd],
      // CLIP_WORK: compose.py resolves its work dir, its transcript and
      // work/rendered.json from it. Without it a second stream would write its
      // manifest over the first stream's, which is the bug library.py exists for.
      //
      // PYTHONUNBUFFERED: python block-buffers stdout when it is a file rather
      // than a terminal, so without this the entire log — every progress line —
      // lands in one flush at exit. The first version of this route did exactly
      // that: the GET reported 0 of 10 for the whole run and then 10 of 10, which
      // is a spinner with extra steps. Line-buffered output is what makes
      // "rendering 4 of 10" a true statement.
      env: { ...process.env, CLIP_WORK: workDir, PYTHONUNBUFFERED: "1" },
    });
    child.unref();

    const state: RenderState = {
      stream,
      clip: clipPath,
      only,
      pid: child.pid ?? 0,
      total,
      startedAt: Date.now(),
      force: Boolean(body.force),
      workDir,
      outputDir,
    };
    await writeFile(stateFile(stream), `${JSON.stringify(state, null, 2)}\n`, "utf8");
    return NextResponse.json({ started: true, stream, clip: clipPath, total, pid: child.pid });
  } catch (err) {
    return NextResponse.json(
      { error: `could not start ${PY}: ${String(err).slice(0, 300)}` },
      { status: 500 }
    );
  } finally {
    closeSync(fd);
  }
}
