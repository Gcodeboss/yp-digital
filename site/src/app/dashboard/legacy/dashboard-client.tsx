"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Check,
  Clock,
  Download,
  Gauge,
  Layers,
  Link2,
  Play,
  RefreshCw,
  Save,
  Scissors,
  Share2,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  Wand2,
  Zap,
} from "lucide-react";
import {
  formatMoney,
  weightedPipeline,
  type ActivityItem,
  type Clip,
  type ClipStatus,
  type OpsDashboardState,
} from "@/lib/ops-dashboard";

type Area = ActivityItem["area"];
type ClipLane = "Ranked" | "Approved" | "Needs Edit" | "Exported";

const clipStatusClass: Record<ClipStatus, string> = {
  "Pending Review": "border-amber/40 bg-amber/10 text-amber",
  Approved: "border-cream/25 bg-cream/10 text-cream",
  "Needs Edit": "border-sienna/50 bg-sienna/15 text-cream",
  Scheduled: "border-gold/40 bg-gold/10 text-gold",
  Posted: "border-amber/60 bg-amber/20 text-amber",
  Rejected: "border-white/15 bg-white/5 text-warmgray",
};

function numberCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function newActivity(area: Area, title: string, detail: string): ActivityItem {
  return {
    id: `activity-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: new Date().toISOString(),
    area,
    title,
    detail,
  };
}

function prependActivity(
  state: OpsDashboardState,
  area: Area,
  title: string,
  detail: string,
): OpsDashboardState {
  return {
    ...state,
    activity: [newActivity(area, title, detail), ...state.activity].slice(
      0,
      40,
    ),
  };
}

function clipUrl(clip: Clip) {
  const relative = clip.sourcePath.replace(/^clips\//, "");
  return `/api/clip/${relative.split("/").map(encodeURIComponent).join("/")}`;
}

function Badge({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-[4px] border px-2.5 py-1 font-mono text-[0.64rem] uppercase tracking-[0.12em] ${className}`}
    >
      {children}
    </span>
  );
}

function Metric({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-warmgray">
          {label}
        </span>
        <span className="text-amber">{icon}</span>
      </div>
      <p className="font-head text-3xl font-black uppercase text-cream">
        {value}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-warmgray">{detail}</p>
    </div>
  );
}

function PrimaryAction({
  children,
  icon,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center gap-2 rounded-[4px] bg-amber px-5 py-3 font-head text-sm font-black uppercase tracking-[0.04em] text-void transition-colors hover:bg-sienna disabled:cursor-not-allowed disabled:opacity-50"
    >
      {icon}
      {children}
    </button>
  );
}

function SecondaryAction({
  children,
  icon,
  onClick,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center gap-2 rounded-[4px] border border-white/15 px-4 py-3 font-head text-sm font-black uppercase tracking-[0.04em] text-cream transition-colors hover:border-amber hover:text-amber"
    >
      {icon}
      {children}
    </button>
  );
}

function PipelineStep({
  label,
  detail,
  icon,
  active,
}: {
  label: string;
  detail: string;
  icon: React.ReactNode;
  active?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        active ? "border-amber/50 bg-amber/10" : "border-white/10 bg-coal"
      }`}
    >
      <div className="mb-3 flex items-center gap-2 text-amber">{icon}</div>
      <p className="font-head text-sm font-black uppercase text-cream">
        {label}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-warmgray">{detail}</p>
    </div>
  );
}

function ClipRow({
  clip,
  active,
  rank,
  onSelect,
}: {
  clip: Clip;
  active: boolean;
  rank: number;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`grid w-full gap-4 rounded-lg border p-4 text-left transition-colors md:grid-cols-[auto_1fr_auto] md:items-center ${
        active
          ? "border-amber/60 bg-amber/10"
          : "border-white/10 bg-white/[0.03] hover:border-white/25"
      }`}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-[4px] bg-void font-head text-lg font-black text-amber">
        {rank}
      </div>
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge className={clipStatusClass[clip.status]}>{clip.status}</Badge>
          <Badge className="border-white/15 bg-white/5 text-warmgray">
            {clip.start}
          </Badge>
          <Badge className="border-amber/30 bg-amber/10 text-amber">
            {clip.context}
          </Badge>
        </div>
        <p className="break-words font-head text-sm font-black uppercase leading-snug text-cream">
          {clip.hook}
        </p>
        <p className="mt-2 text-sm text-warmgray">{clip.platform}</p>
      </div>
      <div className="flex items-center justify-between gap-4 md:block md:text-right">
        <p className="font-head text-2xl font-black text-cream">
          {clip.score.toFixed(1)}
        </p>
        <p
          className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-warmgray"
          title="How strongly music is playing, weighted by sustained vocal. Ranks moments inside one stream; not comparable between streams, and not a prediction of reach."
        >
          Music strength
        </p>
      </div>
    </button>
  );
}

function DealMiniCard({
  brand,
  category,
  value,
  note,
}: {
  brand: string;
  category: string;
  value: number;
  note: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-coal p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="font-head text-sm font-black uppercase text-cream">
            {brand}
          </p>
          <p className="mt-1 text-xs text-warmgray">{category}</p>
        </div>
        <p className="font-mono text-xs text-amber">{formatMoney(value)}</p>
      </div>
      <p className="text-sm leading-relaxed text-warmgray">{note}</p>
    </div>
  );
}

export function DashboardClient() {
  const [data, setData] = useState<OpsDashboardState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [selectedClipId, setSelectedClipId] = useState("");
  const [lane, setLane] = useState<ClipLane>("Ranked");

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await fetch("/api/ops-dashboard", {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Dashboard API failed");
        const state = (await response.json()) as OpsDashboardState;
        if (!active) return;
        const ranked = [...state.clips].sort((a, b) => b.score - a.score);
        setData(state);
        setSelectedClipId(ranked[0]?.id || "");
      } catch {
        if (active) setLoadError("Unable to load clip studio state.");
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  const rankedClips = useMemo(() => {
    if (!data) return [];
    return [...data.clips].sort((a, b) => b.score - a.score);
  }, [data]);

  const selectedClip = useMemo(() => {
    return (
      rankedClips.find((clip) => clip.id === selectedClipId) ?? rankedClips[0]
    );
  }, [rankedClips, selectedClipId]);

  const visibleClips = useMemo(() => {
    if (lane === "Ranked") return rankedClips;
    if (lane === "Approved") {
      return rankedClips.filter((clip) =>
        ["Approved", "Scheduled", "Posted"].includes(clip.status),
      );
    }
    if (lane === "Needs Edit") {
      return rankedClips.filter((clip) => clip.status === "Needs Edit");
    }
    return rankedClips.filter((clip) =>
      ["Scheduled", "Posted"].includes(clip.status),
    );
  }, [lane, rankedClips]);

  const stats = useMemo(() => {
    if (!data) {
      return {
        candidates: 0,
        approved: 0,
        edit: 0,
        exportReady: 0,
        avgScore: 0,
        pipeline: 0,
      };
    }

    const scored = data.clips.reduce((sum, clip) => sum + clip.score, 0);
    return {
      candidates: data.clips.length,
      approved: data.clips.filter((clip) => clip.status === "Approved").length,
      edit: data.clips.filter((clip) => clip.status === "Needs Edit").length,
      exportReady: data.clips.filter((clip) =>
        ["Approved", "Scheduled", "Posted"].includes(clip.status),
      ).length,
      avgScore: data.clips.length ? scored / data.clips.length : 0,
      pipeline: weightedPipeline(data.deals),
    };
  }, [data]);

  const firstFiveDeals = useMemo(() => {
    if (!data) return [];
    return data.deals.filter((deal) => deal.priority <= 5).slice(0, 5);
  }, [data]);

  function commit(next: OpsDashboardState) {
    setData(next);
    setDirty(true);
    setToast("");
  }

  function updateClipStatus(clip: Clip, status: ClipStatus) {
    if (!data) return;
    commit(
      prependActivity(
        {
          ...data,
          clips: data.clips.map((item) =>
            item.id === clip.id
              ? {
                  ...item,
                  status,
                  schedule:
                    status === "Scheduled" && !item.schedule
                      ? "Prime slot: next 7-day cadence"
                      : item.schedule,
                  notes:
                    status === "Needs Edit"
                      ? "Needs tighter hook, caption polish, or crop review."
                      : item.notes,
                }
              : item,
          ),
        },
        "Content",
        `Clip ${clip.start} moved to ${status}`,
        `${clip.context} moment is now in the ${status} lane.`,
      ),
    );
  }

  function approveTopEight() {
    if (!data) return;
    const topIds = rankedClips.slice(0, 8).map((clip) => clip.id);
    commit(
      prependActivity(
        {
          ...data,
          clips: data.clips.map((clip) =>
            topIds.includes(clip.id) ? { ...clip, status: "Approved" } : clip,
          ),
        },
        "Content",
        "Top 8 moments approved",
        "The highest-scored candidates are ready for crop, caption, and export review.",
      ),
    );
  }

  function markExportPack() {
    if (!data) return;
    const exportIds = rankedClips
      .filter((clip) =>
        ["Approved", "Scheduled", "Posted"].includes(clip.status),
      )
      .slice(0, 8)
      .map((clip) => clip.id);

    commit(
      prependActivity(
        {
          ...data,
          clips: data.clips.map((clip) =>
            exportIds.includes(clip.id)
              ? { ...clip, status: "Scheduled", schedule: "Export pack v1" }
              : clip,
          ),
        },
        "Content",
        "Export pack staged",
        `${exportIds.length} clips staged for TikTok, Reels, Shorts, and Kick recap packaging.`,
      ),
    );
  }

  function runAiPass() {
    if (!data) return;
    const target = selectedClip ?? rankedClips[0];
    if (!target) return;

    commit(
      prependActivity(
        {
          ...data,
          clips: data.clips.map((clip) =>
            clip.id === target.id
              ? {
                  ...clip,
                  notes:
                    "AI polish pass queued: tighten first 2 seconds, write hook-first caption, check 9:16 crop, keep one CTA.",
                }
              : clip,
          ),
        },
        "Content",
        `AI polish queued for ${target.start}`,
        "This is a draft/prep action only. Human approval still gates export and posting.",
      ),
    );
  }

  async function save() {
    if (!data) return;
    setSaving(true);
    setToast("");
    try {
      const response = await fetch("/api/ops-dashboard", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Save failed");
      const saved = (await response.json()) as OpsDashboardState;
      setData(saved);
      setDirty(false);
      setToast("Saved");
    } catch {
      setToast("Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <main className="min-h-dvh bg-void px-5 py-10 text-cream">
        <div className="mx-auto max-w-xl rounded-lg border border-rust/60 bg-rust/20 p-6">
          <p className="font-head text-lg font-black uppercase">{loadError}</p>
        </div>
      </main>
    );
  }

  if (!data || !selectedClip) {
    return (
      <main className="min-h-dvh bg-void px-5 py-8 text-cream">
        <div className="mx-auto flex max-w-[1500px] items-center gap-3 text-amber">
          <RefreshCw size={18} className="animate-spin" />
          <span className="font-head text-sm font-black uppercase">
            Loading clip engine
          </span>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh overflow-x-hidden bg-void px-5 py-5 text-cream sm:px-8">
      <div className="mx-auto max-w-[1500px]">
        <header className="flex flex-col gap-5 border-b border-white/10 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge className="border-amber/40 bg-amber/10 text-amber">
                Yanchan Clip Engine
              </Badge>
              <Badge className="border-white/15 bg-white/5 text-warmgray">
                Local VOD Studio
              </Badge>
            </div>
            <h1 className="max-w-4xl font-head text-[2.6rem] font-black uppercase leading-[0.95] text-cream sm:text-6xl">
              Long stream in.
              <span className="block text-amber">Shorts pack out.</span>
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-warmgray">
              A focused clipping console for turning Yanchan&apos;s Kick streams
              and studio captures into ranked, reviewable, export-ready social
              clips.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:w-[360px]">
            <PrimaryAction
              onClick={save}
              disabled={saving || !dirty}
              icon={
                saving ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : (
                  <Save size={16} />
                )
              }
            >
              {dirty ? "Save" : toast || "Saved"}
            </PrimaryAction>
            <SecondaryAction
              onClick={markExportPack}
              icon={<Download size={16} />}
            >
              Export Pack
            </SecondaryAction>
          </div>
        </header>

        <section className="grid gap-5 py-6 xl:grid-cols-[1fr_1.05fr]">
          <div className="rounded-lg border border-amber/30 bg-gradient-to-br from-rust/30 via-charcoal to-coal p-5 sm:p-6">
            <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
              <div>
                <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-amber">
                  Source loaded
                </p>
                <h2 className="mt-3 font-head text-3xl font-black uppercase leading-tight text-cream sm:text-4xl">
                  2h42m Kick VOD
                </h2>
                <p className="mt-3 max-w-xl text-sm leading-relaxed text-cream/75">
                  30 clips generated, 15 high-potential moments loaded here.
                  Next version should accept a fresh VOD link or file and run
                  this whole pass from one screen.
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-void/70 p-4">
                <UploadCloud className="text-amber" size={26} />
                <p className="mt-3 font-head text-sm font-black uppercase text-cream">
                  Drop VOD / paste link
                </p>
                <p className="mt-1 text-xs leading-relaxed text-warmgray">
                  Import UI shell ready. Pipeline wiring comes next.
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric
                label="AI Candidates"
                value={String(stats.candidates)}
                detail="Ranked from the source stream."
                icon={<Sparkles size={18} />}
              />
              <Metric
                label="Avg Score"
                value={stats.avgScore.toFixed(1)}
                detail="Signal from transcript + audio cues."
                icon={<Gauge size={18} />}
              />
              <Metric
                label="Export Ready"
                value={String(stats.exportReady)}
                detail="Approved, scheduled, or posted."
                icon={<Download size={18} />}
              />
              <Metric
                label="Audience"
                value={numberCompact(data.metrics.socialAudience)}
                detail="Traffic to push into owned email."
                icon={<Share2 size={18} />}
              />
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-5">
              <PipelineStep
                active
                label="Import"
                detail="Kick VOD loaded"
                icon={<UploadCloud size={18} />}
              />
              <PipelineStep
                active
                label="Detect"
                detail="Moments scored"
                icon={<Wand2 size={18} />}
              />
              <PipelineStep
                active
                label="Hook"
                detail="Captions drafted"
                icon={<Zap size={18} />}
              />
              <PipelineStep
                label="Reframe"
                detail="9:16 crop next"
                icon={<Scissors size={18} />}
              />
              <PipelineStep
                label="Export"
                detail="Pack for socials"
                icon={<Download size={18} />}
              />
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <PrimaryAction
                onClick={approveTopEight}
                icon={<Check size={16} />}
              >
                Approve Top 8
              </PrimaryAction>
              <SecondaryAction
                onClick={runAiPass}
                icon={<Sparkles size={16} />}
              >
                AI Polish Selected
              </SecondaryAction>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-charcoal/70 p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-amber">
                  Selected moment
                </p>
                <h2 className="mt-2 font-head text-2xl font-black uppercase text-cream">
                  {selectedClip.start} / {selectedClip.context}
                </h2>
              </div>
              <Badge className={clipStatusClass[selectedClip.status]}>
                {selectedClip.status}
              </Badge>
            </div>

            <div className="overflow-hidden rounded-lg border border-white/10 bg-void">
              <video
                key={selectedClip.id}
                src={clipUrl(selectedClip)}
                controls
                preload="metadata"
                className="aspect-video w-full bg-black object-contain"
              />
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_190px]">
              <div>
                <p className="font-head text-xl font-black uppercase leading-tight text-cream">
                  {selectedClip.hook}
                </p>
                <p className="mt-3 text-sm leading-relaxed text-warmgray">
                  CTA: {selectedClip.cta}. Platform fit: {selectedClip.platform}
                  . Cross-post: {selectedClip.crossPost}.
                </p>
              </div>
              <div className="rounded-lg border border-amber/30 bg-amber/10 p-4 text-center">
                <p className="font-head text-5xl font-black text-cream">
                  {selectedClip.score.toFixed(1)}
                </p>
                <p className="mt-1 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-amber">
                  Music strength
                </p>
                <p className="mt-1 font-mono text-[0.55rem] leading-tight text-warmgray">
                  ranks within this stream
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-4">
              {(
                ["Approved", "Needs Edit", "Scheduled", "Rejected"] as const
              ).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => updateClipStatus(selectedClip, status)}
                  className="rounded-[4px] border border-white/15 px-3 py-3 font-head text-xs font-black uppercase text-cream transition-colors hover:border-amber hover:text-amber"
                >
                  {status === "Scheduled" ? "Export" : status}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.1fr_0.7fr]">
          <div className="rounded-lg border border-white/10 bg-charcoal/70 p-5">
            <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-amber">
                  Ranked moments
                </p>
                <h2 className="mt-2 font-head text-2xl font-black uppercase text-cream">
                  Review queue
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {(
                  ["Ranked", "Approved", "Needs Edit", "Exported"] as const
                ).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setLane(item)}
                    className={`rounded-[4px] border px-3 py-2 font-head text-xs font-black uppercase transition-colors ${
                      lane === item
                        ? "border-amber bg-amber text-void"
                        : "border-white/15 text-cream hover:border-amber hover:text-amber"
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3">
              {visibleClips.map((clip, index) => (
                <ClipRow
                  key={clip.id}
                  clip={clip}
                  rank={index + 1}
                  active={selectedClip.id === clip.id}
                  onSelect={() => setSelectedClipId(clip.id)}
                />
              ))}
              {!visibleClips.length && (
                <div className="rounded-lg border border-white/10 bg-coal p-8 text-center text-warmgray">
                  No clips in this lane yet.
                </div>
              )}
            </div>
          </div>

          <div className="grid content-start gap-6">
            <div className="rounded-lg border border-white/10 bg-charcoal/70 p-5">
              <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-amber">
                Export recipe
              </p>
              <h2 className="mt-2 font-head text-2xl font-black uppercase text-cream">
                One-click pack
              </h2>
              <div className="mt-5 grid gap-3">
                {[
                  ["9:16 crop", "Center speaker and action"],
                  ["Hook title", "First 2 seconds carry the scroll-stop"],
                  ["Caption", "Hook-first, one CTA max"],
                  ["Platforms", "TikTok, Reels, Shorts, Kick recap"],
                ].map(([label, detail]) => (
                  <div
                    key={label}
                    className="flex items-start gap-3 rounded-lg border border-white/10 bg-coal p-4"
                  >
                    <ShieldCheck
                      className="mt-0.5 shrink-0 text-amber"
                      size={18}
                    />
                    <div>
                      <p className="font-head text-sm font-black uppercase text-cream">
                        {label}
                      </p>
                      <p className="mt-1 text-sm text-warmgray">{detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-charcoal/70 p-5">
              <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-amber">
                Monetization rail
              </p>
              <h2 className="mt-2 font-head text-2xl font-black uppercase text-cream">
                Sponsor angles
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-warmgray">
                Keep this secondary. The main product is clipping; brand deals
                attach to winning content after the fact.
              </p>
              <div className="mt-5 grid gap-3">
                {firstFiveDeals.slice(0, 3).map((deal) => (
                  <DealMiniCard
                    key={deal.id}
                    brand={deal.brand}
                    category={deal.category}
                    value={deal.dealValue}
                    note={`Match a top ${selectedClip.context} clip to a bridge-first sponsored concept.`}
                  />
                ))}
              </div>
              <div className="mt-4 rounded-lg border border-white/10 bg-coal p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-head text-sm font-black uppercase text-cream">
                    Weighted pipeline
                  </span>
                  <span className="font-mono text-sm text-amber">
                    {formatMoney(stats.pipeline)}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-charcoal/70 p-5">
              <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-amber">
                Latest moves
              </p>
              <div className="mt-4 grid gap-3">
                {data.activity.slice(0, 5).map((item) => (
                  <div
                    key={item.id}
                    className="border-b border-white/8 pb-3 last:border-b-0"
                  >
                    <div className="mb-1 flex items-center gap-2">
                      {item.area === "Content" ? (
                        <Play size={13} className="text-amber" />
                      ) : item.area === "Brand Deals" ? (
                        <Layers size={13} className="text-amber" />
                      ) : (
                        <Clock size={13} className="text-amber" />
                      )}
                      <p className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-warmgray">
                        {item.area}
                      </p>
                    </div>
                    <p className="font-head text-sm font-bold text-cream">
                      {item.title}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-warmgray">
                      {item.detail}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <footer className="mt-6 flex flex-col gap-3 border-t border-white/10 py-5 text-sm text-warmgray md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-white/15 bg-white/5 text-warmgray">
              Human approval gate
            </Badge>
            <Badge className="border-white/15 bg-white/5 text-warmgray">
              No auto-posting
            </Badge>
            <Badge className="border-white/15 bg-white/5 text-warmgray">
              Local state
            </Badge>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 font-head text-xs font-black uppercase text-amber hover:text-cream"
          >
            <Link2 size={14} />
            Public site
          </Link>
        </footer>
      </div>
    </main>
  );
}
