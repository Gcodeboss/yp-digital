import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { INTERNAL_TOOLS_ENABLED } from "@/lib/internal-only";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLIPS_ROOT = path.resolve(
  /*turbopackIgnore: true*/ process.cwd(),
  "..",
  "clips"
);

function safeClipPath(parts: string[]) {
  const target = path.resolve(CLIPS_ROOT, ...parts);
  if (target !== CLIPS_ROOT && !target.startsWith(`${CLIPS_ROOT}${path.sep}`)) {
    return null;
  }
  return target;
}

export async function GET(
  req: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  // Serves local stream VODs for the internal dashboard — never on the public site.
  if (!INTERNAL_TOOLS_ENABLED) return new NextResponse(null, { status: 404 });
  try {
    const { path: parts } = await context.params;
    const target = safeClipPath(parts);
    if (!target) {
      return NextResponse.json({ error: "Invalid clip path" }, { status: 400 });
    }

    const file = await stat(target);
    const range = req.headers.get("range");

    if (range) {
      const match = range.match(/bytes=(\d*)-(\d*)/);
      const start = match?.[1] ? Number(match[1]) : 0;
      const end = match?.[2] ? Number(match[2]) : file.size - 1;

      if (start >= file.size || end >= file.size) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${file.size}` },
        });
      }

      const stream = Readable.toWeb(createReadStream(target, { start, end }));
      return new Response(stream as BodyInit, {
        status: 206,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${file.size}`,
          "Content-Type": "video/mp4",
        },
      });
    }

    const stream = Readable.toWeb(createReadStream(target));
    return new Response(stream as BodyInit, {
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(file.size),
        "Content-Type": "video/mp4",
      },
    });
  } catch {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }
}
