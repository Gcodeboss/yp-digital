import { notFound } from "next/navigation";
import { INTERNAL_TOOLS_ENABLED } from "@/lib/internal-only";
import { getLibrary } from "@/lib/yp";
import { Rail } from "../yp-chrome";
import { FramingClient } from "./framing-client";

export const dynamic = "force-dynamic";

export default async function FramingPage() {
  if (!INTERNAL_TOOLS_ENABLED) notFound();
  const { clips } = await getLibrary();
  return (
    <div className="flex h-dvh overflow-hidden bg-void text-cream">
      <Rail active="Framing" />
      <FramingClient
        clips={clips.map((c) => ({
          path: c.path,
          date: c.date,
          start: c.start,
          end: c.end,
          duration: c.duration,
          context_tag: c.context_tag,
          mode: c.mode,
          framing_origin: c.framing_origin,
          creator: c.creator,
          // The measured rects travel with the clip so the editor has something
          // to fall back to when a saved framing is rejected.
          cam: (c.cam as [number, number, number, number]) ?? null,
          daw: (c.daw as [number, number, number, number]) ?? null,
        }))}
      />
    </div>
  );
}
