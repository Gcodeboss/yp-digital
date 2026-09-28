import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { INTERNAL_TOOLS_ENABLED } from "@/lib/internal-only";
import { getStreams, playableFor } from "@/lib/yp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..");

/**
 * Serve a stream's source VOD, or a rendered clip, with byte-range support.
 *
 * Range support is the whole point: these files are 2-3 GB and three hours long.
 * Without it a `<video>` element downloads the entire thing before it will play,
 * and scrubbing is impossible — which is what made the first timeline a chart of
 * the audio rather than an editor.
 */
async function resolveTarget(searchParams: URLSearchParams): Promise<string | null> {
  const clip = searchParams.get("clip");
  if (clip) {
    const target = path.resolve(/*turbopackIgnore: true*/ REPO, clip);
    return target.startsWith(`${path.join(REPO, "clips")}${path.sep}`) ? target : null;
  }

  const stream = searchParams.get("stream");
  if (!stream) return null;

  // A remuxed proxy when one exists, else the recorded source.
  const playable = await playableFor(stream);
  if (playable) return playable;

  const { archived } = await getStreams();
  const rec = archived.find((r) => r.stream_date === stream);
  if (!rec?.path) return null;
  return path.isAbsolute(rec.path)
    ? rec.path
    : path.join(/*turbopackIgnore: true*/ REPO, rec.path);
}

export async function GET(req: Request) {
  if (!INTERNAL_TOOLS_ENABLED) return new NextResponse(null, { status: 404 });
  const { searchParams } = new URL(req.url);

  try {
    const target = await resolveTarget(searchParams);
    if (!target) return NextResponse.json({ error: "no source for that stream" }, { status: 404 });

    const file = await stat(target);
    const range = req.headers.get("range");

    if (range) {
      const match = range.match(/bytes=(\d*)-(\d*)/);
      const start = match?.[1] ? Number(match[1]) : 0;
      // Cap each response so seeking never pulls gigabytes; the player asks again.
      // The cap has to clear the moov index, though: on a three-hour capture the
      // sample tables run to tens of megabytes, and truncating them leaves the
      // player stuck at readyState 0 with no error — it simply never gets metadata.
      const requestedEnd = match?.[2] ? Number(match[2]) : file.size - 1;
      const end = Math.min(requestedEnd, start + 48_000_000, file.size - 1);
      if (start >= file.size) {
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
          "Cache-Control": "no-store",
        },
      });
    }

    const stream = Readable.toWeb(createReadStream(target));
    return new Response(stream as BodyInit, {
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(file.size),
        "Content-Type": "video/mp4",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 300) }, { status: 404 });
  }
}
