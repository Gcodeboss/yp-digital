"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Chip, Label } from "../yp-chrome";

type Row = {
  path: string;
  date: string;
  start: number;
  time: string;
  duration: number;
  tag: string;
  selector: string;
  score: number;
  status: string;
  hook: string;
  caption: string;
  excerpt: string;
};

/** One library clip's file on disk, from /api/yp/render. */
type FileState = {
  path: string;
  expected: string;
  rendered: boolean;
  stale: boolean;
  currentRendered: boolean;
  bytes: number;
  mtime: number;
};

/** Where a detached compose.py run is, from /api/yp/render?stream=. */
type Progress = {
  stream: string;
  scope: "stream" | "clip";
  clip: string | null;
  running: boolean;
  finished: boolean;
  total: number;
  done: number;
  remaining: number;
  current: string | null;
  failed: { name: string; reason: string }[];
  skipped: { name: string; reason: string }[];
  startedAt: number | null;
  error: string | null;
  tail: string[];
};

type Check = {
  name: string;
  ok: boolean;
  failed: { clip: string; reason: string }[];
  warned: { clip: string; reason: string }[];
};

type Qa = {
  ran: boolean;
  ok?: boolean;
  clips?: number;
  passed?: number;
  failed?: number;
  checks?: Check[];
  results?: { name: string; ok: boolean; failures: string[]; warnings: string[] }[];
  error?: string | null;
};

const NEXT: Record<string, string> = {
  new: "approved",
  approved: "needs_edit",
  needs_edit: "rejected",
  rejected: "new",
};

/**
 * Rule 2, applied to the one column that carries a decision.
 *
 * Every status used to be an amber or rust pill, which made a column of badges
 * read as decoration rather than as state. Approved is the end state the machine
 * can act on, so it wears mint — the system-OK tone, on a dot rather than a fill.
 * needs_edit and rejected are the two "something is wrong" states and share
 * sienna. New is unread and stays grey. Amber is spent on the filter you are
 * looking through, which is the only "now" on this screen.
 */
const STATUS: Record<string, { text: string; dot: string; edge: string }> = {
  approved: { text: "text-mint", dot: "bg-mint", edge: "border-line-strong" },
  needs_edit: { text: "text-sienna", dot: "bg-sienna", edge: "border-sienna/50" },
  rejected: { text: "text-ink-dim", dot: "bg-sienna/60", edge: "border-line" },
  posted: { text: "text-ink", dot: "bg-mint", edge: "border-line-strong" },
  new: { text: "text-ink-dim", dot: "bg-ink-faint", edge: "border-line-strong" },
};

/** Gold is a vocal take; a beat, and everything else, is warm grey. Rule 2. */
const tagTone = (tag: string) => (tag === "singing" ? "text-gold" : "text-ink-dim");

/**
 * A music pick and a speech pick are different kinds of bet, and until now they
 * looked identical in this queue.
 *
 * "music" means the audio got loud and tonal at this timestamp — a narrow,
 * reliable claim about the waveform. "speech" means a transcript heuristic
 * thought he said something worth hearing, which is a much larger claim and
 * wrong more often. "hand" means a person drew this range on the timeline, which
 * is the strongest provenance there is. Approving the three deserves different
 * amounts of scepticism, so the queue says which is which.
 */
const SELECTOR_LABEL: Record<string, { short: string; why: string }> = {
  music: {
    short: "music",
    why: "Found by the music selector: sustained, loud and tonal audio here. A claim about the waveform, not about what was said.",
  },
  speech: {
    short: "speech",
    why: "Found by the speech selector reading the transcript. A larger claim than the music one, and wrong more often — worth watching before approving.",
  },
  hand: {
    short: "hand",
    why: "Cut by hand on the timeline. No selector proposed this; someone chose it.",
  },
};

/** The row grid, shared by the column header so the two cannot drift apart. */
const ROW = "grid grid-cols-[72px_minmax(0,1fr)_84px_48px_64px_112px] items-center gap-3 px-3";
const MICRO = "font-head text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-dim";
/** A 24px label/value rule. The right rail is three of these stacked. */
const READOUT = "flex h-6 items-center justify-between border-b border-line";

const json = { "content-type": "application/json" };
const basename = (p: string) => (p.split("/").pop() ?? "").replace(/\.mp4$/, "");

type Pack = { id: string; clips: number; bytes: number; built: number };

export function ReviewClient({ clips }: { clips: Row[] }) {
  const [rows, setRows] = useState(clips);
  const [filter, setFilter] = useState<string>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [packing, setPacking] = useState(false);
  const [packMsg, setPackMsg] = useState<string | null>(null);
  // Packs already on disk. The pack was the one artifact the tool produces that
  // the operator had no way to see, let alone take.
  const [packs, setPacks] = useState<Pack[]>([]);
  // Copy editing. `set-copy` has been implemented end to end since the library
  // gained a creator layer and was called by nothing — the hook a person writes
  // is the one field in a clip that no machine can supply.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ hook: string; caption: string }>({ hook: "", caption: "" });
  const [savingCopy, setSavingCopy] = useState(false);
  // Watching the clip before approving it. `/api/clip/[...path]` has streamed
  // MP4s with byte-range support since the timeline was built and was wired to
  // nothing — so approval was a judgement made from a filename and a score.
  const [watching, setWatching] = useState<string | null>(null);

  // Render and QA state. Everything here is read from the pipeline's own output
  // through /api/yp/render and /api/yp/qa — this screen holds no opinion about
  // whether a clip is finished, it reports what is on disk.
  const [files, setFiles] = useState<Record<string, FileState>>({});
  const [progress, setProgress] = useState<Progress | null>(null);
  const [renderMsg, setRenderMsg] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [force, setForce] = useState(false);
  const [qa, setQa] = useState<Qa | null>(null);
  const [qaBusy, setQaBusy] = useState(false);
  const [qaMsg, setQaMsg] = useState<string | null>(null);
  const [packAnyway, setPackAnyway] = useState(false);

  const dates = useMemo(() => [...new Set(clips.map((c) => c.date))].sort().reverse(), [clips]);
  const shown = filter === "all" ? rows : rows.filter((r) => r.date === filter);
  const approved = rows.filter((r) => r.status === "approved");

  /** Rendering and QA are per-stream, so they need one picked. */
  const stream = filter === "all" ? null : filter;
  const batch = stream ? rows.filter((r) => r.date === stream) : [];
  const batchDone = batch.filter((r) => files[r.path]?.rendered).length;

  const merge = useCallback((list: FileState[]) => {
    setFiles((prev) => ({ ...prev, ...Object.fromEntries(list.map((f) => [f.path, f])) }));
  }, []);

  useEffect(() => {
    void fetch("/api/yp/export", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { packs?: Pack[] }) => setPacks(d.packs ?? []))
      .catch(() => {});
  }, []);

  /** Write the hook and caption straight to the library, as `set-copy` already does. */
  const saveCopy = useCallback(
    async (clipPath: string) => {
      setSavingCopy(true);
      try {
        await fetch("/api/yp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "set-copy",
            clip: clipPath,
            copy: { hook: draft.hook, caption: draft.caption },
          }),
        });
        // Same pattern as cycle(): update the row in place. The library is the
        // store of record and the write already succeeded; a full refetch would
        // cost a round trip to show what we already know.
        setRows((prev) =>
          prev.map((r) =>
            r.path === clipPath ? { ...r, hook: draft.hook, caption: draft.caption } : r
          )
        );
        setEditing(null);
      } finally {
        setSavingCopy(false);
      }
    },
    [draft]
  );

  /** Every clip's file state, for the export pack's arithmetic. */
  const loadFiles = useCallback(async () => {
    try {
      const res = await fetch("/api/yp/render", { cache: "no-store" });
      if (!res.ok) return;
      merge(((await res.json()) as { clips: FileState[] }).clips);
    } catch {
      /* the routes 404 when internal tools are off; the table still works */
    }
  }, [merge]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  // Switching streams loads that batch's render progress and its last QA report.
  // The QA GET re-reads work/qa.json rather than re-running the checks — opening
  // a screen should not start a 14-second job.
  useEffect(() => {
    let dead = false;
    void (async () => {
      if (!stream) {
        // Awaited first so the reset is not a synchronous setState in an effect
        // body, which React 19's linter treats as a cascading render.
        await Promise.resolve();
        if (dead) return;
        setProgress(null);
        setQa(null);
        setRenderMsg(null);
        setQaMsg(null);
        return;
      }
      const [r, q] = await Promise.all([
        fetch(`/api/yp/render?stream=${stream}`, { cache: "no-store" })
          .then((x) => x.json())
          .catch(() => null),
        fetch(`/api/yp/qa?stream=${stream}`, { cache: "no-store" })
          .then((x) => x.json())
          .catch(() => null),
      ]);
      if (dead) return;
      if (r?.progress) setProgress(r.progress as Progress);
      if (r?.clips) merge(r.clips as FileState[]);
      setQa((q as Qa) ?? null);
    })();
    return () => {
      dead = true;
    };
  }, [stream, merge]);

  // A 10-clip batch is minutes long, so the answer has to arrive without a
  // reload. Polling stops the moment compose.py's summary line lands.
  useEffect(() => {
    if (!stream || !progress?.running) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/yp/render?stream=${stream}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { progress: Progress; clips: FileState[] };
        setProgress(data.progress);
        merge(data.clips);
      } catch {
        /* a dropped poll is not a failed render; the next one catches up */
      }
    }, 2000);
    return () => clearInterval(id);
  }, [stream, progress?.running, merge]);

  async function cycle(row: Row) {
    const status = NEXT[row.status] ?? "approved";
    setBusy(row.path);
    setRows((prev) => prev.map((r) => (r.path === row.path ? { ...r, status } : r)));
    await fetch("/api/yp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "set-status", clip: row.path, status }),
    });
    setBusy(null);
  }

  /**
   * Start a render. `clip` renders one; without it the whole stream goes.
   *
   * The route refuses a second run while one is live rather than queueing it, so
   * a double click reports "already running" instead of racing the first over the
   * same output files. Re-rendering a clip that already has an MP4 needs --force,
   * because compose.py otherwise skips anything finished on disk — which is also
   * what makes "render the batch" safe to press twice.
   */
  async function startRender(date: string, clip?: string) {
    setStarting(true);
    setRenderMsg(null);
    if (filter !== date) setFilter(date);
    try {
      const res = await fetch("/api/yp/render", {
        method: "POST",
        headers: json,
        body: JSON.stringify({
          stream: date,
          clip,
          force: clip ? force || Boolean(files[clip]?.rendered) : force,
        }),
      });
      const body = (await res.json()) as { error?: string; total?: number; progress?: Progress };
      if (!res.ok) {
        setRenderMsg(body.error ?? `render refused (${res.status})`);
        if (body.progress) setProgress(body.progress);
        return;
      }
      const now = await fetch(`/api/yp/render?stream=${date}`, { cache: "no-store" })
        .then((x) => x.json())
        .catch(() => null);
      if (now?.progress) setProgress(now.progress as Progress);
      setRenderMsg(clip ? `rendering ${basename(clip)}` : `rendering ${body.total ?? "?"} clip(s)`);
    } catch (err) {
      setRenderMsg(String(err).slice(0, 200));
    } finally {
      setStarting(false);
    }
  }

  async function runQa(date: string) {
    setQaBusy(true);
    setQaMsg(null);
    try {
      const res = await fetch("/api/yp/qa", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ stream: date }),
      });
      const body = (await res.json()) as Qa & { error?: string };
      if (!res.ok) {
        setQaMsg(body.error ?? `QA failed (${res.status})`);
        return;
      }
      setQa(body);
    } catch (err) {
      setQaMsg(String(err).slice(0, 200));
    } finally {
      setQaBusy(false);
    }
  }

  /**
   * What the mp4 column says about one clip.
   *
   * "stale" is the case worth naming: compose.py derives a clip's filename from
   * its in-point and tag, so retagging a clip in the timeline changes the file it
   * renders to while the library keeps the old path. The old MP4 is still there
   * and the export pack would still copy it, which is exactly the silent handoff
   * this screen exists to prevent.
   */
  function mp4State(r: Row) {
    const f = files[r.path];
    const name = basename(f?.expected ?? r.path);
    if (progress?.running && progress.current === name) {
      return { label: "rendering", tone: "text-amber", title: "compose.py is encoding this clip now" };
    }
    const fail = progress?.failed.find((x) => x.name === name);
    if (fail) return { label: "failed", tone: "text-sienna", title: fail.reason };
    const skip = progress?.skipped.find((x) => x.name === name);
    if (skip) return { label: "skipped", tone: "text-sienna", title: skip.reason };
    if (!f) return { label: "·", tone: "text-ink-faint", title: "checking disk" };
    if (!f.rendered) {
      return { label: "render", tone: "text-ink-dim", title: "no MP4 on disk — click to render this clip" };
    }
    if (f.stale) {
      return {
        label: "stale",
        tone: "text-sienna",
        title:
          `on disk as ${basename(f.path)}.mp4, but this clip now renders to ` +
          `${basename(f.expected)}.mp4${f.currentRendered ? " (already rendered)" : ""} — ` +
          `the export pack copies the old path either way. Click to re-render.`,
      };
    }
    return {
      label: "",
      tone: "text-mint",
      title: `${(f.bytes / 1e6).toFixed(1)} MB on disk — click to re-render`,
    };
  }

  // The export pack's honesty check. build_export_pack.py copies clip["path"] and
  // skips what is missing with a line on stderr that nobody sees, so an approved
  // clip that was never rendered used to leave the pack silently short.
  const unrendered = approved.filter((r) => !files[r.path]?.rendered);
  const staleApproved = approved.filter((r) => files[r.path]?.rendered && files[r.path]?.stale);
  const missingByDate = [...new Set(unrendered.map((r) => r.date))].sort().reverse();
  const packReady = unrendered.length === 0;

  return (
    <div className="flex gap-3">
      {/* The table is the screen. It is a region — a step up from ground, ruled
          by hairlines — rather than a bordered card, and its rows land on 32px
          so a session's worth of clips is one screenful. */}
      <div className="min-w-0 flex-1 bg-panel">
        <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2">
          <button onClick={() => setFilter("all")}>
            <Chip tone={filter === "all" ? "amber" : "muted"}>all · {rows.length}</Chip>
          </button>
          {dates.map((d) => (
            <button key={d} onClick={() => setFilter(d)}>
              <Chip tone={filter === d ? "amber" : "muted"}>
                {d} · {rows.filter((r) => r.date === d).length}
              </Chip>
            </button>
          ))}
        </div>

        <div className={`${ROW} h-6 border-b border-line`}>
          <Label>time</Label>
          <Label>hook</Label>
          <Label>tag</Label>
          <Label>dur</Label>
          <Label>mp4</Label>
          <Label>status</Label>
        </div>

        {shown.map((r) => {
          const s = STATUS[r.status] ?? STATUS.new;
          const m = mp4State(r);
          const isEditing = editing === r.path;
          return (
            <div key={r.path} className="border-b border-line last:border-b-0">
            <div
              className={`${ROW} h-8 hover:bg-white/[0.02]`}
            >
              <span className="font-mono text-[11px] tabular-nums text-ink">{r.time}</span>
              {/* The excerpt used to be a second line, which doubled the row
                  height to carry the least important thing in it. It trails the
                  hook at --ink-dim and truncates with it. */}
              {/* The hook is the only human-written sentence in the row, so it
                  carries the editorial face; the excerpt beside it is machine
                  transcript and stays in the UI face. */}
              <button
                type="button"
                title="Edit the hook and caption"
                onClick={() => {
                  setEditing(isEditing ? null : r.path);
                  setDraft({ hook: r.hook, caption: r.caption });
                }}
                className="min-w-0 truncate text-left text-[12px] hover:underline decoration-amber/50 underline-offset-2"
              >
                {r.hook ? (
                  <span className="font-editorial text-[14px] text-ink">{r.hook}</span>
                ) : (
                  // Nothing here means the export pack falls back to the generic
                  // per-tag hook from tags.py. Today that is 0 of 68 clips; a
                  // freshly selected batch is where it bites.
                  <span className="text-sienna">no hook written — the pack will use a generic one</span>
                )}
                {r.excerpt && <span className="text-ink-dim"> — {r.excerpt}</span>}
              </button>
              <span className={`truncate font-head text-[10px] font-semibold uppercase tracking-[0.14em] ${tagTone(r.tag)}`}>
                {r.tag}
              </span>
              {SELECTOR_LABEL[r.selector] && (
                <span
                  title={SELECTOR_LABEL[r.selector].why}
                  className={`shrink-0 whitespace-nowrap rounded-sm border px-1.5 py-px font-mono text-[9.5px] uppercase tracking-[0.12em] ${
                    r.selector === "hand"
                      ? "border-amber/40 text-amber"
                      : r.selector === "speech"
                        ? "border-sienna/40 text-sienna"
                        : "border-white/12 text-warmgray"
                  }`}
                >
                  {SELECTOR_LABEL[r.selector].short}
                </span>
              )}
              {files[r.path]?.rendered ? (
                <button
                  onClick={() => setWatching(watching === r.path ? null : r.path)}
                  title={
                    files[r.path]?.stale
                      ? "Watch — note the MP4 on disk is the pre-edit render"
                      : "Watch this clip before approving it"
                  }
                  className={`font-mono text-[11px] tabular-nums hover:text-amber ${
                    watching === r.path ? "text-amber" : "text-ink-dim"
                  }`}
                >
                  {watching === r.path ? "■" : "▶"} {r.duration.toFixed(0)}s
                </button>
              ) : (
                <span className="font-mono text-[11px] tabular-nums text-ink-dim">
                  {r.duration.toFixed(0)}s
                </span>
              )}
              {/* Finished-on-disk is state, so it wears mint on a dot and nothing
                  else. Everything that is not finished has to be readable as
                  words — "render", "failed", "stale" — because a dot cannot say
                  why. Clicking renders this clip alone. */}
              <button
                onClick={() => startRender(r.date, r.path)}
                disabled={starting || Boolean(progress?.running)}
                title={m.title}
                className={`flex h-5 w-fit items-center font-head text-[10px] font-semibold uppercase tracking-[0.14em] transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40 ${m.tone}`}
              >
                {m.label ? m.label : <span className="h-1.5 w-1.5 rounded-full bg-mint" />}
              </button>
              <button
                onClick={() => cycle(r)}
                disabled={busy === r.path}
                title="cycle this clip's status"
                className={`flex h-5 w-fit items-center gap-1.5 rounded-none border px-2 font-head text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors disabled:opacity-40 ${s.edge} ${s.text} hover:border-amber/60`}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`} />
                {r.status.replace("_", " ")}
              </button>
            </div>

            {watching === r.path && (
              <div className="border-t border-line bg-raised px-3 py-2.5">
                {/* 6.2: a clip retagged after rendering has an orphaned MP4, and
                    watching the old file while approving the new one is worse
                    than no playback. Say which file this is. */}
                {files[r.path]?.stale && (
                  <p className="mb-2 border-l border-l-sienna/50 px-2 py-1 text-[11px] leading-snug text-sienna">
                    This is the pre-edit render — {basename(files[r.path]!.path)}.mp4. The clip
                    now renders to {basename(files[r.path]!.expected)}.mp4. Re-render before
                    approving.
                  </p>
                )}
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video
                  src={`/api/clip/${r.path.replace(/^clips\//, "")}`}
                  controls
                  autoPlay
                  className="mx-auto max-h-[46vh] w-auto border border-line"
                />
              </div>
            )}

            {/* The copy editor opens under its own row so the table keeps its
                rhythm and the fields get the width a sentence needs. */}
            {isEditing && (
              <div className="border-t border-line bg-raised px-3 py-2.5">
                <label className="block">
                  <span className={MICRO}>hook — the one line a person writes</span>
                  <input
                    value={draft.hook}
                    autoFocus
                    onChange={(e) => setDraft((d) => ({ ...d, hook: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setEditing(null);
                      if (e.key === "Enter") void saveCopy(r.path);
                    }}
                    className="mt-1 w-full border border-line-strong bg-ground px-2 py-1 font-editorial text-[14px] text-ink outline-none focus:border-amber"
                  />
                </label>
                <label className="mt-2 block">
                  <span className={MICRO}>caption — what gets pasted with the post</span>
                  <textarea
                    value={draft.caption}
                    rows={4}
                    onChange={(e) => setDraft((d) => ({ ...d, caption: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setEditing(null);
                    }}
                    className="mt-1 w-full resize-y border border-line-strong bg-ground px-2 py-1 font-mono text-[11.5px] leading-relaxed text-ink outline-none focus:border-amber"
                  />
                </label>
                <div className="mt-2 flex items-center gap-1.5">
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={savingCopy}
                    onClick={() => void saveCopy(r.path)}
                  >
                    {savingCopy ? "Saving…" : "Save copy"}
                  </Button>
                  <Button size="sm" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                  <span className="ml-auto font-mono text-[10px] text-ink-dim">
                    survives a re-render
                  </span>
                </div>
              </div>
            )}
            </div>
          );
        })}
      </div>

      <div className="flex w-[clamp(228px,18vw,320px)] shrink-0 flex-col gap-3 self-start">
        {/* RENDER ---------------------------------------------------------- */}
        <div className="bg-panel">
          <div className="flex h-7 shrink-0 items-center gap-2 border-b border-line px-3">
            <Label>render</Label>
            <div className="flex-1" />
            {stream ? <span className="font-mono text-[10px] tabular-nums text-ink-dim">{stream}</span> : null}
          </div>
          <div className="px-3 py-2.5">
            {!stream ? (
              <p className="text-[11.5px] leading-snug text-ink-dim">
                Pick a stream above. Rendering runs one batch at a time — compose.py reads that
                stream&apos;s candidates and writes into <span className="font-mono">clips/&lt;date&gt;/</span>.
              </p>
            ) : (
              <>
                <div className="border-t border-line">
                  <div className={READOUT}>
                    <span className={MICRO}>clips in batch</span>
                    <span className="font-mono text-[11px] tabular-nums text-ink">{batch.length}</span>
                  </div>
                  <div className={READOUT}>
                    <span className={MICRO}>mp4 on disk</span>
                    <span
                      className={`font-mono text-[11px] tabular-nums ${
                        batchDone === batch.length && batch.length > 0 ? "text-mint" : "text-ink"
                      }`}
                    >
                      {batchDone} / {batch.length}
                    </span>
                  </div>
                  <div className="flex h-6 items-center justify-between">
                    <span className={MICRO}>state</span>
                    <span
                      className={`font-mono text-[11px] tabular-nums ${
                        progress?.running
                          ? "text-amber"
                          : progress?.error || progress?.failed.length
                            ? "text-sienna"
                            : "text-ink-dim"
                      }`}
                    >
                      {progress?.running
                        ? `${progress.done} / ${progress.total}`
                        : progress?.finished
                          ? "finished"
                          : progress?.error
                            ? "stopped"
                            : "idle"}
                    </span>
                  </div>
                </div>

                {/* The one live number on the screen, so it gets the amber. */}
                {progress?.running ? (
                  <p className="mt-2 font-mono text-[11px] tabular-nums leading-snug text-amber">
                    {progress.current
                      ? `${progress.current} — ${progress.done} of ${progress.total} done`
                      : "loading the source and calibration…"}
                  </p>
                ) : null}

                <div className="mt-2.5 flex gap-1.5">
                  <Button
                    variant="primary"
                    className="flex-1"
                    disabled={starting || Boolean(progress?.running) || batch.length === 0}
                    onClick={() => startRender(stream)}
                  >
                    {progress?.running ? "Rendering…" : starting ? "Starting…" : "Render batch"}
                  </Button>
                  <Button
                    variant="toggle"
                    active={force}
                    title="re-encode clips that already have an MP4; off, compose.py skips them"
                    onClick={() => setForce((v) => !v)}
                  >
                    force
                  </Button>
                </div>
                <p className="mt-2 text-[11px] leading-snug text-ink-dim">
                  {force
                    ? "Every clip is re-encoded, about 25-40s each."
                    : "Clips already finished on disk are skipped. Safe to press twice."}
                </p>

                {/* Per-clip failures are text, with the reason compose.py gave. */}
                {progress?.failed.length ? (
                  <div className="mt-2 border-l border-l-sienna/50 bg-raised px-2 py-1.5">
                    <div className="font-head text-[10px] font-semibold uppercase tracking-[0.14em] text-sienna">
                      {progress.failed.length} failed
                    </div>
                    {progress.failed.map((f) => (
                      <p key={f.name} className="mt-1 font-mono text-[10.5px] leading-relaxed text-ink">
                        {f.name} — {f.reason}
                      </p>
                    ))}
                  </div>
                ) : null}

                {progress?.skipped.length ? (
                  <div className="mt-2 border-l border-l-line bg-raised px-2 py-1.5">
                    {progress.skipped.map((f) => (
                      <p key={f.name} className="font-mono text-[10.5px] leading-relaxed text-ink-dim">
                        {f.name} skipped — {f.reason}
                      </p>
                    ))}
                  </div>
                ) : null}

                {progress?.error ? (
                  <p className="mt-2 border-l border-l-sienna/50 bg-raised px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-sienna">
                    {progress.error}
                  </p>
                ) : null}

                {renderMsg ? (
                  <p className="mt-2 border-l border-l-line bg-raised px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-ink">
                    {renderMsg}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>

        {/* QUALITY CHECKS -------------------------------------------------- */}
        <div className="bg-panel">
          <div className="flex h-7 shrink-0 items-center border-b border-line px-3">
            <Label>quality checks</Label>
          </div>
          <div className="px-3 py-2.5">
            {!stream ? (
              <p className="text-[11.5px] leading-snug text-ink-dim">
                Pick a stream above to check its rendered batch.
              </p>
            ) : (
              <>
                {qa?.ran ? (
                  <>
                    <p
                      className={`font-mono text-sm tabular-nums ${
                        qa.failed ? "text-sienna" : "text-mint"
                      }`}
                    >
                      {qa.passed} of {qa.clips} passed
                    </p>
                    <div className="mt-2 border-t border-line">
                      {(qa.checks ?? []).map((c) => (
                        <div key={c.name} className={READOUT}>
                          <span className={MICRO}>{c.name}</span>
                          {c.failed.length ? (
                            <span className="font-mono text-[11px] tabular-nums text-sienna">
                              {c.failed.length} fail
                            </span>
                          ) : c.warned.length ? (
                            <span className="font-mono text-[11px] tabular-nums text-ink-dim">
                              {c.warned.length} warn
                            </span>
                          ) : (
                            <span className="h-1.5 w-1.5 rounded-full bg-mint" />
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Which clip failed which check, in the words qa_report.py
                        used. "3 of 10 passed" is a score; this is the defect. */}
                    {(qa.checks ?? []).some((c) => c.failed.length) ? (
                      <div className="mt-2 border-l border-l-sienna/50 bg-raised px-2 py-1.5">
                        {(qa.checks ?? []).flatMap((c) =>
                          c.failed.map((f) => (
                            <p
                              key={`${c.name}-${f.clip}`}
                              className="font-mono text-[10.5px] leading-relaxed text-ink"
                            >
                              {f.clip} — {f.reason}
                            </p>
                          ))
                        )}
                      </div>
                    ) : null}

                    {(qa.checks ?? []).some((c) => c.warned.length) ? (
                      <div className="mt-2 border-l border-l-line bg-raised px-2 py-1.5">
                        {(qa.checks ?? []).flatMap((c) =>
                          c.warned.map((w) => (
                            <p
                              key={`${c.name}-${w.clip}`}
                              className="font-mono text-[10.5px] leading-relaxed text-ink-dim"
                            >
                              {w.clip} — {w.reason}
                            </p>
                          ))
                        )}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="text-[11.5px] leading-snug text-ink-dim">
                    No QA report for this batch yet. The checks are mechanical — container,
                    duration, dead pane, camera bleed, loudness — and take about a second a clip.
                  </p>
                )}

                <Button
                  className="mt-2.5 w-full"
                  disabled={qaBusy || Boolean(progress?.running)}
                  onClick={() => runQa(stream)}
                >
                  {qaBusy ? "Checking…" : qa?.ran ? "Re-run QA" : "Run QA"}
                </Button>
                {qaMsg ? (
                  <p className="mt-2 border-l border-l-sienna/50 bg-raised px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-sienna">
                    {qaMsg}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>

        {/* EXPORT PACK ----------------------------------------------------- */}
        <div className="bg-panel">
          <div className="flex h-7 shrink-0 items-center border-b border-line px-3">
            <Label>export pack</Label>
          </div>
          <div className="px-3 py-2.5">
            <p className="text-[11.5px] leading-snug text-ink-dim">
              Everything an approved clip needs to be posted by a person. Nothing leaves this
              machine on its own.
            </p>

            {/* Label left, value right, on 24px rules: the contents of the pack
                read as a manifest instead of as four sentences. */}
            <div className="mt-2.5 border-t border-line">
              <div className={READOUT}>
                <span className={MICRO}>approved clips</span>
                <span className="font-mono text-[11px] tabular-nums text-ink">{approved.length}</span>
              </div>
              <div className={READOUT}>
                <span className={MICRO}>mp4 rendered</span>
                <span
                  className={`font-mono text-[11px] tabular-nums ${
                    packReady && approved.length > 0 ? "text-mint" : "text-sienna"
                  }`}
                >
                  {approved.length - unrendered.length} / {approved.length}
                </span>
              </div>
              <div className={READOUT}>
                <span className={MICRO}>frame</span>
                <span className="font-mono text-[11px] tabular-nums text-ink">1080×1920</span>
              </div>
              <div className={READOUT}>
                <span className={MICRO}>caption text</span>
                <span className="font-mono text-[11px] text-ink">per clip</span>
              </div>
              <div className={READOUT}>
                <span className={MICRO}>hook · hashtags · cta</span>
                <span className="font-mono text-[11px] text-ink">per clip</span>
              </div>
              <div className="flex h-6 items-center justify-between">
                <span className={MICRO}>posting order</span>
                <span className="font-mono text-[11px] text-ink">for the week</span>
              </div>
            </div>

            {/* The gate. build_export_pack.py copies what is on disk and skips
                what is not, so a pack built now would be short by this many
                clips — and would say so only on a stderr line nobody reads. */}
            {unrendered.length > 0 && approved.length > 0 ? (
              <div className="mt-2.5 border-l border-l-sienna/50 bg-raised px-2 py-1.5">
                <div className="font-head text-[10px] font-semibold uppercase tracking-[0.14em] text-sienna">
                  {unrendered.length} approved · no mp4
                </div>
                <p className="mt-1 text-[11px] leading-snug text-ink-dim">
                  The pack would skip them. Render first:
                </p>
                {missingByDate.map((d) => (
                  <div key={d} className="mt-1 flex h-6 items-center justify-between">
                    <span className="font-mono text-[10.5px] tabular-nums text-ink">
                      {d} · {unrendered.filter((r) => r.date === d).length}
                    </span>
                    <Button
                      size="sm"
                      disabled={starting || Boolean(progress?.running)}
                      onClick={() => startRender(d)}
                    >
                      render
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}

            {staleApproved.length > 0 ? (
              <p className="mt-2 border-l border-l-sienna/50 bg-raised px-2 py-1.5 text-[11px] leading-snug text-ink-dim">
                {staleApproved.length} approved clip(s) were retagged after they were rendered, so
                the pack would carry the pre-edit MP4. Re-render them from the mp4 column.
              </p>
            ) : null}

            <Button
              variant="primary"
              className="mt-2.5 w-full"
              disabled={approved.length === 0 || packing || (!packReady && !packAnyway)}
              onClick={async () => {
                setPacking(true);
                setPackMsg(null);
                const res = await fetch("/api/yp/export", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  // `packAnyway` is the "build anyway — skips N" escape hatch.
                  // It used to set state and then post an empty body, so the
                  // button offered a way through and did not take it.
                  body: JSON.stringify({ includePending: packAnyway }),
                });
                const body = (await res.json()) as {
                  ok?: boolean; message?: string; error?: string; packs?: Pack[];
                };
                setPackMsg(body.ok ? body.message ?? "pack built" : body.error ?? "failed");
                if (body.packs) setPacks(body.packs);
                setPacking(false);
              }}
            >
              {packing ? "Building…" : "Build export pack"}
            </Button>
            {!packReady && approved.length > 0 && !packAnyway ? (
              <Button size="sm" className="mt-1.5 w-full" onClick={() => setPackAnyway(true)}>
                build anyway — skips {unrendered.length}
              </Button>
            ) : null}
            <p className="mt-2 text-[11px] leading-snug text-ink-dim">
              {approved.length === 0
                ? "Approve at least one clip first — the pack only carries approved work."
                : packReady
                  ? "The pack lands on disk. Publishing stays manual."
                  : "An approved clip with no MP4 cannot be posted, so it is not a pack."}
            </p>
            {packMsg && (
              <p className="mt-2 border-l border-l-line bg-raised px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-ink">
                {packMsg}
              </p>
            )}

            {/* The last mile. A pack that only exists on this disk has not been
                handed over — the brief is that it reaches his computer. */}
            {packs.length > 0 && (
              <div className="mt-3 border-t border-line pt-2.5">
                <div className={MICRO}>built packs</div>
                {packs.map((pk) => (
                  <div key={pk.id} className="mt-1.5 border-l border-l-line bg-raised px-2 py-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-[11px] text-ink">{pk.id}</span>
                      <span className="font-mono text-[10.5px] tabular-nums text-ink-dim">
                        {pk.clips} clip{pk.clips === 1 ? "" : "s"} ·{" "}
                        {pk.bytes >= 1e9
                          ? `${(pk.bytes / 1e9).toFixed(2)} GB`
                          : `${Math.max(1, Math.round(pk.bytes / 1e6))} MB`}
                      </span>
                    </div>
                    <div className="mt-1.5 flex gap-1.5">
                      {/* A plain link, not fetch(): the browser owns the save
                          dialog and the progress, and a multi-GB zip should
                          never be buffered into memory to be re-emitted. */}
                      <a
                        href={`/api/yp/export/download?pack=${encodeURIComponent(pk.id)}`}
                        className="flex-1 border border-amber bg-amber px-2 py-1 text-center font-head text-[10px] font-semibold uppercase tracking-[0.08em] text-ground hover:border-gold hover:bg-gold"
                      >
                        Download .zip
                      </a>
                      <Button
                        size="sm"
                        onClick={async () => {
                          const r = await fetch("/api/yp/export", {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({ action: "reveal", pack: pk.id }),
                          });
                          const b = (await r.json()) as { ok?: boolean; error?: string };
                          if (!b.ok) setPackMsg(b.error ?? "could not reveal");
                        }}
                      >
                        Reveal
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
