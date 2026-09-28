import { notFound } from "next/navigation";
import { INTERNAL_TOOLS_ENABLED } from "@/lib/internal-only";
import { getLibrary, getStreams } from "@/lib/yp";
import { Rail } from "../yp-chrome";
import { TimelineClient } from "./timeline-client";

export const dynamic = "force-dynamic";

export default async function TimelinePage() {
  if (!INTERNAL_TOOLS_ENABLED) notFound();
  // Every archived stream, not only the ones that already have clips. Seven
  // captured streams were unreachable from the editor because nothing had been
  // clipped from them yet — which is exactly when you most need to open one.
  const [{ clips }, { archived }] = await Promise.all([getLibrary(), getStreams()]);
  const withClips = new Set(clips.map((c) => c.date).filter(Boolean) as string[]);
  const captured = archived.map((r) => r.stream_date).filter(Boolean) as string[];
  const streams = [...new Set([...withClips, ...captured])].sort().reverse();
  const labels = Object.fromEntries(
    archived.map((r) => [r.stream_date, r.title ?? ""])
  ) as Record<string, string>;

  return (
    <div className="flex h-dvh overflow-hidden bg-void text-cream">
      <Rail active="Timeline" />
      <TimelineClient streams={streams} labels={labels} clipped={[...withClips]} />
    </div>
  );
}
