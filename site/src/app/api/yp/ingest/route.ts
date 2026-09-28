import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { access, constants, mkdir, open, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { INTERNAL_TOOLS_ENABLED } from "@/lib/internal-only";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..");
const PIPELINE = path.join(/*turbopackIgnore: true*/ REPO, "tools", "clip-pipeline");
const PY = path.join(/*turbopackIgnore: true*/ PIPELINE, ".venv", "bin", "python");
const VENV_BIN = path.join(/*turbopackIgnore: true*/ PIPELINE, ".venv", "bin");
const JOBS = path.join(/*turbopackIgnore: true*/ REPO, "streams", "ingest");

/**
 * Get a stream onto disk and into the archive, from a Kick VOD URL or a file.
 *
 * Kick deletes a non-verified channel's VODs after about thirty days, and the
 * only capture path that existed was a terminal: scan the channel through the
 * browser bridge, then `ingest.py --backfill`. That works for the scheduled
 * sweep and not at all for "here is a link, take it" — `capture.sh` back-fills
 * whatever is most urgent, and nothing in the pipeline takes one URL.
 *
 * A download is gigabytes and tens of minutes, so POST starts a detached job and
 * returns a job id; GET reports where it is. Same shape as prepare/route.ts, for
 * the same reason: the work has to outlive the request.
 *
 * Nothing here selects or renders. It ends where `ingest.py --backfill` ends —
 * a verified file recorded in `streams/archive.json` — and the existing prepare
 * and select steps take it from there.
 */

/**
 * The job itself, driven through the pipeline's own modules.
 *
 * There is no single script to call. `fetch_vod.py` downloads but never touches
 * the archive, so a stream fetched with it is invisible to the dashboard;
 * `ingest.py` verifies and archives but only for records a browser scan already
 * put there. Both halves exist, neither is wired to the other, and the missing
 * wire is short.
 *
 * It is written in Python rather than in TypeScript on purpose: what counts as a
 * complete capture (the duration fraction, the broken-timestamp repair) and what
 * an archive record means are decided in `ingest.py` and `archive.py`, and
 * re-deciding either in this file would be a second, quieter answer to the same
 * question. `clip.sh` drives the same modules the same way, with `python -c`.
 *
 * argv: <state.json> <url|file> <target> <uuid-or-empty>
 */
const INGEST_JOB = `
import json, os, shutil, subprocess, sys, time
from pathlib import Path

import archive, fetch_vod, ingest

STATE = Path(sys.argv[1])
MODE, TARGET, UUID = sys.argv[2], sys.argv[3], sys.argv[4]
STREAMS = archive.PROJECT_ROOT / "streams"


def put(**fields):
    data = json.loads(STATE.read_text()) if STATE.exists() else {}
    data.update(fields)
    data["updated_at"] = time.time()
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(data, indent=2))


def run():
    data = archive.load()
    known = dict(data["streams"].get(UUID) or {}) if UUID else {}
    target = TARGET
    uuid = UUID

    # A Kick page URL whose id we do not recognise may still be a broadcast we
    # already scanned under a DIFFERENT video id -- Kick can carry more than one
    # video record per broadcast. Resolve it before downloading, not after: taking
    # only the URL and keeping the unknown id wrote a second archive entry titled
    # from the HLS filename, left the original still marked at-risk, and skipped
    # the completeness check because there was no advertised duration to compare.
    if MODE == "url" and not known and "kick.com" in target and "m3u8" not in target:
        match = fetch_vod.same_broadcast(target)
        if match:
            uuid, known = match[0], dict(match[1])
            target = known.get("source_hls") or target
            put(step="matched", note=f"same broadcast as {known.get('stream_date')}")
            print(f"That video id is not in the archive, but this is the same "
                  f"broadcast as {uuid} ({known.get('title')}) — using its stream URL.",
                  file=sys.stderr)

    if MODE == "url":
        put(step="downloading", running=True, error=None)
        # A dedicated empty directory: fetch_vod picks its result by newest *.mp4
        # in the output dir, and streams/ already holds seven of them.
        stage = STREAMS / "incoming" / STATE.stem
        got = fetch_vod.download_with_yt_dlp(target, stage)
        date = (known.get("stream_date") or fetch_vod.extract_date_from_filename(got.name)
                or time.strftime("%Y-%m-%d"))
        title = known.get("title") or fetch_vod.extract_title_from_filename(got.name)
        src = STREAMS / (ingest.slugify(title, date, uuid) + got.suffix)
        got.replace(src)
        try:
            stage.rmdir()
        except OSError:
            pass
        method = "dashboard/yt-dlp"
    else:
        src = Path(target)
        date = (known.get("stream_date") or fetch_vod.extract_date_from_filename(src.name)
                or time.strftime("%Y-%m-%d"))
        title = known.get("title") or fetch_vod.extract_title_from_filename(src.name)
        method = "dashboard/local"

    put(step="verifying", running=True, source=str(src), stream=date, title=title)
    ok, seconds, resolution, why = ingest.verify(known, src)
    if not ok:
        # ingest.py's rule, unchanged: keep the file, refuse to call it archived.
        put(running=False, done=False, step="unusable", error=f"{src.name}: {why}")
        return 1

    # Reuse the record a scan already made for this VOD; otherwise key on the
    # uuid in the URL, and only invent one for a file that has neither.
    key = uuid or next(
        (u for u, r in data["streams"].items()
         if r.get("path") and Path(r["path"]).name == src.name),
        "local-" + ingest.slugify(title, date))
    rec = data["streams"].setdefault(key, {})
    rec.setdefault("uuid", key)
    rec.setdefault("title", title)
    rec.setdefault("stream_date", date)
    rec.setdefault("duration_s", round(seconds, 1))
    # Relative where it can be, which is how every other record reads. A file in
    # an allowed media dir outside the repo keeps a path relative to it.
    stored = Path(os.path.relpath(src, archive.PROJECT_ROOT))
    archive.mark_archived(data, key, stored, src.stat().st_size, resolution,
                          seconds, method, ingest.now())
    archive.save(data)
    put(running=False, done=True, step="archived", error=None, uuid=key,
        stream=date, title=title, source=str(src), resolution=resolution,
        duration_s=round(seconds, 1), bytes=src.stat().st_size,
        note=None if why == "ok" else why)
    return 0


try:
    code = run()
except BaseException as exc:
    # yt-dlp's exit code says nothing; its output says everything, and the caller
    # already has that in the job log. Point at it instead of pasting an argv.
    # fetch_vod.download_with_yt_dlp now raises RuntimeError carrying the
    # interpreted cause ("Kick has no VOD with that id ..."), which is the
    # sentence to show. A class name in front of it helps nobody.
    if isinstance(exc, RuntimeError):
        why = str(exc)
    elif isinstance(exc, subprocess.CalledProcessError):
        why = f"yt-dlp exited {exc.returncode} — its own output is in the log below"
    else:
        why = f"{type(exc).__name__}: {exc}"
    put(running=False, done=False, step="failed", error=why)
    shutil.rmtree(STREAMS / "incoming" / STATE.stem, ignore_errors=True)
    raise
sys.exit(code)
`;

type Job = {
  job: string;
  mode: "url" | "file";
  input: string;
  step: string;
  running: boolean;
  done: boolean;
  error: string | null;
  started_at: number;
  updated_at?: number;
  stream?: string;
  title?: string;
  source?: string;
  note?: string | null;
};

const JOB_ID = /^[0-9a-z]+-[0-9a-f]{8}$/;
const KICK_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIDEO_EXT = [".mp4", ".mkv", ".mov", ".m4v", ".ts", ".webm"];

async function exists(p: string) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Is this a Kick VOD link, and which VOD is it?
 *
 * Two shapes are real: the page a person copies out of the address bar
 * (`kick.com/video/<uuid>`, `kick.com/<channel>/videos/<uuid>`) and the HLS
 * master on stream.kick.com that the archive records as `source_hls` — the one
 * `ingest.py` actually downloads from. The uuid matters beyond validation: it is
 * the key `streams/archive.json` is written on, so a link to a stream a scan
 * already found lands on that record instead of making a second one.
 */
function readKickUrl(raw: string): { url: string; uuid: string } | { error: string } {
  if (raw.length > 2048) return { error: "that URL is implausibly long" };
  if (/[\s\u0000-\u001f]/.test(raw)) {
    return { error: "a URL cannot contain spaces or control characters" };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: `not a URL: ${raw}` };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return {
      error: `${url.protocol} is not a link to anything downloadable — use an https kick.com URL`,
    };
  }
  if (url.username || url.password) return { error: "a URL with credentials in it is refused" };
  const host = url.hostname.toLowerCase();
  if (host !== "kick.com" && !host.endsWith(".kick.com")) {
    return { error: `${host} is not kick.com — this ingests Kick VODs` };
  }
  if (url.pathname.toLowerCase().endsWith(".m3u8")) return { url: url.toString(), uuid: "" };

  const parts = url.pathname.split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  const kind = parts[parts.length - 2] ?? "";
  if ((kind === "video" || kind === "videos") && KICK_UUID.test(last)) {
    return { url: url.toString(), uuid: last.toLowerCase() };
  }
  return {
    error:
      `${url.pathname} is not a VOD path. Expected kick.com/video/<uuid>, ` +
      `kick.com/<channel>/videos/<uuid>, or a stream.kick.com master.m3u8`,
  };
}

/** Directories a local file may be ingested from. The repo, plus anything opted in. */
function allowedRoots() {
  const extra = (process.env.YP_MEDIA_DIRS ?? "")
    .split(path.delimiter)
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => path.resolve(d));
  return [REPO, ...extra];
}

function within(root: string, p: string) {
  return p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

/**
 * Resolve a local path, or say why not.
 *
 * Containment is checked after realpath rather than before: a symlink sitting
 * inside the repo and pointing anywhere else passes a string test and fails this
 * one. Nothing here is ever handed to a shell — spawn takes an argv array and
 * `shell: true` is never set — so this decides which files may be read, not how
 * to quote them.
 */
async function readLocalPath(raw: string): Promise<{ file: string } | { error: string }> {
  if (raw.length > 4096) return { error: "that path is implausibly long" };
  if (raw.includes("\u0000")) return { error: "a path cannot contain a null byte" };
  const home = process.env.HOME ?? "";
  const guess = path.resolve(REPO, raw.startsWith("~/") && home ? path.join(home, raw.slice(2)) : raw);

  let file: string;
  try {
    file = await realpath(guess);
  } catch {
    return { error: `no such file: ${guess}` };
  }
  if (!allowedRoots().some((r) => within(r, file))) {
    return {
      error:
        `${file} is outside the repo. Move it under ${REPO}, or add its ` +
        `directory to YP_MEDIA_DIRS (colon-separated) and restart the dash.`,
    };
  }
  if (!(await stat(file)).isFile()) return { error: `${file} is not a file` };
  if (!VIDEO_EXT.includes(path.extname(file).toLowerCase())) {
    return {
      error: `${path.extname(file) || "that"} is not a video container — expected one of ${VIDEO_EXT.join(", ")}`,
    };
  }
  return { file };
}

/** Mirrors fetch_vod.find_yt_dlp, so the answer here is the answer there. */
async function findYtDlp() {
  for (const dir of [VENV_BIN, ...(process.env.PATH ?? "").split(path.delimiter)]) {
    if (!dir) continue;
    for (const name of ["yt-dlp", "yt-dlp_macos"]) {
      if (await exists(path.join(dir, name))) return path.join(dir, name);
    }
  }
  return null;
}

async function readJob(id: string): Promise<Job | null> {
  try {
    return JSON.parse(await readFile(path.join(JOBS, `${id}.json`), "utf8")) as Job;
  } catch {
    return null;
  }
}

/** The last few lines the job's processes printed. yt-dlp's real complaint is here. */
async function readLog(id: string, lines = 12) {
  try {
    const raw = await readFile(path.join(JOBS, `${id}.log`), "utf8");
    // Three lines appear in every single yt-dlp run on this machine and say
    // nothing about the job: a LibreSSL/urllib3 warning, its `warnings.warn(`
    // continuation, and a Python-3.9 deprecation notice. They are the first
    // thing under the error, so they read as the cause and are not.
    const noise =
      /NotOpenSSLWarning|^\s*warnings\.warn\(|Deprecated Feature: Support for Python/;
    return raw
      .trim()
      .split("\n")
      .filter((l) => !noise.test(l))
      .slice(-lines)
      .join("\n")
      .slice(-4000);
  } catch {
    return "";
  }
}

async function recentJobs(): Promise<Job[]> {
  let names: string[] = [];
  try {
    names = (await readdir(JOBS)).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  return (await Promise.all(names.map((n) => readJob(n.replace(/\.json$/, "")))))
    .filter((j): j is Job => j !== null)
    .sort((a, b) => (b.started_at ?? 0) - (a.started_at ?? 0))
    .slice(0, 8);
}

export async function GET(req: Request) {
  if (!INTERNAL_TOOLS_ENABLED) return new NextResponse(null, { status: 404 });
  const id = new URL(req.url).searchParams.get("job");

  if (id) {
    if (!JOB_ID.test(id)) return NextResponse.json({ error: "not a job id" }, { status: 400 });
    const job = await readJob(id);
    if (!job) return NextResponse.json({ error: `no ingest job ${id}` }, { status: 404 });
    return NextResponse.json({ ...job, log: await readLog(id) });
  }

  // No id: what has been ingested lately, newest first. Reloading the page in the
  // middle of a two-hour download should not lose sight of the download.
  const jobs = await Promise.all(
    (await recentJobs()).map(async (j) => (j.error ? { ...j, log: await readLog(j.job) } : j))
  );
  return NextResponse.json({ jobs });
}

/** Clear a finished job. Three identical dead retries stacked up with no way to remove them. */
export async function DELETE(req: Request) {
  if (!INTERNAL_TOOLS_ENABLED) return new NextResponse(null, { status: 404 });
  const id = new URL(req.url).searchParams.get("job") ?? "";
  // Job ids name files; anything with a separator in it is refused outright.
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(id) || id.startsWith(".")) {
    return NextResponse.json({ error: "invalid job id" }, { status: 400 });
  }
  const job = await readJob(id);
  if (job?.running) {
    return NextResponse.json({ error: "that job is still running" }, { status: 409 });
  }
  await Promise.all([
    rm(path.join(JOBS, `${id}.json`), { force: true }),
    rm(path.join(JOBS, `${id}.log`), { force: true }),
  ]);
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  if (!INTERNAL_TOOLS_ENABLED) return new NextResponse(null, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as {
    source?: string;
    uuid?: string;
  };
  const raw = String(body.source ?? "").trim();
  if (!raw) {
    return NextResponse.json(
      { error: "give me a Kick VOD URL or a path to a local video file" },
      { status: 400 }
    );
  }

  // One input, two kinds. Anything carrying a scheme is judged as a URL — the
  // slashes are not required, so `javascript:` is answered as a refused scheme
  // rather than as a missing file. A POSIX path cannot reach a colon before its
  // first slash, so nothing real is misread.
  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//");
  let mode: "url" | "file";
  let target: string;
  let uuid = "";
  if (looksLikeUrl) {
    const parsed = readKickUrl(raw);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    mode = "url";
    target = parsed.url;
    // An HLS URL carries no uuid in its path, so "Archive now" passes the one
    // the scan already recorded. Without it the archive entry is not matched and
    // the capture arrives with no title or date.
    uuid = parsed.uuid || (/^[0-9a-f-]{8,64}$/i.test(String(body.uuid ?? "")) ? String(body.uuid) : "");
  } else {
    const parsed = await readLocalPath(raw);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    mode = "file";
    target = parsed.file;
  }

  // Name the missing tool. This gets installed on fresh machines, and "ingest
  // failed" sends someone reading logs for something one sentence could say.
  if (!(await exists(PY))) {
    return NextResponse.json(
      {
        error:
          `the pipeline's python is missing at ${PY} — create the venv first: ` +
          `python3 -m venv tools/clip-pipeline/.venv`,
      },
      { status: 500 }
    );
  }
  if (mode === "url" && !(await findYtDlp())) {
    return NextResponse.json(
      {
        error:
          "yt-dlp is not installed, so nothing can be downloaded from Kick. Install it with: " +
          "tools/clip-pipeline/.venv/bin/pip install yt-dlp",
      },
      { status: 500 }
    );
  }

  // A double-clicked button must not start a second download of the same VOD.
  // Two different sources may run at once; they are separate transfers.
  const clash = (await recentJobs()).find((j) => j.running && !j.error && j.input === raw);
  if (clash) {
    return NextResponse.json(
      { error: `already ingesting that — job ${clash.job} is at "${clash.step}"`, job: clash.job },
      { status: 409 }
    );
  }

  const id = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
  const state = path.join(JOBS, `${id}.json`);
  await mkdir(JOBS, { recursive: true });
  await writeFile(
    state,
    `${JSON.stringify(
      {
        job: id,
        mode,
        input: raw,
        step: mode === "url" ? "starting the download" : "reading the file",
        running: true,
        done: false,
        error: null,
        started_at: Date.now() / 1000,
        updated_at: Date.now() / 1000,
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  // Detached, because this downloads gigabytes and must survive the request —
  // and everything the child prints goes to the job's log, because yt-dlp's own
  // diagnosis is what explains a download failure and it is on stderr, not in
  // the exception the wrapper raises.
  const log = await open(path.join(JOBS, `${id}.log`), "a");
  const child = spawn(PY, ["-c", INGEST_JOB, state, mode, target, uuid], {
    cwd: PIPELINE,
    detached: true,
    stdio: ["ignore", log.fd, log.fd],
  });
  child.unref();
  await log.close();

  return NextResponse.json({ started: true, job: id, mode, target });
}
