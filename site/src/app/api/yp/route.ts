import { NextResponse } from "next/server";
import { INTERNAL_TOOLS_ENABLED } from "@/lib/internal-only";
import {
  addLock,
  addTranscriptEdit,
  getClipsForStream,
  getLibrary,
  getLocks,
  getMusicMap,
  getSettings,
  getStreams,
  getStreamSummary,
  getTranscript,
  getWaveform,
  getCalibration,
  createClip,
  splitClip,
  deleteClip,
  setClipCopy,
  setStreamField,
  setClipStatus,
  setCreatorField,
  undoCreator,
} from "@/lib/yp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One read endpoint and one write endpoint over the pipeline's artifacts.
 *
 * The dashboard does not render clips or run ffmpeg — it writes the same files
 * the CLI writes, so caching, resumability and the QA gate come along for free
 * rather than being reimplemented in the app.
 */
export async function GET(req: Request) {
  if (!INTERNAL_TOOLS_ENABLED) return new NextResponse(null, { status: 404 });
  const { searchParams } = new URL(req.url);
  const view = searchParams.get("view") ?? "overview";
  const stream = searchParams.get("stream") ?? "";

  try {
    switch (view) {
      case "streams":
        return NextResponse.json(await getStreams());
      case "library":
        return NextResponse.json(await getLibrary());
      case "clips":
        return NextResponse.json({ clips: await getClipsForStream(stream) });
      case "timeline": {
        const [clips, music, transcript, summary, waveform, calibration] = await Promise.all([
          getClipsForStream(stream),
          getMusicMap(stream),
          getTranscript(stream),
          getStreamSummary(stream),
          getWaveform(stream),
          getCalibration(stream),
        ]);
        return NextResponse.json({ clips, music, transcript, summary, waveform, calibration });
      }
      case "summary":
        return NextResponse.json(await getStreamSummary(stream));
      case "transcript":
        return NextResponse.json(await getTranscript(stream));
      case "locks":
        return NextResponse.json(await getLocks());
      case "settings":
        return NextResponse.json(await getSettings());
      default: {
        const [streams, library] = await Promise.all([getStreams(), getLibrary()]);
        return NextResponse.json({
          streams: {
            archived: streams.archived.length,
            // null, not 0, when the scan is too old to know — the same rule the
            // Streams screen follows. Reporting `atRisk: 0` here from a
            // three-week-old scan is the same confident all-clear over stale data,
            // just in a place where it is even easier to believe.
            atRisk: streams.scan.state === "stale" ? null : streams.atRisk.length,
            unrecoverable: streams.unrecoverable.length,
            mostUrgent: streams.scan.state === "stale" ? null : (streams.atRisk[0] ?? null),
            scan: streams.scan,
          },
          clips: {
            total: library.clips.length,
            approved: library.clips.filter((c) => c.status === "approved").length,
            pending: library.clips.filter((c) => (c.status ?? "new") === "new").length,
          },
        });
      }
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!INTERNAL_TOOLS_ENABLED) return new NextResponse(null, { status: 404 });
  try {
    const body = (await req.json()) as Record<string, string | number | object>;
    const action = String(body.action ?? "");

    switch (action) {
      case "set-field":
        return NextResponse.json(
          await setCreatorField(String(body.clip), String(body.field), body.value)
        );
      case "undo":
        return NextResponse.json(await undoCreator(String(body.clip)));
      case "set-status":
        return NextResponse.json(await setClipStatus(String(body.clip), String(body.status)));
      case "set-copy":
        return NextResponse.json(
          await setClipCopy(String(body.clip), body.copy as Record<string, string>)
        );
      case "fix-transcript":
        return NextResponse.json({
          edits: await addTranscriptEdit(String(body.stream), Number(body.at), String(body.text)),
        });
      case "create-clip":
        return NextResponse.json(
          await createClip(String(body.stream), Number(body.start), Number(body.end),
                           String(body.tag ?? "beat"))
        );
      case "split-clip":
        return NextResponse.json(await splitClip(String(body.clip), Number(body.at)));
      case "delete-clip":
        return NextResponse.json(await deleteClip(String(body.clip)));
      case "set-stream-field":
        return NextResponse.json(
          await setStreamField(String(body.stream), String(body.field), body.value)
        );
      case "add-lock":
        return NextResponse.json(await addLock(body.lock as Record<string, unknown>));
      default:
        return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}
