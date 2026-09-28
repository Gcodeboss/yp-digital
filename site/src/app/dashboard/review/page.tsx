import { notFound } from "next/navigation";
import { INTERNAL_TOOLS_ENABLED } from "@/lib/internal-only";
import { getLibrary } from "@/lib/yp";
import { Body, Chip, Label, Panel, Shell, TopBar, fmtTime } from "../yp-chrome";
import { ReviewClient } from "./review-client";

export const dynamic = "force-dynamic";

const STATUSES = ["new", "approved", "needs_edit", "rejected", "posted"] as const;

export default async function ReviewPage() {
  if (!INTERNAL_TOOLS_ENABLED) notFound();
  const { clips, batches } = await getLibrary();

  const counts = Object.fromEntries(
    STATUSES.map((s) => [s, clips.filter((c) => (c.status ?? "new") === s).length])
  );
  const runtime = clips.reduce((a, c) => a + c.duration, 0);
  const byStream = [...new Set(clips.map((c) => c.date))].filter(Boolean) as string[];

  return (
    <Shell active="Review">
      <TopBar title="Review" actions={<Label>nothing is posted from here</Label>}>
        <Chip>{clips.length} clips</Chip>
        <Chip>{(runtime / 60).toFixed(0)} min</Chip>
      </TopBar>
      <Body>
          <div className="grid grid-cols-5 gap-3">
            {STATUSES.map((s) => (
              <Panel
                key={s}
                className={`p-4 ${s === "approved" ? "border-amber/35 bg-amber/[0.06]" : ""}`}
              >
                <Label>{s.replace("_", " ")}</Label>
                <div className={`mt-1 ${s === "approved" ? "text-amber" : "text-cream"}`}>
                  <span className="font-display text-3xl leading-none">{counts[s]}</span>
                </div>
              </Panel>
            ))}
          </div>

          {byStream.length > 0 && (
            <Panel className="p-4">
              <Label>batches and the guardrails that produced them</Label>
              <div className="mt-3 flex flex-col gap-2">
                {byStream.sort().reverse().map((date) => {
                  const b = (batches[date] ?? {}) as Record<string, unknown>;
                  const n = clips.filter((c) => c.date === date).length;
                  return (
                    <div key={date} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                      <span className="font-mono text-amber">{date}</span>
                      <span className="text-warmgray">{n} clips</span>
                      {b.limited_by ? (
                        <Chip tone="rust">
                          asked {String(b.asked)} · limited by {String(b.limited_by)}
                        </Chip>
                      ) : b.count ? (
                        <Chip>count {String(b.count)}</Chip>
                      ) : null}
                      {b.spacing ? <Chip>gap {String(b.spacing)}s</Chip> : null}
                    </div>
                  );
                })}
              </div>
            </Panel>
          )}

          <ReviewClient
            clips={clips.map((c) => ({
              path: c.path,
              date: c.date ?? "",
              start: c.start,
              time: fmtTime(c.start),
              duration: c.duration,
              tag: c.context_tag,
              selector: c.selector ?? "",
              score: c.score ?? 0,
              status: c.status ?? "new",
              hook: c.copy?.hook ?? "",
              caption: c.copy?.caption ?? "",
              excerpt: c.excerpt ?? "",
            }))}
          />
      </Body>
    </Shell>
  );
}
