import { notFound } from "next/navigation";
import { INTERNAL_TOOLS_ENABLED } from "@/lib/internal-only";
import { daysLeft, getLibrary, getPreparedStreams, getStreams, type StreamRecord } from "@/lib/yp";
import { Body, Chip, EmptyState, Label, Panel, Section, Shell, Stat, TopBar } from "../yp-chrome";
import { AddStream, ArchiveNow, StreamRow } from "./streams-client";

export const dynamic = "force-dynamic";

function hours(rec: StreamRecord) {
  const s = rec.measured_duration_s ?? rec.duration_s ?? 0;
  return `${(s / 3600).toFixed(2)}h`;
}

/**
 * Two streams can share a date and a title — it happened on 2026-08-12, where a
 * six-minute false start and a three-hour session were both "Live Session w/
 * Rochester". The length is what tells them apart, so it is on the row.
 */
export default async function StreamsPage() {
  if (!INTERNAL_TOOLS_ENABLED) notFound();
  const [{ archived, atRisk, unrecoverable, scan }, prepared, { clips }] = await Promise.all([
    getStreams(),
    getPreparedStreams(),
    getLibrary(),
  ]);

  const clipCounts = new Map<string, number>();
  for (const c of clips) if (c.date) clipCounts.set(c.date, (clipCounts.get(c.date) ?? 0) + 1);

  const archivedHours = archived.reduce(
    (a, r) => a + (r.measured_duration_s ?? r.duration_s ?? 0) / 3600,
    0
  );
  const archivedBytes = archived.reduce((a, r) => a + (r.bytes ?? 0), 0);
  const riskHours = atRisk.reduce((a, r) => a + (r.duration_s ?? 0) / 3600, 0);
  const urgent = atRisk[0] ? daysLeft(atRisk[0]) : null;

  return (
    <Shell active="Streams">
      <TopBar
        title="Streams"
        actions={<Label>kick keeps a non-verified vod ~30 days</Label>}
      >
        <Chip>channel · yanchanproduced</Chip>
        <Chip>{archived.length} archived</Chip>
      </TopBar>

      <Body>
        {scan.state === "stale" && (
          <Panel className="flex items-center gap-6 border-sienna/55 bg-sienna/[0.12] p-5">
            <div className="min-w-0 flex-1">
              <div className="font-head text-sm font-black uppercase text-cream">
                the kick scan is out of date
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-warmgray">
                {scan.message} On 2026-09-06 this screen showed “0 at risk” from a scan nineteen
                days old, while three streams sat uncaptured — two of them a fortnight from
                deletion. So it says nothing rather than saying zero.
              </p>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-display text-4xl leading-none text-sienna">
                {scan.ageDays === null ? "—" : `${Math.round(scan.ageDays)}d`}
              </div>
              <Label>{scan.ageDays === null ? "never scanned" : "since the last scan"}</Label>
            </div>
          </Panel>
        )}

        {scan.state === "fresh" && (
          <div className="flex items-center gap-2 px-1">
            <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-mint" />
            <Label>{scan.message}</Label>
          </div>
        )}

        {atRisk.length > 0 && (
          <Panel className="flex items-center gap-6 border-sienna/55 bg-rust/20 p-5">
            <div className="min-w-0 flex-1">
              <div className="font-head text-sm font-black uppercase text-cream">
                {atRisk.length} stream{atRisk.length === 1 ? "" : "s"} on Kick are not archived
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-warmgray">
                {riskHours.toFixed(1)} hours of source. Once Kick deletes a VOD it is gone — the
                three oldest streams we hold survive only because someone downloaded them by hand.
              </p>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-display text-4xl leading-none text-sienna">{urgent}d</div>
              <Label>until the first is deleted</Label>
            </div>
          </Panel>
        )}

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Panel className="p-4">
            <Label>archived</Label>
            <div className="mt-1">
              <Stat value={archived.length} />
            </div>
            <div className="text-[11px] text-warmgray">{archivedHours.toFixed(1)}h of source</div>
          </Panel>
          <Panel className="p-4">
            <Label>storage used</Label>
            <div className="mt-1">
              <Stat value={(archivedBytes / 1e9).toFixed(1)} unit="GB" />
            </div>
            <div className="text-[11px] text-warmgray">~2.8 GB per stream</div>
          </Panel>
          {/*
            This is the tile that printed `AT RISK 0` from a nineteen-day-old
            scan. `scan.atRisk` is null when the scan is too old to know, and
            null renders as a dash — the count is only shown when it means
            something.
          */}
          <Panel className="p-4">
            <Label>at risk on kick</Label>
            <div
              className={`mt-1 ${
                scan.atRisk === null ? "text-sienna" : atRisk.length ? "text-sienna" : ""
              }`}
            >
              <Stat value={scan.atRisk === null ? "—" : scan.atRisk} />
            </div>
            <div className="text-[11px] text-warmgray">
              {scan.atRisk === null
                ? "unknown — the scan is stale"
                : `${riskHours.toFixed(1)}h unarchived`}
            </div>
          </Panel>
          <Panel className="p-4">
            <Label>ready to edit</Label>
            <div className="mt-1 text-amber">
              <Stat value={prepared.size} display />
            </div>
            <div className="text-[11px] text-warmgray">
              {/* Clamped: a prepared stream that is no longer in the archived
                  list (its status changed) made this read "-1 still need
                  preparing", which is not a number anyone can act on. */}
              {Math.max(0, archived.length - prepared.size)} still need preparing
            </div>
          </Panel>
        </div>

        {atRisk.length > 0 && (
          <Section title="on kick, not archived — most urgent first">
            {atRisk.map((r) => {
              const left = daysLeft(r);
              return (
                <div
                  key={r.uuid}
                  className="flex items-center gap-4 border-b border-white/[0.06] px-4 py-3 last:border-b-0"
                >
                  <div className="min-w-0 flex-1 truncate text-[13.5px] text-cream">{r.title}</div>
                  <span className="w-[92px] shrink-0 font-mono text-xs text-warmgray">
                    {r.stream_date}
                  </span>
                  <span className="w-[64px] shrink-0 text-right font-mono text-xs text-warmgray">
                    {hours(r)}
                  </span>
                  <div className="w-[92px] shrink-0 text-right">
                    <Chip tone={left <= 7 ? "rust" : "muted"}>{left}d left</Chip>
                  </div>
                  <ArchiveNow uuid={r.uuid} hls={r.source_hls} slug={r.slug} />
                </div>
              );
            })}
          </Section>
        )}

        {/* Taking a stream in was the one step of this pipeline that had no
            screen at all: `scan_kick.py`, then `ingest.py --backfill`, in a
            terminal. It sits above the archive because it is what fills it. */}
        <Section
          title="add a stream"
          actions={<Label>kick vod url, or a path to a file</Label>}
        >
          <AddStream />
        </Section>

        <Section
          title="archived · safe"
          actions={<Label>open one to start clipping</Label>}
        >
          {archived.length === 0 ? (
            <EmptyState
              title="Nothing archived yet"
              body="Paste a Kick VOD link or a local file path into Add stream above. Kick keeps a non-verified channel's VOD for about thirty days, so the ones still on Kick are on a clock."
            />
          ) : (
            archived.map((r) => (
              <StreamRow
                key={r.uuid}
                href={`/dashboard/timeline?stream=${r.stream_date}`}
                title={r.title ?? "untitled stream"}
                date={r.stream_date ?? ""}
                hours={hours(r)}
                gb={((r.bytes ?? 0) / 1e9).toFixed(2)}
                clips={r.stream_date ? clipCounts.get(r.stream_date) ?? 0 : 0}
                ready={r.stream_date ? prepared.has(r.stream_date) : false}
                partialNote={r.status === "partial" ? r.note : undefined}
              />
            ))
          )}
        </Section>

        {unrecoverable.length > 0 && (
          <Section title="unrecoverable — streamed, never captured, gone from kick">
            {unrecoverable.map((r) => (
              <div
                key={r.uuid}
                className="flex items-center gap-4 border-b border-white/[0.06] px-4 py-2.5 text-[12.5px] text-warmgray last:border-b-0"
              >
                <span className="w-[92px] shrink-0 font-mono text-xs">{r.stream_date}</span>
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
              </div>
            ))}
          </Section>
        )}
      </Body>
    </Shell>
  );
}
