import { execFile } from "node:child_process";
import { access, constants, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { INTERNAL_TOOLS_ENABLED } from "@/lib/internal-only";
import { FILES, getLibrary , resolveRepoPath} from "@/lib/yp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..");
const PIPELINE = path.join(/*turbopackIgnore: true*/ REPO, "tools", "clip-pipeline");
const PY = path.join(/*turbopackIgnore: true*/ PIPELINE, ".venv", "bin", "python");

const run = promisify(execFile);

/**
 * Pick this stream's clip candidates, and put them where the dashboard looks.
 *
 * A prepared stream opens in the timeline with a music map, a waveform and a
 * calibration — and no clips, because nothing has decided which thirty seconds
 * are worth anything yet. That decision is `select_music_clips.py`, which ranks
 * the music map by how strongly a beat reads and how much sustained vocal is in
 * it. The screen used to end there and tell a person to go and run it.
 *
 * SYNCHRONOUS, unlike prepare. Measured on the longest archived stream — 3.1h,
 * count 10, with the layout probe on — the selector finishes in 10.4s wall. That
 * is a request you can hold open; a detached job plus a status file plus polling
 * is machinery this does not need. `execFile` does not block the event loop, and
 * a hard timeout is set below so a pathological run returns an error rather than
 * hanging the tab.
 *
 * The `--source` flag is passed deliberately even though it is what costs the
 * time: it turns on the layout probe, which resolves split-vs-reframe per
 * candidate now, at about a second each, instead of after a 25-40s render.
 */

/**
 * Where the candidates land, and why this does not call `build_strategy.py`.
 *
 * The brief said to run the strategy build after selecting. It cannot be run
 * here: `build_strategy.py` packages a *rendered* batch. It reads
 * `work/rendered.json`, which is compose.py's manifest of files that exist on
 * disk — missing entirely on a stream nobody has rendered — and it merges with
 * `library.merge_stream`, whose first act is to delete every clip for the date
 * that is not in that manifest. Called straight after selection it would either
 * crash on the missing manifest or delete the candidates it was meant to
 * publish.
 *
 * So selection writes the records itself, at the exact paths compose.py will
 * later render to (`clips/<date>/<HHMMSS>_<tag>.mp4`), following merge_stream's
 * rule about what belongs to a human. A later compose + build_strategy run
 * therefore lands on these same keys and merges onto them, keeping approvals and
 * hand-written copy — which is the property that rule exists to protect.
 *
 * The one thing not copied is merge_stream's deletion: this only ever adds and
 * refreshes. Re-selecting a stream must not throw away clips a person cut by
 * hand on the timeline.
 */
const HUMAN_FIELDS = ["copy", "status", "scheduled", "notes", "creator", "history"] as const;

type Candidate = {
  start: number;
  end: number;
  duration: number;
  score: number;
  context_tag: string;
  rank?: number;
  sung_fraction?: number;
  reason?: string;
  excerpt?: string;
  bpm?: number | null;
  layout?: string | null;
};

type RawClip = Record<string, unknown>;

async function exists(p: string) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** compose.py's fmt_hhmmss, which is what names the file this clip will become. */
function stamp(start: number) {
  const s = Math.max(0, Math.floor(start));
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join("");
}

async function publish(
  date: string,
  sourceName: string,
  batch: Record<string, unknown>,
  picks: Candidate[]
) {
  const raw = JSON.parse(await readFile(FILES.library, "utf8")) as {
    clips?: Record<string, RawClip>;
    batches?: Record<string, Record<string, unknown>>;
  };
  raw.clips ??= {};
  raw.batches ??= {};

  /**
   * Put back where this stream's pieces live.
   *
   * `library.record_settings` REPLACES a batch rather than merging into it, and
   * the selector calls it to stamp the guardrails it resolved. So selecting a
   * stream deletes the `work_dir` / `source` / `calibration` that preparation
   * recorded — and `work_dir` is the whole definition of "prepared", so the
   * stream drops back to "not prepared" on this screen and the timeline loses
   * its music map, its calibration and its video, all from having picked some
   * clips. `build_strategy.py` writes the same four keys back for exactly this
   * reason; without a render, nothing else does.
   */
  const stamped = raw.batches[date] ?? {};
  raw.batches[date] = { ...stamped };
  for (const key of ["work_dir", "source", "calibration", "stream_duration"]) {
    if (batch[key] !== undefined) raw.batches[date][key] = batch[key];
  }
  const streamDuration = (batch.stream_duration as number | undefined) ?? null;
  const paths: string[] = [];
  for (const c of picks) {
    const clipPath = `clips/${date}/${stamp(c.start)}_${c.context_tag}.mp4`;
    const existing = raw.clips[clipPath] ?? {};
    const entry: RawClip = {
      path: clipPath,
      date,
      source: sourceName,
      start: c.start,
      end: c.end,
      duration: c.end - c.start,
      context_tag: c.context_tag,
      score: c.score,
      mode: c.layout ?? null,
      excerpt: c.excerpt ?? "",
      bpm: c.bpm ?? null,
      sung_fraction: c.sung_fraction ?? null,
      reason: c.reason ?? "",
      stream_duration: streamDuration,
    };
    for (const field of HUMAN_FIELDS) if (field in existing) entry[field] = existing[field];
    entry.copy ??= {};
    entry.status ??= "new";
    entry.scheduled ??= "";
    raw.clips[clipPath] = entry;
    paths.push(clipPath);
  }
  await writeFile(FILES.library, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  return paths;
}

/** Whatever the script had to say, trimmed to something worth showing a person. */
function tail(err: unknown, lines = 3) {
  const e = err as { stdout?: string; stderr?: string; killed?: boolean; message?: string };
  const text = String(e.stderr || e.stdout || e.message || err);
  return text.trim().split("\n").filter(Boolean).slice(-lines).join(" ").slice(0, 600);
}

export async function GET(req: Request) {
  if (!INTERNAL_TOOLS_ENABLED) return new NextResponse(null, { status: 404 });
  const date = new URL(req.url).searchParams.get("stream") ?? "";
  const { clips, batches } = await getLibrary();
  const batch = (batches[date] ?? {}) as { work_dir?: string; selected?: number; asked?: number; limited_by?: string | null };
  const mine = clips.filter((c) => c.date === date);
  return NextResponse.json({
    stream: date,
    prepared: Boolean(batch.work_dir),
    clips: mine.length,
    // What the last selection asked for and what bound it, stamped on the batch
    // by the selector itself. This is the record, not a second guess at it.
    asked: batch.asked ?? null,
    selected: batch.selected ?? null,
    limitedBy: batch.limited_by ?? null,
    candidates: batch.work_dir ? await exists(path.join(resolveRepoPath(batch.work_dir)!, "candidates.json")) : false,
  });
}

export async function POST(req: Request) {
  if (!INTERNAL_TOOLS_ENABLED) return new NextResponse(null, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as {
    stream?: string;
    count?: number;
    layout?: string;
    kind?: string;
  };

  const stream = String(body.stream ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stream)) {
    return NextResponse.json({ error: "expected a stream date" }, { status: 400 });
  }
  const count = Math.trunc(Number(body.count ?? 10));
  if (!Number.isFinite(count) || count < 1 || count > 30) {
    return NextResponse.json({ error: "count must be a whole number from 1 to 30" }, { status: 400 });
  }
  const layout = body.layout === undefined ? null : String(body.layout);
  if (layout !== null && layout !== "any" && layout !== "split") {
    return NextResponse.json({ error: "layout is 'any' or 'split'" }, { status: 400 });
  }
  const kind = body.kind === undefined ? null : String(body.kind);
  if (kind !== null && !["any", "singing", "instrumental"].includes(kind)) {
    return NextResponse.json({ error: "kind is 'any', 'singing' or 'instrumental'" }, { status: 400 });
  }

  const { batches } = await getLibrary();
  // Read BEFORE the selector runs: it rewrites this record, and what it drops
  // has to be handed back afterwards. See the note in publish().
  const batch = (batches[stream] ?? {}) as Record<string, unknown> & {
    work_dir?: string;
    source?: string;
    stream_duration?: number;
  };
  // Preparation is what records a work dir, and it only does so once every stage
  // has succeeded — so this is a real answer about whether the music map exists,
  // not a guess from a directory being present.
  if (!batch.work_dir) {
    return NextResponse.json(
      { error: `${stream} has not been prepared — there is no music map to select from yet` },
      { status: 400 }
    );
  }
  const workDir = resolveRepoPath(batch.work_dir)!;
  const music = path.join(workDir, "music.json");
  if (!(await exists(music))) {
    return NextResponse.json(
      { error: `${stream} is missing its music map at ${music} — prepare it again` },
      { status: 400 }
    );
  }
  if (!(await exists(PY))) {
    return NextResponse.json(
      { error: `the pipeline's python is missing at ${PY} — create the venv first: python3 -m venv tools/clip-pipeline/.venv` },
      { status: 500 }
    );
  }

  const args = [
    path.join(PIPELINE, "select_music_clips.py"),
    "--count",
    String(count),
    "--date",
    stream,
    "--json",
  ];
  if (layout) args.push("--layout", layout);
  if (kind) args.push("--kind", kind);
  // The layout probe needs the VOD. Without it every candidate resolves to a
  // null layout and the split-vs-reframe question waits for a render.
  // Both through resolveRepoPath. This failed silently rather than loudly: with a
  // relative path `exists()` was false, so `--source` was never passed, and
  // select_music_clips.py cannot probe the frame without it — every candidate
  // came back with a null layout instead of split/reframe, and nothing said so.
  const selectSource = resolveRepoPath(batch.source);
  if (selectSource && (await exists(selectSource))) args.push("--source", selectSource);

  let stdout: string;
  try {
    // CLIP_WORK is how every pipeline stage is told which stream it is working
    // on; the selector's --music, --output and --calibration all default off it.
    ({ stdout } = await run(PY, args, {
      cwd: PIPELINE,
      env: { ...process.env, CLIP_WORK: workDir },
      maxBuffer: 8 << 20,
      timeout: 5 * 60_000,
    }));
  } catch (err) {
    const killed = (err as { killed?: boolean }).killed;
    return NextResponse.json(
      {
        error: killed
          ? `select_music_clips.py ran past five minutes on ${stream} and was stopped`
          : `select_music_clips.py failed: ${tail(err)}`,
      },
      { status: 500 }
    );
  }

  // With --json the summary is the last line; a short batch prints a NOTE line
  // above it naming what bound it, which is the most useful thing on the screen
  // when ten were asked for and six came back.
  const lines = stdout.trim().split("\n").filter(Boolean);
  const summaryLine = [...lines].reverse().find((l) => l.trimStart().startsWith("{"));
  if (!summaryLine) {
    return NextResponse.json(
      { error: `select_music_clips.py printed no result: ${lines.slice(-2).join(" ") || "(nothing)"}` },
      { status: 500 }
    );
  }
  const summary = JSON.parse(summaryLine) as { selected: number; output: string };
  const note = lines.find((l) => l.startsWith("NOTE:")) ?? null;

  let picks: Candidate[];
  try {
    picks = JSON.parse(await readFile(summary.output, "utf8")) as Candidate[];
  } catch {
    return NextResponse.json(
      { error: `the selector reported ${summary.selected} clips but ${summary.output} is unreadable` },
      { status: 500 }
    );
  }

  const paths = await publish(stream, batch.source ? path.basename(batch.source) : "", batch, picks);

  return NextResponse.json({
    ok: true,
    stream,
    asked: count,
    selected: picks.length,
    clips: paths,
    layouts: picks.map((c) => c.layout ?? null),
    tags: picks.map((c) => c.context_tag),
    note,
  });
}
