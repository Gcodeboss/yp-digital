import { execFile } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { INTERNAL_TOOLS_ENABLED } from "@/lib/internal-only";
import { getLibrary , resolveRepoPath} from "@/lib/yp";

const run = promisify(execFile);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..");
const PIPELINE = path.join(/*turbopackIgnore: true*/ REPO, "tools", "clip-pipeline");
const PY = path.join(/*turbopackIgnore: true*/ PIPELINE, ".venv", "bin", "python");

/**
 * Run the mechanical checks over a rendered batch, and say which ones failed.
 *
 * Synchronous, unlike the render: qa_report.py is a probe, five sampled frames
 * and a loudness pass per clip, and it took 13.8s over this repo's 10-clip
 * 2026-07-08 batch — about 1.4s a clip, against 25-40s a clip to render one.
 * That fits inside a request with room to spare, and running it inline means the
 * answer comes back with the POST instead of needing a second polling protocol
 * for something that is over before a person looks up. The timeout below is
 * generous per clip so a slow machine reports slowly rather than lying.
 *
 * Two things it does NOT do. It does not render: a stream with no
 * work/rendered.json has nothing to check and says so rather than reporting
 * "0 of 0 passed". And it does not treat a non-zero exit as a broken run —
 * qa_report.py deliberately exits 1 when a clip fails, so a runner stops instead
 * of delivering, and the report is still on disk and still the answer.
 */

/**
 * The named checks, mapped from the strings qa_report.py appends to a clip's
 * failures and warnings. The timeline shows "10 of 10 passed" over a hardcoded
 * list of check names; this keeps that shape and makes the names real — a screen
 * can say WHICH check a clip failed, which is the whole point of a QA gate.
 */
const CHECKS: { name: string; match: RegExp }[] = [
  { name: "file present", match: /^file missing/ },
  { name: "container", match: /^(dimensions|fps |sample rate|channels|first PTS)/ },
  { name: "duration", match: /^duration /i },
  { name: "dead pane", match: /(near-black|static \(motion|could not sample frames)/ },
  { name: "camera bleed", match: /(does not look like a DAW|camera bleed)/ },
  { name: "loudness", match: /^loudness/ },
  { name: "captions", match: /no words in range/ },
];

type QaResult = {
  name: string;
  path: string;
  mode?: string;
  tag?: string;
  ok: boolean;
  failures?: string[];
  warnings?: string[];
};

type QaFile = {
  clips?: number;
  passed?: number;
  failed?: number;
  contact_sheet?: string | null;
  results?: QaResult[];
};

function summarise(stream: string, report: QaFile, ranAt: number | null) {
  const results = report.results ?? [];

  const checks = CHECKS.map((c) => {
    const failed: { clip: string; reason: string }[] = [];
    const warned: { clip: string; reason: string }[] = [];
    for (const r of results) {
      for (const f of r.failures ?? []) if (c.match.test(f)) failed.push({ clip: r.name, reason: f });
      for (const w of r.warnings ?? []) if (c.match.test(w)) warned.push({ clip: r.name, reason: w });
    }
    return { name: c.name, ok: failed.length === 0, failed, warned };
  });

  // Anything the catalog above does not recognise is still reported, under its own
  // text. A check added to qa_report.py must never disappear from this screen just
  // because nobody updated the mapping here.
  const known = (s: string) => CHECKS.some((c) => c.match.test(s));
  for (const r of results) {
    for (const f of r.failures ?? []) {
      if (known(f)) continue;
      checks.push({ name: f.split(/[(:]/)[0].trim().slice(0, 40), ok: false, failed: [{ clip: r.name, reason: f }], warned: [] });
    }
  }

  return {
    ok: (report.failed ?? 0) === 0,
    stream,
    clips: report.clips ?? results.length,
    passed: report.passed ?? results.filter((r) => r.ok).length,
    failed: report.failed ?? results.filter((r) => !r.ok).length,
    // Repo-relative. `qa.json` stores this absolute, so returning it raw put this
    // machine's home directory in an API response — and nothing consumes it, so
    // nobody would have noticed until it shipped.
    contactSheet: report.contact_sheet
      ? report.contact_sheet.replace(`${REPO}/`, "")
      : null,
    ranAt,
    checks,
    results: results.map((r) => ({
      name: r.name,
      path: r.path,
      mode: r.mode ?? null,
      tag: r.tag ?? null,
      ok: r.ok,
      failures: r.failures ?? [],
      warnings: r.warnings ?? [],
    })),
  };
}

/** The work dir a stream's pipeline output lives in, recorded by prepare_stream.py. */
async function workDirFor(stream: string) {
  const { batches } = await getLibrary();
  const batch = (batches[stream] ?? {}) as Record<string, string>;
  return resolveRepoPath(batch.work_dir);
}

/** qa_report.py writes work/qa.json whether the batch passed or failed. */
async function readReport(workDir: string) {
  try {
    return JSON.parse(await readFile(path.join(workDir, "qa.json"), "utf8")) as QaFile;
  } catch {
    return null;
  }
}

/** The last report, without re-running anything. */
export async function GET(req: Request) {
  if (!INTERNAL_TOOLS_ENABLED) return new NextResponse(null, { status: 404 });
  const stream = new URL(req.url).searchParams.get("stream") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stream)) {
    return NextResponse.json({ error: "expected a stream date" }, { status: 400 });
  }
  const workDir = await workDirFor(stream);
  if (!workDir) return NextResponse.json({ ran: false, stream, error: null });

  const report = await readReport(workDir);
  if (!report) return NextResponse.json({ ran: false, stream, error: null });

  let ranAt: number | null = null;
  try {
    ranAt = (await stat(path.join(workDir, "qa.json"))).mtimeMs;
  } catch {
    /* the report is what matters; its timestamp is a nicety */
  }
  return NextResponse.json({ ran: true, ...summarise(stream, report, ranAt) });
}

export async function POST(req: Request) {
  if (!INTERNAL_TOOLS_ENABLED) return new NextResponse(null, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { stream?: string };
  const stream = String(body.stream ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stream)) {
    return NextResponse.json({ error: "expected a stream date" }, { status: 400 });
  }

  const workDir = await workDirFor(stream);
  if (!workDir) {
    return NextResponse.json(
      { error: `${stream} has no work dir recorded — prepare the stream first` },
      { status: 409 }
    );
  }

  const manifest = path.join(workDir, "rendered.json");
  for (const [what, file, fix] of [
    ["the pipeline venv python", PY, "create it: python3 -m venv tools/clip-pipeline/.venv"],
    ["qa_report.py", path.join(PIPELINE, "qa_report.py"), "the clip pipeline is missing from this checkout"],
    ["the render manifest", manifest, `nothing has been rendered for ${stream} yet — render the batch first`],
  ] as const) {
    try {
      await access(file);
    } catch {
      return NextResponse.json({ error: `${what} is missing: ${file}. ${fix}` }, { status: 409 });
    }
  }

  const entries = JSON.parse(await readFile(manifest, "utf8").catch(() => "[]")) as unknown[];
  try {
    await run(PY, [path.join(PIPELINE, "qa_report.py"), "--json"], {
      cwd: PIPELINE,
      env: { ...process.env, CLIP_WORK: workDir },
      // ~1.4s a clip measured; 15s a clip plus 30s of slack is a real ceiling
      // rather than a guess, and a machine slow enough to blow it has a problem
      // worth reporting.
      timeout: 30_000 + 15_000 * Math.max(1, entries.length),
      maxBuffer: 8 << 20,
    });
  } catch (err) {
    // execFile reports the child's exit status on `code` as a number (it is a
    // string only for a spawn-level errno such as ENOENT), so both shapes are read.
    const e = err as { code?: number | string; stderr?: string; killed?: boolean; message?: string };
    // Exit 1 is qa_report.py's verdict, not a crash: it fails the run when a clip
    // fails so a runner stops. The report is written before it exits, so read it.
    if (e.code !== 1) {
      const why = e.killed
        ? `qa_report.py was killed after ${Math.round((30_000 + 15_000 * entries.length) / 1000)}s`
        : e.code === "ENOENT"
          ? `${PY} could not be executed — the pipeline venv is not installed on this machine`
          : (e.stderr || e.message || String(err)).trim().split("\n").slice(-2).join(" ");
      return NextResponse.json(
        { error: `qa_report.py failed: ${why.slice(0, 400)}` },
        { status: 500 }
      );
    }
  }

  const report = await readReport(workDir);
  if (!report) {
    return NextResponse.json(
      { error: `qa_report.py ran but wrote no ${path.join(workDir, "qa.json")}` },
      { status: 500 }
    );
  }
  return NextResponse.json({ ran: true, ...summarise(stream, report, Date.now()) });
}
