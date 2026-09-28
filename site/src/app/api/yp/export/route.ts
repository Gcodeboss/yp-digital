import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { INTERNAL_TOOLS_ENABLED } from "@/lib/internal-only";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..");
const PIPELINE = path.join(/*turbopackIgnore: true*/ REPO, "tools", "clip-pipeline");
const PY = path.join(/*turbopackIgnore: true*/ PIPELINE, ".venv", "bin", "python");
const PACKS = path.join(/*turbopackIgnore: true*/ REPO, "clips", "export-packs");

const run = promisify(execFile);

type Pack = { id: string; clips: number; bytes: number; built: number };

/** Every pack on disk, newest first, with the arithmetic the review screen shows. */
async function listPacks(): Promise<Pack[]> {
  let names: string[];
  try {
    names = await readdir(PACKS);
  } catch {
    return []; // never built one yet — not an error
  }

  const packs: Pack[] = [];
  for (const id of names) {
    if (id.startsWith(".")) continue;
    const dir = path.join(PACKS, id);
    try {
      const info = await stat(dir);
      if (!info.isDirectory()) continue;
      let clips = 0;
      let bytes = 0;
      for (const f of await readdir(path.join(dir, "clips")).catch(() => [])) {
        if (!f.endsWith(".mp4")) continue;
        clips += 1;
        bytes += (await stat(path.join(dir, "clips", f))).size;
      }
      packs.push({ id, clips, bytes, built: info.mtimeMs });
    } catch {
      // A half-written pack directory is skipped rather than failing the list.
    }
  }
  return packs.sort((a, b) => b.built - a.built);
}

export async function GET() {
  if (!INTERNAL_TOOLS_ENABLED) return new NextResponse(null, { status: 404 });
  return NextResponse.json({ packs: await listPacks() });
}

/**
 * Build the export pack — the thing a person actually posts from.
 *
 * The review screen used to end in "run build_export_pack.py", which is not an
 * answer on a dashboard. This runs it. It still exports nothing but approved
 * clips, and it still posts nothing anywhere: the pack lands on disk and a human
 * takes it from there.
 */
export async function POST(req: Request) {
  if (!INTERNAL_TOOLS_ENABLED) return new NextResponse(null, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as {
    date?: string;
    includePending?: boolean;
    action?: string;
    pack?: string;
  };

  // Reveal in Finder — for people who would rather have the folder than a zip.
  // Kept here rather than in the download route because it opens something on
  // this machine instead of returning bytes.
  if (body.action === "reveal") {
    const dir = path.resolve(PACKS, body.pack ?? "");
    if (!dir.startsWith(`${PACKS}${path.sep}`)) {
      return NextResponse.json({ ok: false, error: "invalid pack" }, { status: 400 });
    }
    try {
      await run("/usr/bin/open", ["-R", dir]);
      return NextResponse.json({ ok: true, message: "revealed in Finder" });
    } catch (err) {
      return NextResponse.json({ ok: false, error: String((err as Error).message) }, { status: 500 });
    }
  }

  const args = [path.join(PIPELINE, "build_export_pack.py")];
  if (body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) args.push("--date", body.date);
  // The review screen's "build anyway — skips N" button set its own state and
  // then posted an empty body, so the escape hatch it offered did nothing.
  if (body.includePending) args.push("--include-pending");

  try {
    const { stdout } = await run(PY, args, { cwd: PIPELINE, maxBuffer: 8 << 20 });
    const lines = stdout.trim().split("\n").filter(Boolean);
    // The summary line is what the operator wants ("Export pack: 9 clip(s),
    // 0.20 GB -> ..."); the script prints a path hint after it, so the last
    // line is the least useful one.
    const summary = lines.find((l) => l.startsWith("Export pack:"));
    return NextResponse.json({
      ok: true,
      message: summary ?? lines[lines.length - 1] ?? "pack built",
      packs: await listPacks(),
    });
  } catch (err) {
    // build_export_pack.py explains a refusal on STDOUT and exits 1 — "Nothing
    // approved yet — approve clips in the dashboard, or pass --include-pending".
    // Reading only stderr threw that away and showed "Command failed" instead,
    // which is the one case where the operator most needs the real sentence.
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const said = (e.stdout ?? "").trim().split("\n").filter(Boolean).pop();
    const fallback = (e.stderr ?? "").trim().split("\n").slice(-2).join(" ");
    // A refusal the script explained on stdout is not a server error. "Nothing
    // approved yet" is a state the operator can act on, and returning 500 for it
    // puts a fixable situation in the same bucket as a crashed process — for the
    // one message that most needs to read as ordinary.
    return NextResponse.json(
      { ok: false, error: said || fallback || e.message || "export failed" },
      { status: said ? 400 : 500 }
    );
  }
}
