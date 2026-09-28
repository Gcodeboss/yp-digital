import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { INTERNAL_TOOLS_ENABLED } from "@/lib/internal-only";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..");
const PACKS = path.join(/*turbopackIgnore: true*/ REPO, "clips", "export-packs");

/**
 * Hand the finished pack to the operator's computer.
 *
 * `build_export_pack.py` writes a folder and the API returned one line of stdout,
 * which is not a delivery: the brief is "export and download it to his computer".
 * A pack is MP4s plus text, so it goes over the wire as a zip.
 *
 * Streamed from `zip -r -`, not built to disk first. A pack is gigabytes of video
 * — writing a second copy to disk to serve it would double the footprint of the
 * one artifact the tool exists to produce, on a machine already storing ~145 GB of
 * VODs a year. `zip` is in macOS, so this costs no dependency, and the target is a
 * `.zip` because that is what opens on a double-click for a non-technical user.
 */
function packDir(id: string) {
  // The id is a directory name under export-packs and nothing else. Resolve and
  // confirm containment rather than pattern-matching for "..", which is the same
  // rule `api/clip/[...path]` applies to clip paths.
  const target = path.resolve(PACKS, id);
  if (target !== PACKS && !target.startsWith(`${PACKS}${path.sep}`)) return null;
  if (target === PACKS) return null;
  return target;
}

export async function GET(req: Request) {
  if (!INTERNAL_TOOLS_ENABLED) return new NextResponse(null, { status: 404 });

  const id = new URL(req.url).searchParams.get("pack") ?? "";
  if (!id) return NextResponse.json({ error: "no pack named" }, { status: 400 });

  const dir = packDir(id);
  if (!dir) return NextResponse.json({ error: "invalid pack" }, { status: 400 });

  try {
    const info = await stat(dir);
    if (!info.isDirectory()) throw new Error("not a directory");
  } catch {
    return NextResponse.json({ error: `no pack called ${id}` }, { status: 404 });
  }

  // `-r -q -` recurses, stays silent on stdout, and writes the archive there.
  // cwd is the pack itself so the zip contains `clips/…` and `README.md` rather
  // than the absolute path this machine happens to use.
  const zip = spawn("/usr/bin/zip", ["-r", "-q", "-", "."], { cwd: dir });

  // Without this the request hangs on a zip failure instead of ending.
  zip.on("error", () => zip.stdout.destroy());
  zip.stderr.resume();

  return new NextResponse(Readable.toWeb(zip.stdout) as ReadableStream, {
    headers: {
      "content-type": "application/zip",
      // No content-length: the archive is produced as it streams, so its size is
      // not known until it is finished. The browser shows an indeterminate
      // download rather than a wrong percentage.
      "content-disposition": `attachment; filename="${id}.zip"`,
      "cache-control": "no-store",
    },
  });
}
