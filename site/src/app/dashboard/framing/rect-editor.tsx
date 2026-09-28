"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { themeColors, withAlpha } from "@/lib/theme";

export type Rect = [number, number, number, number];

type Props = {
  /** A still to drag over. Omit and pass `background` to drag over live video. */
  src?: string | null;
  background?: React.ReactNode;
  frame: { width: number; height: number };
  cam: Rect | null;
  daw: Rect | null;
  arrangementLeft?: number | null;
  onChange: (which: "cam" | "daw", rect: Rect) => void;
  onCommit?: () => void;
};

type Drag = {
  which: "cam" | "daw";
  handle: "move" | "nw" | "ne" | "sw" | "se";
  startX: number;
  startY: number;
  origin: Rect;
};

const HANDLES = ["nw", "ne", "sw", "se"] as const;
const MIN_SIDE = 40;

/**
 * Drag the camera and DAW rectangles directly on the frame.
 *
 * Framing is a spatial judgement — "is the arrangement in shot, is anyone cut
 * off" — and number boxes make you simulate the picture in your head to answer
 * it. Everything here works in source pixels and is clamped to the frame, so a
 * drag cannot produce a rect the renderer would reject.
 *
 * The overlay is the one thing on this screen CSS cannot reach. A rect carries
 * its geometry in an inline `style`, and its colour used to ride along as a hex
 * literal held in the `rects` array below — which made the palette *data*, so a
 * theme swap repainted the whole dashboard and left the overlay behind. Only the
 * pane's palette entry is data now; the value is resolved from the live tokens.
 */
export function RectEditor({
  src,
  background,
  frame,
  cam,
  daw,
  arrangementLeft,
  onChange,
  onCommit,
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [active, setActive] = useState<"cam" | "daw">("daw");

  /** Source pixels per screen pixel — every drag converts through this. */
  const scale = useCallback(() => {
    const el = box.current;
    if (!el) return 1;
    return frame.width / el.getBoundingClientRect().width;
  }, [frame.width]);

  const clamp = useCallback(
    (r: Rect): Rect => {
      let [x, y, w, h] = r;
      w = Math.max(MIN_SIDE, Math.min(w, frame.width));
      h = Math.max(MIN_SIDE, Math.min(h, frame.height));
      x = Math.max(0, Math.min(x, frame.width - w));
      y = Math.max(0, Math.min(y, frame.height - h));
      return [Math.round(x), Math.round(y), Math.round(w), Math.round(h)];
    },
    [frame.width, frame.height]
  );

  useEffect(() => {
    if (!drag) return;

    function move(e: PointerEvent) {
      if (!drag) return;
      const k = scale();
      const dx = (e.clientX - drag.startX) * k;
      const dy = (e.clientY - drag.startY) * k;
      const [ox, oy, ow, oh] = drag.origin;
      let next: Rect;
      switch (drag.handle) {
        case "move":
          next = [ox + dx, oy + dy, ow, oh];
          break;
        case "nw":
          next = [ox + dx, oy + dy, ow - dx, oh - dy];
          break;
        case "ne":
          next = [ox, oy + dy, ow + dx, oh - dy];
          break;
        case "sw":
          next = [ox + dx, oy, ow - dx, oh + dy];
          break;
        default:
          next = [ox, oy, ow + dx, oh + dy];
      }
      onChange(drag.which, clamp(next));
    }

    function up() {
      setDrag(null);
      onCommit?.();
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, scale, clamp, onChange, onCommit]);

  function begin(e: React.PointerEvent, which: "cam" | "daw", handle: Drag["handle"], origin: Rect) {
    e.preventDefault();
    e.stopPropagation();
    setActive(which);
    setDrag({ which, handle, startX: e.clientX, startY: e.clientY, origin });
  }

  const style = (r: Rect) => ({
    left: `${(r[0] / frame.width) * 100}%`,
    top: `${(r[1] / frame.height) * 100}%`,
    width: `${(r[2] / frame.width) * 100}%`,
    height: `${(r[3] / frame.height) * 100}%`,
  });

  /**
   * One snapshot of the palette per render — never inside a handler and never
   * inside the pointermove loop. Reading a custom property goes through
   * getComputedStyle, which forces a style recalculation, and a drag re-renders
   * this component on every frame.
   */
  const palette = themeColors();

  /**
   * The two panes keep an identity colour rather than sharing one: they are the
   * only two objects on the frame and hue is how you tell them apart without
   * reading. Selection is carried by weight and fill instead — the pane you are
   * holding draws a 2px edge, the other a hairline.
   */
  const rects: { which: "cam" | "daw"; rect: Rect | null; colour: string; label: string }[] = [
    { which: "daw", rect: daw, colour: palette.amber, label: "ableton" },
    { which: "cam", rect: cam, colour: palette.gold, label: "camera" },
  ];

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={box}
        className={`relative w-full select-none overflow-hidden border border-line ${
          background === undefined ? "bg-ground" : ""
        }`}
        style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
      >
        {background !== undefined ? (
          background ? <div className="pointer-events-none absolute inset-0">{background}</div> : null
        ) : src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="Source frame" className="h-full w-full" draggable={false} />
        ) : (
          <div className="flex h-full items-center justify-center font-head text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-dim">
            loading frame…
          </div>
        )}

        {/* where the Ableton arrangement begins — the left edge worth respecting */}
        {arrangementLeft ? (
          <div
            className="pointer-events-none absolute inset-y-0 border-l border-dashed border-line-strong"
            style={{ left: `${(arrangementLeft / frame.width) * 100}%` }}
          />
        ) : null}

        {rects.map(({ which, rect, colour, label }) =>
          rect ? (
            <div
              key={which}
              onPointerDown={(e) => begin(e, which, "move", rect)}
              className="absolute cursor-move"
              style={{
                ...style(rect),
                // withAlpha rather than the `${colour}1a` this used to
                // concatenate: a token is free to be rgb() or oklch(), and a hex
                // pair glued onto either produces a string the browser drops.
                border: `${active === which ? 2 : 1}px solid ${colour}`,
                background: withAlpha(colour, active === which ? 0.1 : 0.05),
                zIndex: active === which ? 3 : 2,
              }}
            >
              <span
                className="absolute -top-[15px] left-0 px-1 font-head text-[9px] font-semibold uppercase tracking-[0.12em]"
                style={{ background: colour, color: palette.ground }}
              >
                {label}
              </span>
              {HANDLES.map((h) => (
                <span
                  key={h}
                  onPointerDown={(e) => begin(e, which, h, rect)}
                  className="absolute h-3 w-3"
                  style={{
                    background: colour,
                    cursor: h === "nw" || h === "se" ? "nwse-resize" : "nesw-resize",
                    left: h.includes("w") ? -6 : undefined,
                    right: h.includes("e") ? -6 : undefined,
                    top: h.startsWith("n") ? -6 : undefined,
                    bottom: h.startsWith("s") ? -6 : undefined,
                  }}
                />
              ))}
            </div>
          ) : null
        )}
      </div>

      {/* The readout under the frame: pane name recedes, the rect it carries
          does not. Swatches resolve through the token in CSS — they are a flat
          fill with no alpha to compose, so nothing here needs the runtime. */}
      <div className="flex items-center gap-4">
        {rects.map(({ which, rect, label }) => (
          <span key={which} className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 ${which === "daw" ? "bg-amber" : "bg-gold"}`} />
            <span className="font-head text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-dim">
              {label}
            </span>
            <span
              className={`font-mono text-[11px] tabular-nums ${rect ? "text-ink" : "text-ink-dim"}`}
            >
              {rect ? rect.join(" ") : "single-pane"}
            </span>
          </span>
        ))}
        <span className="ml-auto font-head text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-dim">
          drag to move · corners resize
        </span>
      </div>
    </div>
  );
}
