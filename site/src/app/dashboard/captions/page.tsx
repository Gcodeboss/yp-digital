import { notFound } from "next/navigation";
import { INTERNAL_TOOLS_ENABLED } from "@/lib/internal-only";
import { getLibrary } from "@/lib/yp";
import { Rail } from "../yp-chrome";
import { CaptionsClient } from "./captions-client";

export const dynamic = "force-dynamic";

export default async function CaptionsPage() {
  if (!INTERNAL_TOOLS_ENABLED) notFound();
  const { clips } = await getLibrary();
  const streams = [...new Set(clips.map((c) => c.date).filter(Boolean))].sort().reverse() as string[];

  return (
    <div className="flex h-dvh overflow-hidden bg-void text-cream">
      <Rail active="Captions" />
      <CaptionsClient
        streams={streams}
        clips={clips.map((c) => ({
          path: c.path,
          date: c.date,
          start: c.start,
          end: c.end,
          context_tag: c.context_tag,
        }))}
      />
    </div>
  );
}
