"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Chip, Label, Panel, ScreenTitle, SegmentedControl, fmtTime } from "../yp-chrome";
import { VerticalPreview } from "./vertical-preview";
import { RectEditor, type Rect } from "../framing/rect-editor";

type Clip = {
  path: string;
  date?: string;
  start: number;
  end: number;
  duration: number;
  context_tag: string;
  score?: number;
  mode?: string;
  excerpt?: string;
  status?: string;
  framing_origin?: string;
  reason?: string;
  sung_fraction?: number;
  bpm?: number;
  selector?: string;
  copy?: { hook?: string; hook_alt?: string; caption?: string };
  creator?: Record<string, unknown>;
  history?: unknown[];
  cam?: number[] | null;
  daw?: number[] | null;
};

type Segment = {
  start: number;
  end: number;
  text: string;
  edited?: boolean;
  words?: { word: string; start: number; end: number }[];
};

type Summary = {
  count: number;
  avgScore: number;
  split: number;
  reframe: number;
  locked: number;
  qa: { clips: number; passed: number; failed: number } | null;
  settings: {
    mirror?: boolean;
    asked: number | null;
    selected: number;
    limitedBy: string | null;
    spacing: number | null;
  };
};

type Payload = {
  clips: Clip[];
  music: { score: number[]; sung: number[]; duration: number | null };
  transcript: { segments: Segment[] };
  summary?: Summary;
  waveform?: { duration?: number; peaks?: number[] };
  calibration?: {
    frame: { width: number; height: number };
    // Tuples, matching `Rect` and the per-clip `cam`/`daw` the library stores.
    cam: Rect;
    // Null on a camera-only stream: there is no DAW pane to draw, because the
    // camera is the whole frame. See calibrate.py's fullcam mode.
    daw: Rect | null;
    mode?: "split" | "fullcam";
    reason?: string;
  } | null;
};

const NUDGE = 0.5;
// How far either side of a clip a scene lock reaches. Matches the framing
// screen, so the same button means the same thing on both surfaces.
const LOCK_SPAN = 600;
// tags.py SPEECH_TAGS — what analyze.py can emit. Kept in the same order so the
// two lists can be compared by eye when either changes.
const SPEECH_TAGS = [
  "production", "vocal", "collab", "culture", "advice", "freestyle", "roast",
  "reaction", "story", "banter", "laugh", "energy", "fasttalk", "moment",
] as const;
const LANE_BARS = 420;

/**
 * Lane geometry, in pixels. The gutter and the tracks both read these numbers,
 * so a label can never drift off the lane it names, and the whole stack stays
 * on one grid however the lanes are reordered. Heights are DAW-tight on
 * purpose — rule 5: a 2h47m stream should fill the strip, not float in it.
 */
const LANE = { ruler: 18, audio: 40, music: 34, transcript: 12, clips: 26 } as const;

/** Gutter labels, top to bottom. Uppercased in CSS so the strings stay legible here. */
const LANE_NAMES: readonly (readonly [keyof typeof LANE, string])[] = [
  ["ruler", "stream time"],
  ["audio", "audio"],
  ["music", "music map"],
  ["transcript", "transcript"],
  ["clips", "clips"],
];

/**
 * Ruler steps in seconds — the intervals a person actually counts in. The axis
 * picks the smallest one that keeps the window under about eight labels, so the
 * timecodes stay round from a 30-second window to a three-hour one.
 */
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

/**
 * The transport's own control style. Deliberately NOT yp-chrome's Button: the
 * chrome button is Archivo caps at 28px, which is right for a header and wrong
 * for a strip of forty transport keys. These are mono, 22px, and hairline —
 * the console convention, where a transport reads as a keyboard and the header
 * reads as chrome. Written once so a wrapped row cannot drift out of step.
 */
const CTL =
  "inline-flex shrink-0 items-center justify-center border font-mono uppercase tracking-[0.06em] tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-30";
const CTL_SIZE = "h-[22px] px-2 text-[10px]";
const CTL_GHOST = "border-line-strong text-ink hover:border-amber/60 hover:text-amber";
const CTL_ON = "border-amber bg-amber/15 text-amber";
const CTL_PRIMARY = "border-amber bg-amber text-ground hover:border-gold hover:bg-gold";
const KEY = `${CTL} ${CTL_SIZE} ${CTL_GHOST}`;

export function TimelineClient({
  streams,
  labels = {},
  clipped = [],
}: {
  streams: string[];
  labels?: Record<string, string>;
  clipped?: string[];
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState(streams[0] ?? "");
  const [data, setData] = useState<Payload | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [markIn, setMarkIn] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ url: string; kind: "still" | "draft" } | null>(null);
  const [safe, setSafe] = useState(true);
  // Zoom is a visible WINDOW over the stream, not a scale factor: at full width a
  // three-hour stream gives ~26 seconds per bar, which is far too coarse to place
  // a cut. `span` is how many seconds the lanes show.
  const [span, setSpan] = useState<number | null>(null);
  const [loop, setLoop] = useState(false);
  const [edgeDrag, setEdgeDrag] = useState<"start" | "end" | null>(null);
  // Editing 9:16 against a 16:9 source means imagining the crop, which is where
  // framing mistakes come from. "both" is the default: the source to find the
  // moment, the vertical to judge what the viewer actually sees.
  const [viewMode, setViewMode] = useState<"source" | "vertical" | "both">("both");
  const [captions, setCaptions] = useState(true);
  // Framing without leaving the timeline: drag the rects on the source while the
  // 9:16 beside it updates live. Local until saved, so a drag is not an edit.
  const [framingMode, setFramingMode] = useState(false);
  const [draftRects, setDraftRects] = useState<{ cam: Rect | null; daw: Rect | null } | null>(null);
  const [prep, setPrep] = useState<{ running?: boolean; done?: boolean; step?: string | null; error?: string | null }>({});
  const stage = useRef<HTMLDivElement>(null);
  const [stageBox, setStageBox] = useState({ w: 0, h: 0 });
  const [localEdge, setLocalEdge] = useState<{ field: "start" | "end"; at: number } | null>(null);
  // Finding clips lived only on the Streams screen, while HOW-TO-GUIDE.md tells
  // the operator to do it here — "Hit Find clips and it picks the strongest
  // music moments". A prepared stream with no clips therefore looked broken, and
  // the empty state offered only the hand-cut route.
  const [finding, setFinding] = useState(false);
  const [findNote, setFindNote] = useState<string | null>(null);

  const load = useCallback(async (date: string) => {
    if (!date) return;
    const res = await fetch(`/api/yp?view=timeline&stream=${date}`, { cache: "no-store" });
    const json = (await res.json()) as Payload;
    setData(json);
    setSelected((prev) => (json.clips.some((c) => c.path === prev) ? prev : json.clips[0]?.path ?? null));
  }, []);

  useEffect(() => {
    void load(stream);
    setPlayhead(0);
    setMarkIn(null);
    setPreview(null);
  }, [stream, load]);

  useEffect(() => {
    setDraftRects(null);
  }, [selected]);

  const checkPrep = useCallback(async (date: string) => {
    const res = await fetch(`/api/yp/prepare?stream=${date}`, { cache: "no-store" });
    const st = (await res.json()) as typeof prep;
    setPrep(st);
    return st;
  }, []);

  useEffect(() => {
    if (!prep.running) return;
    const id = setInterval(async () => {
      const st = await checkPrep(stream);
      if (!st.running) {
        clearInterval(id);
        if (st.done) void load(stream);
      }
    }, 4000);
    return () => clearInterval(id);
  }, [prep.running, stream, checkPrep, load]);

  useEffect(() => {
    void checkPrep(stream);
  }, [stream, checkPrep]);

  // Both panes are aspect-locked, so their combined width is decided by the
  // height they are given. Left to CSS they simply overflowed the panel and got
  // clipped at 1280. Measuring lets us fit them exactly — and the 16:9 box has to
  // match the video's rendered pixels anyway, or the drag rectangles sit wrong.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setStageBox({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const panes = useMemo(() => {
    const GAP = 12;
    const { w, h } = stageBox;
    if (w < 2 || h < 2) return { source: { w: 0, h: 0 }, vertical: { w: 0, h: 0 } };
    const showSource = viewMode !== "vertical";
    const showVertical = viewMode !== "source";
    // Solve for the shared height that makes the row fit the box.
    const ratioSum = (showSource ? 16 / 9 : 0) + (showVertical ? 9 / 16 : 0);
    const gaps = showSource && showVertical ? GAP : 0;
    const height = Math.min(h, (w - gaps) / ratioSum);
    return {
      source: { w: showSource ? height * (16 / 9) : 0, h: showSource ? height : 0 },
      vertical: { w: showVertical ? height * (9 / 16) : 0, h: showVertical ? height : 0 },
    };
  }, [stageBox, viewMode]);

  const clip = useMemo(() => data?.clips.find((c) => c.path === selected) ?? null, [data, selected]);
  // A clip that has never been framed falls back to the stream's calibration —
  // where the webcam and arrangement were actually measured to be. It is a
  // starting point to drag, not a stored decision, so `framingFallback` marks it.
  const rects = useMemo(
    () => ({
      cam: (draftRects?.cam ??
        (clip?.cam as Rect | undefined) ??
        data?.calibration?.cam ??
        null) as Rect | null,
      daw: (draftRects?.daw ??
        (clip?.daw as Rect | undefined) ??
        data?.calibration?.daw ??
        null) as Rect | null,
    }),
    [draftRects, clip, data]
  );
  const framingFallback = !!(rects.cam && !draftRects && !clip?.cam);
  const framingDirty =
    !!draftRects &&
    JSON.stringify([draftRects.cam, draftRects.daw]) !== JSON.stringify([clip?.cam, clip?.daw]);
  const [videoDuration, setVideoDuration] = useState(0);
  // An unprepared stream has no music map and no waveform, but the file itself
  // always knows how long it is — without this the lanes collapse to zero width
  // and the stream cannot be scrubbed at all.
  const duration = data?.music.duration ?? data?.waveform?.duration ?? videoDuration;
  const prepared = !!(data?.music.duration || data?.waveform?.duration);

  // The window the lanes render, centred on the playhead when zoomed in.
  const view = useMemo(() => {
    if (!duration) return { from: 0, to: 1 };
    if (!span || span >= duration) return { from: 0, to: duration };
    const from = Math.max(0, Math.min(playhead - span / 2, duration - span));
    return { from, to: from + span };
  }, [duration, span, playhead]);

  const viewSpan = view.to - view.from;
  const pct = (t: number) =>
    viewSpan ? Math.min(100, Math.max(0, ((t - view.from) / viewSpan) * 100)) : 0;
  const timeAt = (fraction: number) => view.from + fraction * viewSpan;

  /** One place that moves both the video and the playhead. */
  const seek = useCallback((t: number) => {
    const el = video.current;
    const at = Math.max(0, Math.min(t, duration || t));
    if (el) el.currentTime = at;
    setPlayhead(at);
  }, [duration]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/yp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const why = ((await res.json()) as { error?: string }).error ?? "failed";
        setError(why.replace(/^Error:\s*/, ""));
      }
      await load(stream);
    } finally {
      setBusy(false);
    }
  }

  async function findClips() {
    if (!stream || finding) return;
    setFinding(true);
    setFindNote(null);
    setError(null);
    try {
      const res = await fetch("/api/yp/select", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stream, count: 10 }),
      });
      const data = (await res.json()) as {
        ok?: boolean; error?: string; selected?: number; note?: string | null;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? `the select route answered ${res.status}`);
      } else {
        // The shortfall note is the point of 5.4 — "asked for 10, selected 8,
        // limited by minimum spacing" — so it is shown, not swallowed.
        setFindNote(data.note ?? `found ${data.selected} clip(s)`);
        await load(stream);
      }
    } catch (err) {
      setError(`could not reach the select route: ${(err as Error).message}`);
    } finally {
      setFinding(false);
    }
  }

  const setEdge = (field: "start" | "end", value: number) =>
    clip && act({ action: "set-field", clip: clip.path, field, value: Math.round(value * 10) / 10 });

  async function render(kind: "still" | "draft") {
    if (!clip) return;
    setBusy(true);
    setError(null);
    const q = new URLSearchParams({
      clip: clip.path,
      kind,
      safe: safe ? "1" : "0",
      at: String(Math.max(clip.start, Math.min(playhead || clip.start + 3, clip.end - 0.1))),
    });
    const res = await fetch(`/api/yp/preview?${q}`, { cache: "no-store" });
    if (res.ok) {
      const blob = await res.blob();
      setPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { url: URL.createObjectURL(blob), kind };
      });
    } else {
      setError(((await res.json()) as { error?: string }).error ?? "preview failed");
    }
    setBusy(false);
  }

  // The transcript follows the playhead, not the clip — that is what makes it
  // useful for finding a moment rather than just reviewing one.
  const nearby = useMemo(() => {
    const segs = data?.transcript.segments ?? [];
    if (!segs.length) return [];
    const i = Math.max(0, segs.findIndex((s) => s.end >= playhead));
    return segs.slice(Math.max(0, i - 3), i + 12);
  }, [data, playhead]);

  const currentIdx = useMemo(
    () => nearby.findIndex((s) => s.start <= playhead && s.end >= playhead),
    [nearby, playhead]
  );

  const slice = useCallback(
    (values: number[]) => {
      if (!values.length || !duration) return [];
      const a = Math.floor((view.from / duration) * values.length);
      const b = Math.ceil((view.to / duration) * values.length);
      return downsample(values.slice(a, Math.max(b, a + 1)), LANE_BARS);
    },
    [view.from, view.to, duration]
  );

  const wave = useMemo(() => slice(data?.waveform?.peaks ?? []), [data, slice]);
  const bars = useMemo(() => slice(data?.music.score ?? []), [data, slice]);
  const vocal = useMemo(() => slice(data?.music.sung ?? []), [data, slice]);

  // The transcript as a lane: which buckets of the visible window carry speech.
  // Bucketed onto the same 420-bar grid as the audio and the music map rather
  // than one block per segment — a three-hour stream holds thousands of them,
  // and every lane has to land on the same axis anyway.
  const speech = useMemo(() => {
    const cover = new Array<boolean>(LANE_BARS).fill(false);
    const segs = data?.transcript.segments ?? [];
    if (!segs.length || !viewSpan) return cover;
    for (const seg of segs) {
      if (seg.end < view.from || seg.start > view.to) continue;
      const a = Math.max(0, Math.floor(((seg.start - view.from) / viewSpan) * LANE_BARS));
      const b = Math.min(LANE_BARS - 1, Math.ceil(((seg.end - view.from) / viewSpan) * LANE_BARS));
      for (let i = a; i <= b; i++) cover[i] = true;
    }
    return cover;
  }, [data, view.from, view.to, viewSpan]);

  // Ruler marks. Half-steps go in unlabelled, which is what lets the eye read a
  // distance between two timecodes instead of counting pixels.
  const ticks = useMemo(() => {
    if (!viewSpan || !duration) return [] as { t: number; major: boolean }[];
    const step = TICK_STEPS.find((s2) => s2 >= viewSpan / 8) ?? TICK_STEPS[TICK_STEPS.length - 1];
    const half = step / 2;
    const out: { t: number; major: boolean }[] = [];
    for (let t = Math.ceil(view.from / half) * half; t <= view.to; t += half) {
      out.push({ t, major: Math.abs(t / step - Math.round(t / step)) < 1e-6 });
    }
    return out;
  }, [view.from, view.to, viewSpan, duration]);

  function laneClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!duration) return;
    const box = e.currentTarget.getBoundingClientRect();
    seek(timeAt((e.clientX - box.left) / box.width));
  }

  // Loop the clip so a cut can be judged rather than guessed at.
  useEffect(() => {
    const el = video.current;
    if (!el || !loop || !clip) return;
    const tick = () => {
      if (el.currentTime >= clip.end || el.currentTime < clip.start - 0.5) {
        el.currentTime = clip.start;
      }
    };
    el.addEventListener("timeupdate", tick);
    return () => el.removeEventListener("timeupdate", tick);
  }, [loop, clip]);

  // Dragging a clip edge on the lane.
  useEffect(() => {
    if (!edgeDrag || !clip) return;
    const lane = document.getElementById("yp-lanes");
    // A click must not become an edit. Without a dead zone, selecting a clip that
    // is a few pixels wide commits whatever pixel the pointer happened to be on —
    // which is how a 30s clip silently became 9.6s.
    let travelled = false;
    let originX: number | null = null;
    function move(e: PointerEvent) {
      if (!lane) return;
      if (originX === null) originX = e.clientX;
      if (!travelled && Math.abs(e.clientX - originX) < 4) return;
      travelled = true;
      const box = lane.getBoundingClientRect();
      const t = timeAt(Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)));
      setLocalEdge({ field: edgeDrag!, at: Math.round(t * 10) / 10 });
    }
    function up() {
      setLocalEdge((cur) => {
        if (cur) void setEdge(cur.field, cur.at);
        return null;
      });
      setEdgeDrag(null);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [edgeDrag, clip, view.from, view.to]);

  // Keyboard: an editor without them is a form.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
      const v = video.current;
      switch (e.key) {
        case " ":
          e.preventDefault();
          if (v) (v.paused ? v.play() : v.pause());
          break;
        case "ArrowLeft":
          e.preventDefault();
          seek(playhead - (e.shiftKey ? 10 : 1));
          break;
        case "ArrowRight":
          e.preventDefault();
          seek(playhead + (e.shiftKey ? 10 : 1));
          break;
        case "j":
          seek(playhead - 10);
          break;
        case "l":
          seek(playhead + 10);
          break;
        case "k":
          if (v) (v.paused ? v.play() : v.pause());
          break;
        case "i":
          if (clip) void setEdge("start", playhead);
          break;
        case "o":
          if (clip) void setEdge("end", playhead);
          break;
        case ",":
          e.preventDefault();
          seek(playhead - 1 / 30);
          break;
        case ".":
          e.preventDefault();
          seek(playhead + 1 / 30);
          break;
        case "[":
          setSpan((s2) => Math.max(30, (s2 ?? duration) / 2));
          break;
        case "]":
          setSpan((s2) => (s2 && s2 * 2 < duration ? s2 * 2 : null));
          break;
        default:
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playhead, clip, duration, seek]);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* Chrome, not transport: this row uses yp-chrome's controls so the screen
          sits in the same system as every other one. The dense mono keys start
          below, on the transport. */}
      <header className="flex h-11 shrink-0 items-center gap-2 overflow-x-auto border-b border-line bg-panel px-3 xl:px-4">
        <ScreenTitle>Timeline</ScreenTitle>
        <select
          value={stream}
          onChange={(e) => setStream(e.target.value)}
          className="h-7 shrink-0 rounded-md border border-line-strong bg-ground px-2 font-mono text-[11px] tabular-nums text-ink"
        >
          {streams.map((s) => (
            <option key={s} value={s}>
              {s}
              {labels[s] ? ` · ${labels[s].slice(0, 34)}` : ""}
              {clipped.includes(s) ? "" : " · not clipped yet"}
            </option>
          ))}
        </select>
        {duration > 0 && <Chip>{fmtTime(duration)}</Chip>}
        <Chip>{data?.clips.length ?? 0} clips</Chip>
        <SegmentedControl
          label="Preview panes"
          value={viewMode}
          onChange={setViewMode}
          options={[
            { value: "source", label: "16:9" },
            { value: "both", label: "both" },
            { value: "vertical", label: "9:16" },
          ]}
        />
        <Button variant="toggle" active={framingMode} onClick={() => setFramingMode((v) => !v)}>
          framing
        </Button>
        {/* A webcam is mirrored for a whole session far more often than for one
            clip, so this is the stream default. The camera pane flips; the DAW
            pane never does, because mirrored Ableton is unreadable. */}
        <Button
          variant="toggle"
          active={Boolean(data?.summary?.settings?.mirror)}
          disabled={!stream || busy}
          title="Flip the camera horizontally for every clip in this stream. Burned captions, the hook and the mark are unaffected."
          onClick={async () => {
            await act({
              action: "set-stream-field",
              stream,
              field: "mirror",
              value: !data?.summary?.settings?.mirror,
            });
          }}
        >
          mirror
        </Button>
        {/* 5.3: say why there is one pane. Without this the framing controls
            look broken on a camera-only stream rather than correct. */}
        {data?.calibration?.mode === "fullcam" && (
          // shrink-0 + whitespace-nowrap: the transport is a wrap-friendly flex
          // row, and an unconstrained three-word label broke across it as
          // "PANE / NO DAW / ON" between the other controls.
          <span
            title={
              data.calibration.reason ??
              "No webcam inset in this stream, so clips render single-pane."
            }
            className="shrink-0 whitespace-nowrap border border-sienna/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-sienna"
          >
            single-pane
          </span>
        )}
        {framingDirty && clip && (
          <>
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                await act({
                  action: "set-field",
                  clip: clip.path,
                  field: "framing",
                  value: { cam: rects.cam, daw: rects.daw },
                });
                setDraftRects(null);
              }}
            >
              save framing
            </Button>
            {/* Saving framing fixes one clip. The defect that cost a batch on
                2026-08-17 was the same bad crop across a whole scene, so the
                control that actually answers it is pinning one framing over a
                range — verified on the Kiki Rowe stream, where a whole-stream
                pin held on 9 of 10 clips and flagged the drift on each. */}
            <Button
              disabled={busy}
              title={`Apply this framing to every clip within ${LOCK_SPAN / 60} minutes either side, so a re-render cannot move it`}
              onClick={async () => {
                await act({
                  action: "add-lock",
                  lock: {
                    date: clip.date,
                    start: Math.max(0, clip.start - LOCK_SPAN),
                    end: clip.end + LOCK_SPAN,
                    cam: rects.cam,
                    daw: rects.daw,
                    note: `locked from ${fmtTime(clip.start)}`,
                  },
                });
                setDraftRects(null);
              }}
            >
              lock scene
            </Button>
            <Button onClick={() => setDraftRects(null)}>reset</Button>
          </>
        )}
        <Button variant="toggle" active={captions} onClick={() => setCaptions((v) => !v)}>
          captions
        </Button>
        <div className="flex-1" />
        {error && (
          <button
            onClick={() => setError(null)}
            title="dismiss"
            className="max-w-[520px] shrink-0 truncate border border-sienna/60 bg-sienna/15 px-2.5 py-1 text-left font-mono text-[11px] text-sienna"
          >
            {error}
          </button>
        )}
        {clip && (clip.history?.length ?? 0) > 0 && (
          <Button disabled={busy} onClick={() => act({ action: "undo", clip: clip.path })}>
            Undo
          </Button>
        )}
      </header>

      <div className="flex min-h-0 flex-1 gap-3 p-3">
        {/* what the pipeline decided about this stream */}
        <div className="flex w-[clamp(180px,14vw,260px)] shrink-0 flex-col gap-3 overflow-auto">
          <Panel className="p-3">
            <Label>selection</Label>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-display text-3xl leading-none text-cream">{data?.summary?.count ?? 0}</span>
              <span className="text-[11px] text-warmgray">clips</span>
            </div>
            <div className="mt-1 text-[11px] text-warmgray">
              avg music strength {data?.summary?.avgScore ?? 0}
            </div>
            {data?.summary?.settings.limitedBy && (
              <p className="mt-2 text-[11px] leading-relaxed text-sienna">
                asked {data.summary.settings.asked}, got {data.summary.settings.selected} —
                limited by {data.summary.settings.limitedBy}
              </p>
            )}
            {data?.summary?.settings.spacing && (
              <div className="mt-2 flex flex-wrap gap-1">
                <Chip>gap {Math.round(Number(data.summary.settings.spacing))}s</Chip>
              </div>
            )}
          </Panel>

          <Panel className="p-3">
            <Label>layout</Label>
            <p className="mt-1 text-[11.5px] leading-relaxed text-warmgray">
              {data?.summary?.split ?? 0} two-pane · {data?.summary?.reframe ?? 0} single
            </p>
            {(data?.summary?.locked ?? 0) > 0 && (
              <p className="mt-1 text-[11px] text-amber">
                {data!.summary!.locked} framing set by hand
              </p>
            )}
            <a
              href="/dashboard/framing"
              className="mt-2 block rounded border border-white/15 px-2 py-1.5 text-center font-head text-[11px] font-semibold text-cream hover:border-amber/50"
            >
              Open framing
            </a>
          </Panel>

          <Panel className="p-3">
            <Label>quality checks</Label>
            {data?.summary?.qa ? (
              <>
                <p
                  className={`mt-1 font-mono text-sm ${
                    data.summary.qa.failed ? "text-sienna" : "text-amber"
                  }`}
                >
                  {data.summary.qa.passed} of {data.summary.qa.clips} passed
                </p>
                <p className="mt-1 text-[10.5px] leading-relaxed text-warmgray">
                  dimensions · sync · dead pane · camera bleed · loudness
                </p>
              </>
            ) : (
              <p className="mt-1 text-[11px] leading-relaxed text-warmgray">
                No QA report for this batch yet.
              </p>
            )}
          </Panel>

          <Panel className="p-3">
            <Label>captions</Label>
            <p className="mt-1 text-[11.5px] leading-relaxed text-warmgray">
              {data?.transcript.segments.length ?? 0} lines
            </p>
            <a
              href="/dashboard/captions"
              className="mt-2 block rounded border border-white/15 px-2 py-1.5 text-center font-head text-[11px] font-semibold text-cream hover:border-amber/50"
            >
              Edit transcript
            </a>
          </Panel>
        </div>

        {/* the stream itself */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Panel className="flex min-h-[220px] flex-1 flex-col overflow-hidden">
            <div
              ref={stage}
              className="relative flex min-h-0 flex-1 items-center justify-center gap-3 overflow-hidden bg-black p-2"
            >
              <div
                className={
                  viewMode === "vertical" ? "pointer-events-none absolute opacity-0" : "relative"
                }
                style={
                  viewMode === "vertical"
                    ? undefined
                    : { width: panes.source.w, height: panes.source.h }
                }
              >
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video
                  ref={video}
                  src={`/api/yp/video?stream=${stream}`}
                  preload="metadata"
                  playsInline
                  className="h-full w-full object-fill"
                  onLoadedMetadata={(e) => {
                    setVideoDuration(e.currentTarget.duration || 0);
                    // Clear a stale playback error. onError sets a sticky message,
                    // so once a stream had failed the banner stayed up even after
                    // the proxy was built and the video was playing underneath it.
                    setError((prev) =>
                      prev && prev.startsWith("this stream will not play") ? null : prev
                    );
                  }}
                  onTimeUpdate={(e) => setPlayhead(e.currentTarget.currentTime)}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onError={() =>
                    setError(
                      "This stream has no browser-playable copy yet — captures " +
                        "arrive as MPEG-TS, which no browser plays. Re-run Prepare " +
                        "stream to build one (it is the last step), or from a " +
                        "terminal: make_proxy.py --stream " + stream
                    )
                  }
                />
                {framingMode && rects.cam && (
                  <div className="absolute inset-0">
                    <RectEditor
                      frame={{ width: 1280, height: 720 }}
                      cam={rects.cam}
                      daw={rects.daw}
                      background={null}
                      onChange={(which, r) =>
                        setDraftRects((cur) => ({
                          cam: which === "cam" ? r : cur?.cam ?? rects.cam,
                          daw: which === "daw" ? r : cur?.daw ?? rects.daw,
                        }))
                      }
                    />
                  </div>
                )}
              </div>
                            {viewMode !== "source" && (
                <div
                  className="relative shrink-0"
                  style={{ width: panes.vertical.w, height: panes.vertical.h }}
                >
                  <VerticalPreview
                    video={video}
                    cam={rects.cam}
                    daw={rects.daw}
                    segments={data?.transcript.segments ?? []}
                    showSafe={safe}
                    showCaptions={captions}
                    className="h-full w-full border border-line-strong"
                  />
                  <span className="pointer-events-none absolute right-1.5 top-1.5 bg-ground/70 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] tabular-nums text-ink-dim">
                    9:16
                  </span>
                </div>
              )}
              {viewMode !== "source" && !clip?.cam && (
                <span
                  className={`absolute bottom-3 left-3 px-2 py-1 font-mono text-[10px] ${
                    framingFallback ? "bg-amber/85 text-ground" : "bg-sienna/85 text-ink"
                  }`}
                >
                  {framingFallback
                    ? "framing from this stream's calibration — drag to adjust, then save"
                    : "no framing for this clip and none measured for this stream"}
                </span>
              )}
              {clip && playhead >= clip.start && playhead <= clip.end && (
                <span className="absolute left-3 top-3 bg-amber px-2 py-0.5 font-mono text-[10px] tabular-nums text-ground">
                  inside clip {fmtTime(clip.start)}
                </span>
              )}
            </div>

            {/* Transport. One hairline strip of mono keys, and the one number the
                whole screen is about: the playhead, in amber, at three times the
                size of the labels around it. */}
            <div className="flex shrink-0 flex-wrap items-center gap-x-1.5 gap-y-1.5 border-t border-line px-3 py-1.5">
              <button
                onClick={() => (playing ? video.current?.pause() : video.current?.play())}
                className="flex h-[22px] w-[22px] shrink-0 items-center justify-center bg-amber text-[10px] text-ground"
                aria-label={playing ? "Pause" : "Play"}
              >
                {playing ? "❙❙" : "▶"}
              </button>
              <button onClick={() => seek(playhead - 1 / 30)} title="one frame back (,)" className={KEY}>
                ◄|
              </button>
              <button onClick={() => seek(playhead + 1 / 30)} title="one frame forward (.)" className={KEY}>
                |►
              </button>
              {[-30, -5, -1, 1, 5, 30].map((d) => (
                <button key={d} onClick={() => seek(playhead + d)} className={KEY}>
                  {d > 0 ? `+${d}` : d}s
                </button>
              ))}
              <select
                onChange={(e) => {
                  if (video.current) video.current.playbackRate = Number(e.target.value);
                }}
                defaultValue="1"
                title="playback rate"
                className="h-[22px] shrink-0 border border-line-strong bg-ground px-1 font-mono text-[10px] tabular-nums text-ink"
              >
                {[0.5, 1, 1.5, 2].map((r) => (
                  <option key={r} value={r}>
                    {r}×
                  </option>
                ))}
              </select>
              <span className="ml-1.5 shrink-0 whitespace-nowrap font-mono text-[15px] leading-none tabular-nums">
                <span className="text-amber">{fmtTime(playhead)}</span>
                <span className="text-ink-faint"> / {fmtTime(duration)}</span>
              </span>
              <div className="flex-1" />
              {clip && (
                <>
                  <button
                    onClick={() => {
                      const list = data?.clips ?? [];
                      const i = list.findIndex((c) => c.path === clip.path);
                      const prev = list[i - 1];
                      if (prev) {
                        setSelected(prev.path);
                        seek(prev.start);
                      }
                    }}
                    className={KEY}
                  >
                    ‹ clip
                  </button>
                  <button
                    onClick={() => {
                      const list = data?.clips ?? [];
                      const i = list.findIndex((c) => c.path === clip.path);
                      const next = list[i + 1];
                      if (next) {
                        setSelected(next.path);
                        seek(next.start);
                      }
                    }}
                    className={KEY}
                  >
                    clip ›
                  </button>
                  <button
                    onClick={() => setLoop((v) => !v)}
                    className={`${CTL} ${CTL_SIZE} ${loop ? CTL_ON : CTL_GHOST}`}
                  >
                    Loop
                  </button>
                  <button onClick={() => seek(clip.start)} className={KEY}>
                    Go to clip
                  </button>
                  <button
                    onClick={() => setEdge("start", playhead)}
                    disabled={busy || playhead >= clip.end - 1}
                    className={`${CTL} ${CTL_SIZE} border-amber/50 bg-amber/10 text-amber`}
                  >
                    Set in here
                  </button>
                  <button
                    onClick={() => setEdge("end", playhead)}
                    disabled={busy || playhead <= clip.start + 1}
                    className={`${CTL} ${CTL_SIZE} border-amber/50 bg-amber/10 text-amber`}
                  >
                    Set out here
                  </button>
                  <button
                    onClick={() => act({ action: "split-clip", clip: clip.path, at: playhead })}
                    disabled={busy || playhead <= clip.start + 1 || playhead >= clip.end - 1}
                    className={KEY}
                  >
                    Split
                  </button>
                </>
              )}
              {markIn === null ? (
                <button onClick={() => setMarkIn(playhead)} disabled={!duration} className={KEY}>
                  Mark in
                </button>
              ) : (
                <>
                  {/* Amber, not gold: gold is reserved for singing everywhere else
                      in this screen, and a pending in-point is a "now", not a take. */}
                  <span className="shrink-0 font-head text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-dim">
                    in
                  </span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-amber">
                    {fmtTime(markIn)}
                  </span>
                  <button
                    onClick={() =>
                      act({
                        action: "create-clip",
                        stream,
                        start: Math.min(markIn, playhead),
                        end: Math.max(markIn, playhead),
                      }).then(() => setMarkIn(null))
                    }
                    disabled={busy || Math.abs(playhead - markIn) < 5}
                    className={`${CTL} ${CTL_SIZE} ${CTL_PRIMARY}`}
                  >
                    New clip
                  </button>
                  <button onClick={() => setMarkIn(null)} className={KEY}>
                    ✕
                  </button>
                </>
              )}
            </div>
          </Panel>

          {/* THE TIMELINE — five lanes, one axis, one playhead.

              Every lane is drawn against the same window (`view`) and cut by the
              same vertical, which is the whole point of the restructure: the
              audio, what the music map made of it, what was said and what got
              clipped all line up at the moment under the pointer. Reading a cut
              used to mean matching four separately-scaled strips by eye.

              Colour carries meaning and nothing else (DESIGN-CONSOLE rule 2):
              amber is now and selected, gold is singing, warm grey is beat,
              sienna needs an edit, mint is a passed check. The waveform and the
              transcript stay greyscale because neither one is a decision. */}
          <Panel className="shrink-0 overflow-hidden">
            {/* The unprepared notice sits above the stack rather than inside the
                audio lane. A lane has a fixed height so the gutter can name it;
                a paragraph and a button do not fit in 40px. */}
            {!wave.length && (
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-1.5">
                {prep.running ? (
                  <span className="font-mono text-[10.5px] text-amber">
                    preparing this stream — {prep.step ?? "working"}…
                  </span>
                ) : (
                  <>
                    <span className="font-mono text-[10.5px] text-ink-dim">
                      This stream has not been prepared yet — no waveform, music map or framing.
                    </span>
                    <button
                      onClick={async () => {
                        await fetch("/api/yp/prepare", {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({ stream }),
                        });
                        setPrep({ running: true, step: "starting" });
                      }}
                      className={`${CTL} ${CTL_SIZE} ${CTL_PRIMARY}`}
                    >
                      Prepare stream
                    </button>
                    <span className="font-mono text-[10px] text-ink-faint">~4 min</span>
                  </>
                )}
                {prep.error && (
                  <span className="font-mono text-[10px] text-sienna">{prep.error}</span>
                )}
              </div>
            )}

            <div className="flex">
              {/* Lane names sit beside their lane rather than in a legend below
                  it. The heights come from LANE — the same numbers the tracks
                  use — so a label cannot drift off the lane it names, and the
                  gutter stays outside #yp-lanes so a click on a track still maps
                  to the moment under the pointer. */}
              <div className="w-[96px] shrink-0 border-r border-line">
                {LANE_NAMES.map(([key, name]) => (
                  <div
                    key={key}
                    style={{ height: LANE[key] }}
                    className="flex items-center justify-end border-t border-line pr-2.5 font-head text-[9.5px] font-semibold uppercase leading-none tracking-[0.14em] text-ink-dim first:border-t-0"
                  >
                    {name}
                  </div>
                ))}
              </div>

              <div
                id="yp-lanes"
                className="relative min-w-0 flex-1 cursor-crosshair select-none"
                onClick={laneClick}
              >
                {/* STREAM TIME — hairline ticks, mono timecodes, half-steps unlabelled */}
                <div className="relative overflow-hidden" style={{ height: LANE.ruler }}>
                  {ticks.map(({ t, major }) => (
                    <div
                      key={t}
                      className="absolute inset-y-0 flex items-end"
                      style={{ left: `${pct(t)}%` }}
                    >
                      <span className={major ? "h-2 w-px bg-line-strong" : "h-1 w-px bg-line"} />
                      {major && (
                        <span className="pl-1 font-mono text-[9.5px] leading-none tabular-nums text-ink-dim">
                          {fmtTime(t)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {/* AUDIO */}
                <div
                  className="flex items-center gap-px overflow-hidden border-t border-line"
                  style={{ height: LANE.audio }}
                >
                  {wave.map((v, i) => (
                    <div
                      key={i}
                      className="flex-1 bg-ink/50"
                      style={{ height: `${Math.max(2, v * 100)}%` }}
                    />
                  ))}
                </div>

                {/* MUSIC MAP — height is the score, hue is the call. Singing and
                    beat were two stacked lanes, which meant reading the same span
                    twice to answer one question; the vocal track is the colour of
                    this one now. */}
                <div
                  className="flex items-end gap-px overflow-hidden border-t border-line"
                  style={{ height: LANE.music }}
                >
                  {bars.map((v, i) => (
                    <div
                      key={i}
                      className={`flex-1 ${(vocal[i] ?? 0) > 0.5 ? "bg-gold" : "bg-warmgray"}`}
                      style={{ height: `${Math.max(3, v * 100)}%`, opacity: 0.3 + v * 0.6 }}
                    />
                  ))}
                </div>

                {/* TRANSCRIPT — where the words are, not what they say. The words
                    themselves are in the inspector, following the playhead. */}
                <div
                  className="flex gap-px overflow-hidden border-t border-line"
                  style={{ height: LANE.transcript }}
                >
                  {speech.map((on, i) => (
                    <div key={i} className={`h-full flex-1 ${on ? "bg-ink/30" : ""}`} />
                  ))}
                </div>

                {/* CLIPS */}
                <div className="relative border-t border-line" style={{ height: LANE.clips }}>
                  {(data?.clips ?? []).map((c) => {
                    const isSel = c.path === selected;
                    const from = isSel && localEdge?.field === "start" ? localEdge.at : c.start;
                    const to = isSel && localEdge?.field === "end" ? localEdge.at : c.end;
                    const left = pct(from);
                    const width = Math.max(0.4, pct(to) - pct(from));
                    if (left > 100 || pct(to) < 0) return null;
                    // Amber means selected and nothing else, so an unselected clip
                    // is warm grey and a clip that needs work is sienna — the same
                    // two meanings those colours carry everywhere else.
                    const tone = isSel
                      ? "border-amber bg-amber/30"
                      : c.status === "needs_edit" || c.status === "rejected"
                        ? "border-sienna/60 bg-sienna/15 hover:bg-sienna/25"
                        : "border-warmgray/45 bg-warmgray/15 hover:bg-warmgray/25";
                    return (
                      <div
                        key={c.path}
                        className={`absolute top-0 h-full border ${tone}`}
                        style={{ left: `${left}%`, width: `${width}%` }}
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelected(c.path);
                            seek(c.start);
                          }}
                          title={`${fmtTime(c.start)} · ${c.context_tag}`}
                          className="h-full w-full"
                        />
                        {/* Mint is the machine talking: a 1px rule, never a fill. */}
                        {c.status === "approved" && (
                          <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-mint" />
                        )}
                        {/* The in-point on the block itself, bounded left and right
                            so a long timecode is clipped by its own clip rather than
                            spilling onto the next one. */}
                        {width > 6 && (
                          <span className="pointer-events-none absolute inset-y-0 left-1 right-1 flex items-center overflow-hidden whitespace-nowrap font-mono text-[9px] leading-none tabular-nums text-ink">
                            {fmtTime(c.start)}
                          </span>
                        )}
                        {/* Handles appear only once the clip is wide enough to aim at.
                            At full zoom a 30s clip in a 3h stream is about 4px — the
                            handles would cover the whole block and every select would
                            be a drag. Zoom in to trim. */}
                        {isSel && width > 2.5 && (
                          <>
                            <span
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                setEdgeDrag("start");
                              }}
                              className="absolute inset-y-0 -left-1 w-2 cursor-ew-resize bg-amber"
                            />
                            <span
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                setEdgeDrag("end");
                              }}
                              className="absolute inset-y-0 -right-1 w-2 cursor-ew-resize bg-amber"
                            />
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* The selected clip's span, carried across every lane. */}
                {clip && pct(clip.end) > 0 && pct(clip.start) < 100 && (
                  <div
                    className="pointer-events-none absolute inset-y-0 bg-amber/5"
                    style={{
                      left: `${pct(clip.start)}%`,
                      width: `${Math.max(0.2, pct(clip.end) - pct(clip.start))}%`,
                    }}
                  />
                )}

                {/* One playhead, through every lane including the ruler. */}
                <div
                  className="pointer-events-none absolute inset-y-0 w-px bg-amber"
                  style={{ left: `${pct(playhead)}%` }}
                >
                  <span className="absolute left-1/2 top-0 h-[3px] w-[9px] -translate-x-1/2 bg-amber" />
                </div>

                {/* The pending in-point. Dashed rather than a second hue: gold is
                    singing on this screen, and a mark is a "now", not a take. */}
                {markIn !== null && (
                  <div
                    className="pointer-events-none absolute inset-y-0 w-px"
                    style={{
                      left: `${pct(markIn)}%`,
                      backgroundImage:
                        "repeating-linear-gradient(to bottom, var(--color-amber) 0 4px, transparent 4px 8px)",
                    }}
                  />
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-1.5">
              <span className="font-head text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-dim">
                window
              </span>
              <span className="font-mono text-[11px] tabular-nums text-ink">
                {span ? fmtTime(span) : fmtTime(duration)}
              </span>
              {!span && (
                <span className="font-head text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  whole stream
                </span>
              )}
              <div className="flex-1" />
              <button
                onClick={() => setSpan((v) => Math.max(30, (v ?? duration) / 2))}
                className={KEY}
              >
                zoom in
              </button>
              <button
                onClick={() => setSpan((v) => (v && v * 2 < duration ? v * 2 : null))}
                className={KEY}
              >
                out
              </button>
              <button
                onClick={() => setSpan(clip ? Math.max(30, clip.duration * 3) : null)}
                className={KEY}
              >
                fit clip
              </button>
            </div>
          </Panel>
        </div>

        {/* inspector */}
        <div className="flex w-[clamp(300px,23vw,440px)] shrink-0 flex-col gap-3 overflow-auto">
          <Panel className="flex flex-col gap-3 p-4">
            {!clip ? (
              <div>
                <p className="text-[12.5px] leading-relaxed text-warmgray">
                  No clips for this stream yet. Either let it find the strongest music
                  moments, or scrub to a moment, Mark in, then New clip.
                </p>
                <Button
                  variant="primary"
                  className="mt-2.5 w-full"
                  disabled={!stream || finding || Boolean(prep.running)}
                  onClick={() => void findClips()}
                >
                  {finding ? "Finding…" : "Find clips"}
                </Button>
                {findNote && (
                  <p className="mt-2 border-l border-l-line bg-raised px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-ink">
                    {findNote}
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="font-head text-[15px] font-black uppercase text-cream">
                    {fmtTime(clip.start)}
                  </span>
                  <div className="flex gap-1.5">
                    {clip.creator && Object.keys(clip.creator).length > 0 && <Chip tone="amber">edited</Chip>}
                    <Chip tone="amber">{clip.context_tag}</Chip>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Chip>{clip.duration.toFixed(0)}s</Chip>
                  <Chip>{clip.mode === "split" ? "two-pane" : "single-pane"}</Chip>
                  {clip.status && clip.status !== "new" && <Chip tone="amber">{clip.status}</Chip>}
                </div>

                <div className="flex gap-2">
                  {(["start", "end"] as const).map((edge) => (
                    <div key={edge} className="flex-1">
                      <Label>{edge === "start" ? "in" : "out"}</Label>
                      <div className="mt-1 flex items-center gap-1">
                        <button
                          onClick={() => setEdge(edge, clip[edge] - NUDGE)}
                          disabled={busy}
                          className="rounded border border-white/15 px-2 py-1 font-mono text-xs text-cream hover:border-amber/50"
                        >
                          −
                        </button>
                        <button
                          onClick={() => seek(clip[edge])}
                          className="flex-1 text-center font-mono text-xs text-amber hover:underline"
                        >
                          {clip[edge].toFixed(1)}
                        </button>
                        <button
                          onClick={() => setEdge(edge, clip[edge] + NUDGE)}
                          disabled={busy}
                          className="rounded border border-white/15 px-2 py-1 font-mono text-xs text-cream hover:border-amber/50"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div>
                  <Label>tag</Label>
                  {/* The music tags are the common case and stay as the two big
                      buttons. They are not the only tags: analyze.py selects on
                      speech and emits banter / reaction / fasttalk / moment and
                      the rest, and 9 clips in the library carry those. Offering
                      only beat and singing meant an IRL clip could not be set to
                      its own tag — re-tagging one forced it to a music tag. */}
                  <div className="mt-1 flex gap-1.5">
                    {["beat", "singing"].map((t) => (
                      <button
                        key={t}
                        onClick={() => act({ action: "set-field", clip: clip.path, field: "context_tag", value: t })}
                        disabled={busy}
                        className={`flex-1 border px-2 py-1.5 font-head text-[11px] font-semibold uppercase tracking-[0.06em] ${
                          clip.context_tag !== t
                            ? "border-line-strong text-ink-dim hover:text-ink"
                            : t === "singing"
                              ? "border-gold bg-gold/15 text-gold"
                              : "border-warmgray bg-warmgray/15 text-ink"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {SPEECH_TAGS.map((t) => (
                      <button
                        key={t}
                        onClick={() => act({ action: "set-field", clip: clip.path, field: "context_tag", value: t })}
                        disabled={busy}
                        className={`border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] ${
                          clip.context_tag === t
                            ? "border-amber bg-amber/15 text-amber"
                            : "border-line-strong text-ink-dim hover:text-ink"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Why this clip. The selector already computes all of this and
                    it was going nowhere: without it the creator sees a number
                    and no reason, and cannot tell a framing they set from one
                    measured or inherited from a scene lock. */}
                <div>
                  <Label>why this clip</Label>
                  <p className="mt-1 font-mono text-[11px] leading-relaxed text-ink-dim">
                    {clip.reason ?? "no reason recorded"}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {typeof clip.score === "number" && (
                      <span title="How strongly music is playing, weighted by sustained vocal. Ranks within this stream only — not comparable between streams, and not a prediction of reach.">
                        <Chip>music {clip.score.toFixed(1)}</Chip>
                      </span>
                    )}
                    {typeof clip.sung_fraction === "number" && clip.sung_fraction > 0 && (
                      <Chip>sung {Math.round(clip.sung_fraction * 100)}%</Chip>
                    )}
                    {typeof clip.bpm === "number" && clip.bpm > 0 && (
                      <Chip>{clip.bpm.toFixed(0)} bpm</Chip>
                    )}
                    {clip.selector && <Chip>found by {clip.selector}</Chip>}
                    <Chip tone={clip.framing_origin === "measured" ? undefined : "amber"}>
                      framing: {clip.framing_origin ?? "measured"}
                    </Chip>
                  </div>
                </div>

                {/* The hook was static text here. It is the one field in a clip
                    that no machine can supply, and `set-copy` has been wired end
                    to end and called by nothing. */}
                <div>
                  <Label>hook</Label>
                  <input
                    key={clip.path}
                    defaultValue={clip.copy?.hook ?? ""}
                    placeholder="no hook written — the pack will use a generic one"
                    disabled={busy}
                    onBlur={(e) => {
                      const v = e.target.value;
                      if (v !== (clip.copy?.hook ?? "")) {
                        void act({
                          action: "set-copy",
                          clip: clip.path,
                          copy: { hook: v },
                        });
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    className="font-editorial mt-1 w-full border border-line-strong bg-ground px-2 py-1 text-[15px] text-ink outline-none placeholder:text-sienna placeholder:text-[12px] focus:border-amber"
                  />
                </div>

                {/* composed preview */}
                {preview &&
                  (preview.kind === "draft" ? (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <video src={preview.url} controls className="mx-auto max-h-[240px] rounded border border-white/15" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={preview.url}
                      alt="Composed frame"
                      className="mx-auto max-h-[240px] rounded border border-white/15"
                    />
                  ))}
                <div className="flex gap-1.5">
                  <button
                    onClick={() => render("still")}
                    disabled={busy}
                    className="flex-1 rounded-md border border-white/15 bg-white/5 px-2 py-1.5 font-head text-[11px] font-semibold text-cream hover:border-amber/50 disabled:opacity-40"
                  >
                    Frame
                  </button>
                  <button
                    onClick={() => render("draft")}
                    disabled={busy}
                    className="flex-1 rounded-md border border-amber/50 bg-amber/10 px-2 py-1.5 font-head text-[11px] font-semibold text-amber disabled:opacity-40"
                  >
                    Draft clip
                  </button>
                  <button
                    onClick={() => setSafe((v) => !v)}
                    className={`rounded-md border px-2 py-1.5 font-head text-[11px] font-semibold ${
                      safe ? "border-amber/50 bg-amber/10 text-amber" : "border-white/15 text-warmgray"
                    }`}
                  >
                    Safe
                  </button>
                </div>

                <div className="flex items-center gap-2 font-mono text-[9.5px] text-warmgray">
                  <span>space play · ←→ 1s · ⇧←→ 10s · , . frame · i/o in-out · [ ] zoom</span>
                  <button
                    onClick={() => {
                      if (confirm(`Remove this clip from the library?\n${fmtTime(clip.start)}`)) {
                        void act({ action: "delete-clip", clip: clip.path });
                      }
                    }}
                    className="ml-auto rounded border border-white/15 px-2 py-0.5 text-warmgray hover:border-sienna/60 hover:text-sienna"
                  >
                    delete
                  </button>
                </div>
                <div className="flex gap-1.5">
                  {(["approved", "needs_edit", "rejected"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => act({ action: "set-status", clip: clip.path, status: s })}
                      disabled={busy}
                      className={`flex-1 border px-2 py-1.5 font-head text-[11px] font-semibold uppercase tracking-[0.06em] ${
                        clip.status !== s
                          ? "border-line-strong text-ink hover:border-amber/60 hover:text-amber"
                          : s === "approved"
                            ? "border-mint text-mint"
                            : s === "needs_edit"
                              ? "border-sienna bg-sienna/20 text-sienna"
                              : "border-line-strong bg-white/[0.06] text-ink-dim"
                      }`}
                    >
                      {s.replace("_", " ")}
                    </button>
                  ))}
                </div>
              </>
            )}
          </Panel>

          {/* transcript, following the playhead */}
          <Panel className="flex min-h-0 flex-1 flex-col p-3">
            <Label>what is being said here</Label>
            <div className="mt-2 min-h-0 flex-1 overflow-auto">
              {nearby.length === 0 ? (
                <div className="flex flex-col items-start gap-2">
                  <p className="text-[11.5px] leading-relaxed text-warmgray">
                    {prep.step === "transcribe" || prep.step === "store"
                      ? "Transcribing this stream — captions will appear here when it finishes."
                      : (data?.transcript.segments.length ?? 0) > 0
                        ? "Nothing said near the playhead."
                        : "No transcript yet. Captions, hooks and the caption editor all read from it."}
                  </p>
                  {(data?.transcript.segments.length ?? 0) === 0 && !prep.running && (
                    <>
                      <button
                        onClick={async () => {
                          await fetch("/api/yp/prepare", {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({ stream, transcribe: true }),
                          });
                          setPrep({ running: true, step: "transcribe" });
                        }}
                        className={`${CTL} ${CTL_SIZE} ${CTL_PRIMARY}`}
                      >
                        Transcribe this stream
                      </button>
                      <span className="font-mono text-[10px] text-warmgray">
                        Whisper over {fmtTime(duration)} of audio — expect 30–60 min. It runs in
                        the background; you can keep clipping.
                      </span>
                    </>
                  )}
                </div>
              ) : (
                nearby.map((s, i) => (
                  <button
                    key={s.start}
                    onClick={() => seek(s.start)}
                    className={`mb-1 block w-full text-left text-[12px] leading-relaxed ${
                      i === currentIdx ? "text-cream" : "text-warmgray hover:text-cream"
                    }`}
                  >
                    <span className="mr-2 font-mono text-[9.5px] text-amber">{fmtTime(s.start)}</span>
                    {s.text.trim()}
                    {s.edited && <span className="ml-1 font-mono text-[8.5px] text-amber">✎</span>}
                  </button>
                ))
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/** Peak-preserving downsample, so a three-hour curve still shows its spikes. */
function downsample(values: number[], n: number): number[] {
  if (values.length <= n) return values;
  const step = values.length / n;
  return Array.from({ length: n }, (_, i) => {
    const a = Math.floor(i * step);
    const b = Math.max(Math.floor((i + 1) * step), a + 1);
    let peak = 0;
    for (let j = a; j < b && j < values.length; j++) peak = Math.max(peak, values[j]);
    return peak;
  });
}
