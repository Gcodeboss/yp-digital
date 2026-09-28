import { execFile } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { INTERNAL_TOOLS_ENABLED } from "@/lib/internal-only";
import { getLibrary , resolveRepoPath} from "@/lib/yp";

const run = promisify(execFile);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..");
const PIPELINE = path.join(REPO, "tools", "clip-pipeline");
const PY = path.join(PIPELINE, ".venv", "bin", "python");
const OUT = path.join(PIPELINE, "work", "preview");

/**
 * A composed frame, or a draft clip, for the clip being edited.
 *
 * Two tiers on purpose: the approved render is 25-40s, which is unusable in a
 * nudge-and-look loop. A still comes back in about two seconds and is what the
 * preview pane and the framing screen show; the draft is a half-size ultrafast
 * encode for checking motion and caption timing. Neither ever enters the library.
 */
export async function GET(req: Request) {
  if (!INTERNAL_TOOLS_ENABLED) return new NextResponse(null, { status: 404 });
  const { searchParams } = new URL(req.url);
  const clipPath = searchParams.get("clip") ?? "";
  const requested = searchParams.get("kind");
  const kind = requested === "draft" ? "draft" : requested === "source" ? "source" : "still";

  const { clips, batches } = await getLibrary();
  const clip = clips.find((c) => c.path === clipPath);
  if (!clip) return NextResponse.json({ error: "unknown clip" }, { status: 404 });

  const batch = (batches[clip.date ?? ""] ?? {}) as Record<string, string>;
  if (!batch.source || !batch.calibration) {
    return NextResponse.json(
      { error: "this stream has no recorded source — re-run build_strategy.py" },
      { status: 409 }
    );
  }

  const framing = (clip as { framing?: { cam?: number[]; daw?: number[] | null } }).framing;
  const args = [
    path.join(PIPELINE, "preview.py"),
    "--source", resolveRepoPath(batch.source)!,
    "--calibration", resolveRepoPath(batch.calibration)!,
    "--start", String(clip.start),
    "--end", String(clip.end),
    "--stream", clip.date ?? "",
    "--json",
  ];

  // Overriding rects skips a ~3s re-measure; the editor already knows them.
  const cam = searchParams.get("cam") ?? (framing?.cam ? framing.cam.join(",") : null);
  const daw = searchParams.get("daw") ?? (framing?.daw ? framing.daw.join(",") : null);
  if (cam) {
    args.push("--cam", cam, "--daw", daw ?? "none");
  }
  if (searchParams.get("safe") === "1") args.push("--safe-areas");
  if (searchParams.get("at")) args.push("--at", String(searchParams.get("at")));

  const name = `${clip.path.replace(/[^a-z0-9]+/gi, "_")}_${kind}`;
  const file = path.join(OUT, kind === "draft" ? `${name}.mp4` : `${name}.png`);
  args.push(
    kind === "draft" ? "--draft" : kind === "source" ? "--source-frame" : "--still",
    file
  );

  try {
    await mkdir(OUT, { recursive: true });
    let stdout: string;
    try {
      ({ stdout } = await run(PY, args, {
        cwd: PIPELINE,
        timeout: kind === "draft" ? 120_000 : 30_000,
        maxBuffer: 4_000_000,
      }));
    } catch (err) {
      // A rejected rect exits non-zero but still prints why. Surface that reason
      // rather than a process dump — the framing screen shows this to a person.
      const out = (err as { stdout?: string }).stdout ?? "";
      const line = out.trim().split("\n").filter((l) => l.startsWith("{")).pop();
      const parsed = line ? (JSON.parse(line) as { error?: string }) : null;
      return NextResponse.json(
        { error: parsed?.error ?? String(err).slice(0, 300) },
        { status: 400 }
      );
    }
    const raw = JSON.parse(stdout.trim().split("\n").filter((l) => l.startsWith("{")).pop() ?? "{}");
    // `preview.py` reports the file it wrote as an absolute path, so this put the
    // operator's home directory into every preview response AND into the
    // `X-Yp-Meta` header below. Nothing in the dashboard reads it — the image
    // bytes are the response — so it would have shipped unnoticed. Same class as
    // the QA route's `contactSheet`.
    const meta = Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).map(([k, v]) => [
        k,
        typeof v === "string" && v.startsWith(`${REPO}/`) ? v.slice(REPO.length + 1) : v,
      ])
    );
    if (searchParams.get("meta") === "1") return NextResponse.json(meta);

    const bytes = await readFile(file);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": kind === "draft" ? "video/mp4" : "image/png",
        "Cache-Control": "no-store",
        "X-Yp-Meta": JSON.stringify(meta).slice(0, 900),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 500) }, { status: 500 });
  }
}
