import { NextResponse } from "next/server";
import { INTERNAL_TOOLS_ENABLED } from "@/lib/internal-only";
import { getTranscript } from "@/lib/yp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function stamp(t: number, srt = false) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(t / 3600);
  const m = Math.floor(t / 60) % 60;
  const s = Math.floor(t % 60);
  if (!srt) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(h)}:${pad(m)}:${pad(s)},${String(Math.round((t % 1) * 1000)).padStart(3, "0")}`;
}

/** The transcript as plain text or subtitles — corrections already applied. */
export async function GET(req: Request) {
  if (!INTERNAL_TOOLS_ENABLED) return new NextResponse(null, { status: 404 });
  const { searchParams } = new URL(req.url);
  const stream = searchParams.get("stream") ?? "";
  const format = searchParams.get("format") === "srt" ? "srt" : "txt";

  const { segments } = await getTranscript(stream);
  const usable = segments.filter((s) => s.text.trim());
  if (!usable.length) {
    return NextResponse.json({ error: `no transcript stored for ${stream}` }, { status: 404 });
  }

  const body =
    format === "srt"
      ? usable
          .map(
            (s, i) =>
              `${i + 1}\n${stamp(s.start, true)} --> ${stamp(s.end, true)}\n${s.text.trim()}\n`
          )
          .join("\n")
      : usable.map((s) => `[${stamp(s.start)}] ${s.text.trim()}`).join("\n");

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${stream}.${format}"`,
    },
  });
}
