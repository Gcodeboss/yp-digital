import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { INTERNAL_TOOLS_ENABLED } from "@/lib/internal-only";
import { daysLeft, getLibrary, getPreparedStreams, getStreams } from "@/lib/yp";
import { Body, Chip, Label, Panel, Section, Shell, Stat, TopBar } from "./yp-chrome";

export const metadata: Metadata = {
  title: "YP Dash · Overview",
  description: "Internal Yanchan Produced clipping console.",
  robots: { index: false, follow: false },
};

// Internal tool — 404s on the public deploy. See lib/internal-only.ts
export const dynamic = "force-dynamic";

/**
 * The overview answers one question: what should someone do next?
 *
 * Work moves capture → prepare → clip → frame → caption → review → export, and a
 * stage is only interesting when something is stuck in it. Every number here is
 * read from the library and the archive; nothing on this screen is illustrative.
 */
export default async function DashboardPage() {
  if (!INTERNAL_TOOLS_ENABLED) notFound();

  const [{ archived, atRisk, unrecoverable }, prepared, { clips }] = await Promise.all([
    getStreams(),
    getPreparedStreams(),
    getLibrary(),
  ]);

  const byStatus = (s: string) => clips.filter((c) => (c.status ?? "new") === s).length;
  const framed = clips.filter((c) => (c.creator as { framing?: unknown })?.framing).length;
  const withCopy = clips.filter((c) => c.copy?.hook).length;
  const runtimeMin = clips.reduce((a, c) => a + c.duration, 0) / 60;
  const archivedHours = archived.reduce(
    (a, r) => a + (r.measured_duration_s ?? r.duration_s ?? 0) / 3600,
    0
  );
  const unprepared = archived.filter((r) => r.stream_date && !prepared.has(r.stream_date));
  const archivedPrepared = archived.filter((r) => r.stream_date && prepared.has(r.stream_date));
  const clippedDates = new Set(clips.map((c) => c.date).filter(Boolean) as string[]);
  const preparedNotClipped = [...prepared].filter((d) => !clippedDates.has(d));

  const stages = [
    {
      name: "Capture",
      count: archived.length,
      unit: "streams archived",
      detail: `${archivedHours.toFixed(1)}h held locally`,
      alert: atRisk.length > 0 ? `${atRisk.length} still only on Kick` : null,
      href: "/dashboard/streams",
      cta: "Streams",
    },
    {
      name: "Prepare",
      count: archivedPrepared.length,
      unit: "ready to edit",
      detail: `${unprepared.length} need waveform, music map and calibration`,
      alert: null,
      href: "/dashboard/timeline",
      cta: "Timeline",
    },
    {
      name: "Clip",
      count: clips.length,
      unit: "clips marked",
      detail: `${runtimeMin.toFixed(0)} min of runtime · ${preparedNotClipped.length} prepared stream${
        preparedNotClipped.length === 1 ? "" : "s"
      } not clipped`,
      alert: null,
      href: "/dashboard/timeline",
      cta: "Timeline",
    },
    {
      name: "Frame",
      count: framed,
      unit: "framings set by hand",
      detail: `${clips.length - framed} still on the measurement`,
      alert: null,
      href: "/dashboard/framing",
      cta: "Framing",
    },
    {
      name: "Caption",
      count: withCopy,
      unit: "clips with a hook",
      detail: `${clips.length - withCopy} without copy`,
      alert: null,
      href: "/dashboard/captions",
      cta: "Captions",
    },
    {
      name: "Review",
      count: byStatus("approved"),
      unit: "approved",
      detail: `${byStatus("new")} waiting · ${byStatus("needs_edit")} need an edit`,
      alert: null,
      href: "/dashboard/review",
      cta: "Review",
    },
  ];

  // The one thing most worth doing, stated plainly.
  const next =
    atRisk.length > 0
      ? {
          text: `${atRisk.length} stream${atRisk.length === 1 ? "" : "s"} are on Kick and not archived — the first is deleted in ${daysLeft(atRisk[0])} days.`,
          href: "/dashboard/streams",
          cta: "Open streams",
        }
      : unprepared.length > 0
        ? {
            text: `${unprepared.length} archived stream${unprepared.length === 1 ? "" : "s"} have never been prepared, so they cannot be clipped yet.`,
            href: "/dashboard/timeline",
            cta: "Open the timeline",
          }
        : byStatus("new") > 0
          ? {
              text: `${byStatus("new")} clips are waiting on a decision. Nothing is posted until someone approves it.`,
              href: "/dashboard/review",
              cta: "Open review",
            }
          : {
              text: "Everything captured is prepared and every clip has been decided on.",
              href: "/dashboard/timeline",
              cta: "Open the timeline",
            };

  return (
    <Shell active="Ops">
      <TopBar title="Overview" actions={<Label>nothing posts from this machine</Label>}>
        <Chip>channel · yanchanproduced</Chip>
        <Chip>{archived.length} streams</Chip>
        <Chip>{clips.length} clips</Chip>
      </TopBar>

      <Body>
        <Panel className="flex flex-wrap items-center gap-x-6 gap-y-3 border-amber/25 bg-amber/[0.05] p-5">
          <div className="min-w-[260px] flex-1">
            <Label>next</Label>
            <p className="mt-1.5 text-[14px] leading-relaxed text-cream">{next.text}</p>
          </div>
          <Link
            href={next.href}
            className="shrink-0 rounded-md border border-amber bg-amber px-4 py-2 font-head text-[12px] font-semibold uppercase tracking-[0.04em] text-void hover:bg-gold"
          >
            {next.cta}
          </Link>
        </Panel>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
          {stages.map((s) => (
            <Link key={s.name} href={s.href}>
              <Panel className="flex h-full flex-col gap-1 p-4 transition-colors hover:border-amber/40">
                <Label>{s.name}</Label>
                <div className="mt-0.5">
                  <Stat value={s.count} />
                </div>
                <div className="text-[11px] text-warmgray">{s.unit}</div>
                <div className="mt-auto pt-2 text-[11px] leading-relaxed text-warmgray">
                  {s.detail}
                </div>
                {s.alert && (
                  <div className="mt-1">
                    <Chip tone="rust">{s.alert}</Chip>
                  </div>
                )}
              </Panel>
            </Link>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
          <Section title="streams · newest first" actions={<Label>open one to clip it</Label>}>
            {archived.slice(0, 8).map((r) => {
              const ready = r.stream_date ? prepared.has(r.stream_date) : false;
              const n = clips.filter((c) => c.date === r.stream_date).length;
              return (
                <Link
                  key={r.uuid}
                  href={`/dashboard/timeline?stream=${r.stream_date}`}
                  className="flex items-center gap-4 border-b border-white/[0.06] px-4 py-2.5 transition-colors last:border-b-0 hover:bg-white/[0.03]"
                >
                  <span className="w-[88px] shrink-0 font-mono text-[11px] text-amber">
                    {r.stream_date}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-cream">{r.title}</span>
                  <span className="w-[56px] shrink-0 text-right font-mono text-[11px] text-warmgray">
                    {((r.measured_duration_s ?? r.duration_s ?? 0) / 3600).toFixed(2)}h
                  </span>
                  <span className="w-[58px] shrink-0 text-right font-mono text-[11px] text-warmgray">
                    {n > 0 ? `${n} clips` : "—"}
                  </span>
                  <span className="w-[96px] shrink-0 text-right">
                    <Chip tone={ready ? "amber" : "muted"}>{ready ? "ready" : "not prepared"}</Chip>
                  </span>
                </Link>
              );
            })}
          </Section>

          <div className="flex flex-col gap-4">
            <Section title="clip decisions">
              <div className="grid grid-cols-2 gap-px bg-white/[0.06]">
                {(["new", "approved", "needs_edit", "rejected"] as const).map((s) => (
                  <div key={s} className="bg-coal p-4">
                    <Label>{s.replace("_", " ")}</Label>
                    <div className={`mt-1 ${s === "approved" ? "text-amber" : ""}`}>
                      <Stat value={byStatus(s)} />
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            {unrecoverable.length > 0 && (
              <Section title="lost — streamed, never captured">
                <div className="px-4 py-3">
                  <p className="text-[12px] leading-relaxed text-warmgray">
                    {unrecoverable.length} stream{unrecoverable.length === 1 ? "" : "s"} went out
                    on Kick and were never downloaded. Kick has since deleted them. This is what
                    the archive exists to prevent.
                  </p>
                </div>
              </Section>
            )}
          </div>
        </div>
      </Body>
    </Shell>
  );
}
