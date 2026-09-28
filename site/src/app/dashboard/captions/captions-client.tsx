"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Chip, EmptyState, Label, ScreenTitle, fmtTime } from "../yp-chrome";

type Segment = { start: number; end: number; text: string; edited?: boolean };
type Clip = { path: string; date?: string; start: number; end: number; context_tag: string };

const MICRO = "font-head text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-dim";

/**
 * The transcript, one line per row.
 *
 * This screen is a list of timecoded lines, so it is built as one: 30px rows on
 * a hairline, no card around them, and the transcript region a single value step
 * up from ground. See DESIGN-CONSOLE.md rules 1 and 5.
 *
 * Colour is spent twice and nowhere else. Amber is the line you are hearing —
 * "now", the only thing on the screen that moves. Mint marks a line a human has
 * already corrected: a machine-checkable state, carried on a 1px left rule and a
 * dot rather than a fill. Every other timecode is --ink-dim; a column of amber
 * timecodes, which is what this used to be, tells you nothing.
 */
export function CaptionsClient({ streams, clips }: { streams: string[]; clips: Clip[] }) {
  const [stream, setStream] = useState(streams[0] ?? "");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [coverage, setCoverage] = useState<string | null>(null);
  const [scope, setScope] = useState<string>("all");
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async (date: string) => {
    if (!date) return;
    const res = await fetch(`/api/yp?view=transcript&stream=${date}`, { cache: "no-store" });
    const json = (await res.json()) as { segments?: Segment[]; coverage?: string };
    setSegments(json.segments ?? []);
    setCoverage(json.coverage ?? null);
  }, []);

  useEffect(() => {
    void load(stream);
  }, [stream, load]);

  const streamClips = useMemo(() => clips.filter((c) => c.date === stream), [clips, stream]);

  const shown = useMemo(() => {
    if (scope === "all") return segments;
    const c = streamClips.find((x) => x.path === scope);
    if (!c) return segments;
    return segments.filter((s) => s.end > c.start && s.start < c.end);
  }, [segments, scope, streamClips]);

  const edited = segments.filter((s) => s.edited).length;

  async function save(seg: Segment) {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/yp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "fix-transcript",
        stream,
        at: seg.start,
        text: draft.trim(),
      }),
    });
    if (!res.ok) setMsg("could not save that correction");
    setEditing(null);
    await load(stream);
    setBusy(false);
  }

  const audio = useRef<HTMLVideoElement>(null);
  const [playingAt, setPlayingAt] = useState<number | null>(null);

  function hear(at: number) {
    const el = audio.current;
    if (!el) return;
    if (playingAt === at && !el.paused) {
      el.pause();
      setPlayingAt(null);
      return;
    }
    el.currentTime = Math.max(0, at - 0.4);
    void el.play();
    setPlayingAt(at);
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* Audio only — the element is never shown, it exists to be listened to. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={audio}
        src={`/api/yp/video?stream=${stream}`}
        preload="metadata"
        className="hidden"
        onPause={() => setPlayingAt(null)}
      />
      {/* Built by hand rather than with TopBar, and held at TopBar's 44px. */}
      <header className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line bg-panel px-3 xl:px-4">
        <ScreenTitle>Captions</ScreenTitle>
        <select
          value={stream}
          onChange={(e) => {
            setStream(e.target.value);
            setScope("all");
          }}
          className="h-7 rounded-none border border-line-strong bg-ground px-2 font-mono text-[11px] tabular-nums text-ink"
        >
          {streams.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {coverage && (
          <span className={`flex items-center gap-1.5 ${MICRO}`}>
            <span
              className={`h-1.5 w-1.5 rounded-full ${coverage === "full" ? "bg-mint" : "bg-ink-faint"}`}
            />
            {coverage === "full" ? "whole stream" : "clip windows only"}
          </span>
        )}
        {edited > 0 && (
          <span className={`flex items-center gap-1.5 ${MICRO}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-mint" />
            <span className="font-mono text-[11px] tabular-nums text-ink">{edited}</span>
            corrected
          </span>
        )}
        <div className="flex-1" />
        {msg && <span className="font-mono text-[10.5px] text-sienna">{msg}</span>}
        <a
          href={`/api/yp/transcript?stream=${stream}&format=txt`}
          className="flex h-7 items-center rounded-md border border-line-strong bg-white/[0.04] px-2.5 font-head text-[11px] font-semibold uppercase tracking-[0.06em] text-ink hover:border-amber/60 hover:text-amber"
        >
          Export .txt
        </a>
        <a
          href={`/api/yp/transcript?stream=${stream}&format=srt`}
          className="flex h-7 items-center rounded-md border border-line-strong bg-white/[0.04] px-2.5 font-head text-[11px] font-semibold uppercase tracking-[0.06em] text-ink hover:border-amber/60 hover:text-amber"
        >
          Export .srt
        </a>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-3 py-1.5">
            <button onClick={() => setScope("all")}>
              <Chip tone={scope === "all" ? "amber" : "muted"}>whole stream</Chip>
            </button>
            {streamClips.map((c) => (
              <button key={c.path} onClick={() => setScope(c.path)}>
                <Chip tone={scope === c.path ? "amber" : "muted"}>{fmtTime(c.start)}</Chip>
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-auto bg-panel">
            {shown.length === 0 ? (
              <EmptyState
                title="No transcript for this stream"
                body="Captions, hooks and clip copy all read from the transcript. Transcribing runs in the background and takes 30–60 minutes for a full session."
                action={
                  <Button
                    variant="primary"
                    onClick={async () => {
                      await fetch("/api/yp/prepare", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ stream, transcribe: true }),
                      });
                      setMsg("transcribing — this screen will fill in when it finishes");
                    }}
                  >
                    Transcribe this stream
                  </Button>
                }
              />
            ) : (
              shown.map((seg) => (
                <div
                  key={seg.start}
                  className={`group grid grid-cols-[20px_58px_minmax(0,1fr)] items-start gap-2.5 border-b border-b-line border-l px-3 py-1 last:border-b-0 ${
                    seg.edited ? "border-l-mint" : "border-l-transparent"
                  }`}
                >
                  <button
                    onClick={() => hear(seg.start)}
                    title="hear this line"
                    aria-label={`Play audio at ${fmtTime(seg.start)}`}
                    className={`flex h-5 w-5 items-center justify-center rounded-full border text-[8px] transition-colors ${
                      playingAt === seg.start
                        ? "border-amber bg-amber text-ground"
                        : "border-line-strong text-ink-dim hover:border-amber/60 hover:text-amber"
                    }`}
                  >
                    {playingAt === seg.start ? "❙❙" : "▶"}
                  </button>
                  <span
                    className={`pt-px font-mono text-[11px] tabular-nums ${
                      playingAt === seg.start ? "text-amber" : "text-ink-dim"
                    }`}
                  >
                    {fmtTime(seg.start)}
                  </span>
                  {editing === seg.start ? (
                    <div className="flex flex-col gap-1.5">
                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={2}
                        autoFocus
                        className="w-full rounded-none border border-amber/50 bg-ground px-2 py-1 text-[12.5px] leading-snug text-ink focus:border-amber focus:outline-none"
                      />
                      <div className="flex items-center gap-1.5">
                        <Button variant="primary" size="sm" onClick={() => save(seg)} disabled={busy}>
                          Save
                        </Button>
                        <Button size="sm" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                        <span className="font-mono text-[10px] tabular-nums text-ink-dim">
                          timing stays at {seg.start.toFixed(2)}s
                        </span>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setEditing(seg.start);
                        setDraft(seg.text.trim());
                      }}
                      className="text-left text-[12.5px] leading-snug text-ink hover:text-amber"
                    >
                      {seg.text.trim() || <span className="text-ink-dim">(silence)</span>}
                      {seg.edited && (
                        <span className="ml-2 font-head text-[9px] font-semibold uppercase tracking-[0.14em] text-mint">
                          corrected
                        </span>
                      )}
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex w-[clamp(218px,17vw,290px)] shrink-0 flex-col border-l border-line bg-panel">
          {/* Rule 6 — the one display gesture, on this screen's subject: how much
              transcript there is to work through. */}
          <div className="shrink-0 border-b border-line px-3 py-2.5">
            <Label>lines</Label>
            <div className="font-display text-[clamp(2.1rem,3.4vw,3rem)] leading-[0.86] tracking-[-0.02em] tabular-nums text-ink">
              {segments.length}
            </div>
          </div>

          <div className="shrink-0 border-b border-line px-3 py-2.5">
            <Label>style · locked</Label>
            <div className="mt-1.5 flex h-5 items-center gap-2">
              {/* The one literal colour left in the dashboard, and deliberate:
                  this swatch previews the burned-in caption body, which really is
                  white. A token would re-tint it with the theme and the preview
                  would start lying — the console theme points `white` at cream. */}
              <span className="h-2.5 w-2.5 shrink-0" style={{ background: "#ffffff" }} />
              <span className={MICRO}>white body</span>
            </div>
            <div className="flex h-5 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 bg-amber" />
              <span className={MICRO}>amber active word</span>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-ink-dim">
              Signed off as-is. This screen is for fixing what was misheard, not
              restyling.
            </p>
          </div>

          <div className="shrink-0 border-b border-line px-3 py-2.5">
            <Label>how a fix behaves</Label>
            <ul className="mt-1.5 flex flex-col gap-1.5 text-[11px] leading-snug text-ink-dim">
              <li>· It binds to that segment&rsquo;s timing, so nothing moves.</li>
              <li>· It reaches the burned captions on the next render.</li>
              <li>· Re-transcribing with a better model replaces the machine text and
                leaves your fixes alone.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
