"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Chip, Label, ScreenTitle, fmtTime } from "../yp-chrome";
import { RectEditor } from "./rect-editor";

type Clip = {
  path: string;
  date?: string;
  start: number;
  end: number;
  duration: number;
  context_tag: string;
  mode?: string;
  framing_origin?: string;
  framing?: { cam: number[]; daw: number[] | null };
  creator?: Record<string, unknown>;
  cam?: [number, number, number, number] | null;
  daw?: [number, number, number, number] | null;
};

type Rect = [number, number, number, number];
type Meta = {
  mode?: string;
  cam?: number[];
  daw?: number[] | null;
  origin?: string;
  magnification?: number;
  pane_aspect?: number;
  browser_px?: number;
  warnings?: string[];
  error?: string;
};

const FIELDS = ["x", "y", "w", "h"] as const;

/** Rule 4, inline: the smallest label the system has, for the four rect fields. */
const MICRO = "font-head text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-dim";

/**
 * The framing screen.
 *
 * Four regions, no cards: a clip list, the frame you drag on, the composition it
 * produces, and the numbers behind it. They are separated by a hairline and a
 * step in background value (panel beside ground) rather than by four outlined
 * boxes floating in a 16px gutter — see DESIGN-CONSOLE.md rule 1. The frame is
 * the one thing given room, because it is the only thing here you judge by eye.
 */
export function FramingClient({ clips }: { clips: Clip[] }) {
  const dates = useMemo(
    () => [...new Set(clips.map((c) => c.date).filter(Boolean))].sort().reverse() as string[],
    [clips]
  );
  const [date, setDate] = useState(dates[0] ?? "");
  const shown = useMemo(() => clips.filter((c) => c.date === date), [clips, date]);
  // ?clip= deep-links straight to one clip's framing, so a review note can point
  // at the exact thing that needs re-cropping instead of describing it.
  const params = useSearchParams();
  const wanted = params.get("clip");
  const [selected, setSelected] = useState<string | null>(
    (wanted && shown.some((c) => c.path === wanted) ? wanted : shown[0]?.path) ?? null
  );
  const clip = useMemo(() => shown.find((c) => c.path === selected) ?? shown[0] ?? null, [shown, selected]);

  const [cam, setCam] = useState<Rect | null>(null);
  const [daw, setDaw] = useState<Rect | null>(null);
  const [meta, setMeta] = useState<Meta>({});
  const [img, setImg] = useState<string | null>(null);
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 1280, height: 720 });
  const [arrangementLeft, setArrangementLeft] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [safe, setSafe] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);

  // Load the measured framing for this clip once, then edit locally.
  const loadMeta = useCallback(async (c: Clip) => {
    setLoading(true);
    setMsg(null);
    const res = await fetch(`/api/yp/preview?clip=${encodeURIComponent(c.path)}&meta=1`, {
      cache: "no-store",
    });
    const m = (await res.json()) as Meta & { error?: string };
    setMeta(m);

    // A saved framing that fails the gates used to leave this screen with zeroed
    // boxes, no frame and no way back — the only recovery was editing the library
    // by hand. Fall back to the measured rects, say so, and offer the undo.
    const bad = !res.ok || !m.cam;
    setRejected(bad ? m.error ?? "this clip's saved framing was rejected" : null);
    const useCam = (m.cam ?? c.cam ?? null) as Rect | null;
    const useDaw = (m.daw ?? c.daw ?? null) as Rect | null;
    if (useCam) setCam(useCam);
    setDaw(useDaw);

    // The frame to drag over. Fetched with the rects it was measured from, so the
    // overlay lines up with what the renderer will actually crop.
    const q = new URLSearchParams({ clip: c.path, kind: "source" });
    if (useCam) {
      q.set("cam", useCam.join(","));
      q.set("daw", useDaw ? useDaw.join(",") : "none");
    }
    const fr = await fetch(`/api/yp/preview?${q}`, { cache: "no-store" });
    if (fr.ok) {
      const header = fr.headers.get("X-Yp-Meta");
      if (header) {
        try {
          const fm = JSON.parse(header) as {
            frame?: { width: number; height: number };
            arrangement_left?: number;
          };
          if (fm.frame) setFrameSize(fm.frame);
          if (typeof fm.arrangement_left === "number") setArrangementLeft(fm.arrangement_left);
        } catch {
          /* header truncated; defaults are fine */
        }
      }
      const blob = await fr.blob();
      setFrameSrc((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (clip) void loadMeta(clip);
  }, [clip, loadMeta]);

  // Render a composed still for whatever rects are currently in the boxes.
  const preview = useCallback(async () => {
    if (!clip || !cam) return;
    setLoading(true);
    setMsg(null);
    const q = new URLSearchParams({
      clip: clip.path,
      cam: cam.join(","),
      daw: daw ? daw.join(",") : "none",
      safe: safe ? "1" : "0",
    });
    const res = await fetch(`/api/yp/preview?${q}`, { cache: "no-store" });
    if (!res.ok) {
      setMsg(((await res.json()) as { error?: string }).error ?? "preview failed");
      setLoading(false);
      return;
    }
    const header = res.headers.get("X-Yp-Meta");
    if (header) {
      try {
        setMeta((m) => ({ ...m, ...(JSON.parse(header) as Meta) }));
      } catch {
        /* header truncated — the image is still good */
      }
    }
    const blob = await res.blob();
    setImg((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(blob);
    });
    setLoading(false);
  }, [clip, cam, daw, safe]);

  async function save() {
    if (!clip || !cam) return;
    setLoading(true);
    const res = await fetch("/api/yp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "set-field",
        clip: clip.path,
        field: "framing",
        value: { cam, daw },
      }),
    });
    setMsg(res.ok ? "Framing saved — it will survive a re-render." : "save failed");
    setLoading(false);
  }

  async function lockScene() {
    if (!clip || !cam) return;
    setLoading(true);
    const res = await fetch("/api/yp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "add-lock",
        lock: {
          date: clip.date,
          start: Math.max(0, clip.start - 600),
          end: clip.end + 600,
          cam,
          daw,
          note: `locked from ${fmtTime(clip.start)}`,
        },
      }),
    });
    setMsg(res.ok ? "Locked ±10 min around this clip." : "lock failed");
    setLoading(false);
  }

  const setRect = (which: "cam" | "daw", i: number, v: number) => {
    const cur = which === "cam" ? cam : daw;
    if (!cur) return;
    const next = [...cur] as Rect;
    next[i] = v;
    (which === "cam" ? setCam : setDaw)(next);
  };

  /** The four number boxes for one rect, as one 24px row of labelled fields. */
  const fields = (which: "cam" | "daw", value: Rect) => (
    <div className="mt-1.5 flex gap-1">
      {FIELDS.map((f, i) => (
        <label key={f} className="flex flex-1 flex-col gap-0.5">
          <span className={MICRO}>{f}</span>
          <input
            type="number"
            value={value[i] ?? 0}
            onChange={(e) => setRect(which, i, Number(e.target.value))}
            className="h-6 w-full rounded-none border border-line-strong bg-ground px-1.5 font-mono text-[11px] tabular-nums text-ink focus:border-amber focus:outline-none"
          />
        </label>
      ))}
    </div>
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* This screen builds its own header rather than rendering TopBar, so it
          matches TopBar's 44px transport strip by hand. */}
      <header className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line bg-panel px-3 xl:px-4">
        <ScreenTitle>Framing</ScreenTitle>
        <select
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setSelected(null);
            setImg(null);
          }}
          className="h-7 rounded-none border border-line-strong bg-ground px-2 font-mono text-[11px] tabular-nums text-ink"
        >
          {dates.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        {meta.origin && <Chip tone={meta.origin === "measured" ? "muted" : "amber"}>{meta.origin}</Chip>}
        <div className="flex-1" />
        {msg && <span className="font-mono text-[10.5px] text-amber">{msg}</span>}
        {loading && (
          <span className="font-head text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-dim">
            working…
          </span>
        )}
      </header>

      {/* Sienna carries "something needs your attention" everywhere in this
          system, so the banner is a sienna rule rather than a filled card. */}
      {rejected && clip && (
        <div className="flex shrink-0 items-center gap-3 border-b border-b-line border-l-2 border-l-sienna bg-sienna/10 px-3 py-2">
          <span className="min-w-0 flex-1 text-[12px] leading-snug text-ink">
            The framing saved for this clip was rejected — {rejected}. Showing the measured
            framing instead; nothing has been changed.
          </span>
          <Button
            variant="danger"
            size="sm"
            onClick={async () => {
              await fetch("/api/yp", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ action: "undo", clip: clip.path }),
              });
              setRejected(null);
              void loadMeta(clip);
            }}
          >
            Discard the saved framing
          </Button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* clip picker — one 28px row per clip, so a full session is one screen */}
        <div className="flex w-[clamp(148px,11vw,208px)] shrink-0 flex-col border-r border-line bg-panel">
          <div className="flex h-7 shrink-0 items-center border-b border-line px-3">
            <Label>clips</Label>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {shown.map((c) => {
              const on = c.path === clip?.path;
              return (
                <button
                  key={c.path}
                  onClick={() => {
                    setSelected(c.path);
                    setImg(null);
                  }}
                  className={`flex h-7 w-full items-center gap-2 border-b border-line px-3 text-left last:border-b-0 ${
                    on ? "bg-amber/10" : "hover:bg-white/[0.03]"
                  }`}
                >
                  <span
                    className={`font-mono text-[11px] tabular-nums ${on ? "text-amber" : "text-ink"}`}
                  >
                    {fmtTime(c.start)}
                  </span>
                  <span className={`ml-auto ${MICRO}`}>{c.mode === "split" ? "2 pane" : "1 pane"}</span>
                  {/* Mint is the machine's colour: this clip already has a saved
                      framing, so it is a state, not a judgement. */}
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      c.creator?.framing ? "bg-mint" : "bg-transparent"
                    }`}
                    title={c.creator?.framing ? "framing saved" : undefined}
                  />
                </button>
              );
            })}
          </div>
        </div>

        {/* drag the rects on the frame, see the composition beside it */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-7 shrink-0 items-center gap-2.5 border-b border-line px-3">
            <Label>drag on the source frame</Label>
            <span className="font-mono text-[10px] tabular-nums text-ink-dim">
              {frameSize.width}×{frameSize.height}
            </span>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            <div className="w-full">
              <RectEditor
                src={frameSrc}
                frame={frameSize}
                cam={cam}
                daw={daw}
                arrangementLeft={arrangementLeft}
                onChange={(which, rect) => (which === "cam" ? setCam(rect) : setDaw(rect))}
                onCommit={preview}
              />
            </div>
          </div>
          <div className="flex h-10 shrink-0 items-center gap-1.5 border-t border-line px-3">
            <Button variant="primary" onClick={preview} disabled={loading || !cam}>
              Render still
            </Button>
            <Button variant="toggle" active={safe} onClick={() => setSafe((s) => !s)}>
              Safe areas {safe ? "on" : "off"}
            </Button>
            {loading && (
              <span className="font-head text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-dim">
                rendering…
              </span>
            )}
          </div>
        </div>

        <div className="flex w-[clamp(190px,15vw,290px)] shrink-0 flex-col border-l border-line bg-panel">
          <div className="flex h-7 shrink-0 items-center border-b border-line px-3">
            <Label>composed 9:16</Label>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-3">
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={img}
                alt="Composed preview of this clip"
                className="max-h-full w-auto border border-line"
              />
            ) : (
              <p className="max-w-[26ch] text-center text-[11.5px] leading-relaxed text-ink-dim">
                Let go of a rectangle and the composition re-renders here — about a second.
              </p>
            )}
          </div>
        </div>

        {/* controls */}
        <div className="flex w-[clamp(248px,20vw,340px)] shrink-0 flex-col overflow-auto border-l border-line bg-panel">
          {/* Rule 6 — the one display gesture on this screen, on its subject:
              which clip you are framing. */}
          <div className="shrink-0 border-b border-line px-3 py-2.5">
            <Label>clip</Label>
            <div className="font-display text-[clamp(1.9rem,3vw,2.75rem)] leading-[0.86] tracking-[-0.02em] text-ink tabular-nums">
              {clip ? fmtTime(clip.start) : "—"}
            </div>
            <div className="mt-0.5 font-mono text-[10px] tabular-nums text-ink-dim">
              {clip?.date ?? "no clip"}
            </div>
          </div>

          <div className="shrink-0 border-b border-line px-3 py-2">
            <Label>camera rect</Label>
            {fields("cam", (cam ?? [0, 0, 0, 0]) as Rect)}
          </div>

          <div className="shrink-0 border-b border-line px-3 py-2">
            <div className="flex h-6 items-center justify-between">
              <Label>daw rect</Label>
              <Button size="sm" onClick={() => setDaw(daw ? null : [330, 46, 307, 390])}>
                {daw ? "make single-pane" : "make two-pane"}
              </Button>
            </div>
            {daw ? (
              fields("daw", daw)
            ) : (
              <p className="mt-1 text-[11px] leading-snug text-ink-dim">
                Single-pane: the camera fills the frame over a blurred fill. Used when a
                scene has no usable Ableton pane.
              </p>
            )}
          </div>

          {/* Three readouts on one rule, values at 3x the label — rule 4. The
              browser strip is the only one with a stated limit, so it is the
              only one that can go sienna. */}
          <div className="grid shrink-0 grid-cols-3 border-b border-line">
            <div className="border-r border-line px-3 py-2">
              <Label>zoom</Label>
              <div className="mt-0.5 font-mono text-[17px] leading-none tabular-nums text-ink">
                {meta.magnification ? `${meta.magnification}×` : "—"}
              </div>
            </div>
            <div className="border-r border-line px-3 py-2">
              <Label>aspect</Label>
              <div className="mt-0.5 font-mono text-[17px] leading-none tabular-nums text-ink">
                {meta.pane_aspect ?? "—"}
              </div>
              <div className={`mt-1 ${MICRO}`}>target 1.02</div>
            </div>
            <div className="px-3 py-2">
              <Label>browser</Label>
              <div
                className={`mt-0.5 font-mono text-[17px] leading-none tabular-nums ${
                  (meta.browser_px ?? 0) > 90 ? "text-sienna" : "text-ink"
                }`}
              >
                {meta.browser_px ?? 0}
              </div>
              <div className={`mt-1 ${MICRO}`}>max 90 px</div>
            </div>
          </div>

          {(meta.warnings?.length ?? 0) > 0 && (
            <div className="shrink-0 border-b border-b-line border-l-2 border-l-sienna bg-sienna/[0.07] px-3 py-2">
              <Label>warnings</Label>
              {meta.warnings!.map((w, i) => (
                <p key={i} className="mt-1 text-[11px] leading-snug text-ink">
                  {w}
                </p>
              ))}
            </div>
          )}
          {meta.error && !rejected && (
            <div className="shrink-0 border-b border-b-line border-l-2 border-l-sienna bg-sienna/10 px-3 py-2">
              <p className="text-[11px] leading-snug text-ink">{meta.error}</p>
            </div>
          )}

          <div className="flex-1" />
          <div className="shrink-0 border-t border-line px-3 pt-2 pb-9">
            <div className="flex gap-1.5">
              <Button variant="primary" onClick={save} disabled={loading || !cam} className="flex-1">
                Save framing
              </Button>
              <Button onClick={lockScene} disabled={loading || !cam} className="flex-1">
                Lock scene
              </Button>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-ink-dim">
              A saved framing outranks the measurement and survives a re-render. A lock
              applies it to every clip in range and flags any where the webcam actually moved.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
