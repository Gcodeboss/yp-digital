import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { INTERNAL_TOOLS_ENABLED } from "@/lib/internal-only";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..");
const PIPELINE = path.join(/*turbopackIgnore: true*/ REPO, "tools", "clip-pipeline");
const PY = path.join(/*turbopackIgnore: true*/ PIPELINE, ".venv", "bin", "python");

/**
 * Prepare a captured stream for editing, and report progress.
 *
 * A fresh capture opens in the timeline with no waveform, no music map and no
 * calibration — everything the editor draws is pipeline output that has not been
 * produced yet. Telling a person to go and run four CLI commands is not a
 * dashboard, so this runs them.
 *
 * It takes minutes, so the POST starts a detached job and returns immediately;
 * the GET reports where it is. Nothing here renders or selects clips.
 */
export async function GET(req: Request) {
  if (!INTERNAL_TOOLS_ENABLED) return new NextResponse(null, { status: 404 });
  const stream = new URL(req.url).searchParams.get("stream") ?? "";
  try {
    const raw = await readFile(
      path.join(/*turbopackIgnore: true*/ REPO, "streams", "prepare", `${stream}.json`),
      "utf8"
    );
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json({ done: false, running: false, step: null });
  }
}

export async function POST(req: Request) {
  if (!INTERNAL_TOOLS_ENABLED) return new NextResponse(null, { status: 404 });
  const body = (await req.json()) as { stream?: string; transcribe?: boolean };
  const stream = String(body.stream ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stream)) {
    return NextResponse.json({ error: "expected a stream date" }, { status: 400 });
  }

  const args = [path.join(PIPELINE, "prepare_stream.py"), "--stream", stream];
  if (body.transcribe) args.push("--transcribe");

  // Detached: preparing takes minutes and must survive this request.
  const child = spawn(PY, args, { cwd: PIPELINE, detached: true, stdio: "ignore" });
  child.unref();
  return NextResponse.json({ started: true, stream });
}
