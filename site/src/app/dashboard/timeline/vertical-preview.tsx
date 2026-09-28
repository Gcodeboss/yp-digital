"use client";

import { useEffect, useRef, useState } from "react";
import { THEME_ROOT_ID, themeColors, withAlpha } from "@/lib/theme";

export type Word = { word: string; start: number; end: number };
export type Seg = { start: number; end: number; text: string; words?: Word[] };

type Props = {
  video: React.RefObject<HTMLVideoElement | null>;
  cam: number[] | null;
  daw: number[] | null;
  segments: Seg[];
  showSafe: boolean;
  showCaptions: boolean;
  className?: string;
};

// The approved canvas and its panes — the same numbers compose.py renders with.
const W = 1080;
const H = 1920;
const TOP_H = 864;
const BOT_H = H - TOP_H;
const CAPTION_Y = 905;
const CROP_CAP = 0.22;
const MARK = { w: 520, bottom: 1890, h: 160 };

/**
 * The active theme name, watched on the themed root.
 *
 * Anything painted through CSS re-resolves itself when that attribute flips. A
 * canvas cannot: it keeps whatever colour strings it was handed, which is why
 * this preview used to render identically in both themes. Watching the
 * attribute is what tells the draw effect to re-read the palette, and it is the
 * one signal every path shares — the toggle, the stored preference applied on
 * mount, and a change made in another tab.
 */
function useThemeAttr(): string {
  const [theme, setTheme] = useState("");

  useEffect(() => {
    const root = document.getElementById(THEME_ROOT_ID) ?? document.documentElement;
    const read = () => setTheme(root.dataset.theme ?? "");
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

/**
 * A live 9:16 composition, drawn on a canvas from the source video.
 *
 * The output is two crops of one frame stacked, so the browser can build it
 * itself — no server round trip, no render wait. That is what makes it usable
 * while scrubbing: the point of editing in vertical is to see what the viewer
 * will see at the moment you choose a cut, and a preview that costs 25 seconds
 * cannot answer that question.
 *
 * It is an APPROXIMATION for judgement, not proof: the real render adds unsharp,
 * loudness normalisation and ASS-rendered captions in Arial Black. Use the draft
 * or the finished clip to confirm.
 */
export function VerticalPreview({
  video,
  cam,
  daw,
  segments,
  showSafe,
  showCaptions,
  className,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const theme = useThemeAttr();

  useEffect(() => {
    const cv = canvas.current;
    const v = video.current;
    if (!cv || !v) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    // The palette, resolved ONCE per effect run. `getComputedStyle` forces a
    // style recalculation, so reading a token inside `frame()` would pay for one
    // sixty times a second — the reason these were hardcoded hex in the first
    // place. Every derived string is built here too, for the same reason.
    const paint = themeColors();
    const safeFill = withAlpha(paint.sienna, 0.28);

    let raf = 0;

    /** Cover-crop within the cap, else fit and letterbox — as pane_chain does. */
    function drawPane(
      c: CanvasRenderingContext2D,
      src: number[],
      dx: number,
      dy: number,
      dw: number,
      dh: number
    ) {
      const [sx, sy, sw, sh] = src;
      const srcA = sw / sh;
      const paneA = dw / dh;
      let cw = sw;
      let ch = sh;
      if (srcA > paneA) cw = Math.max(sh * paneA, sw * (1 - CROP_CAP));
      else ch = Math.max(sw / paneA, sh * (1 - CROP_CAP));
      const cx = sx + (sw - cw) / 2;
      const cy = sy + (sh - ch) / 2;

      const scale = Math.min(dw / cw, dh / ch);
      const outW = cw * scale;
      const outH = ch * scale;
      // Letterbox fill is the panel value — the same flat dark card the renderer
      // puts behind a UI pane, and within a shade of it in either theme.
      c.fillStyle = paint.panel;
      c.fillRect(dx, dy, dw, dh);
      c.drawImage(
        v as CanvasImageSource,
        cx,
        cy,
        cw,
        ch,
        dx + (dw - outW) / 2,
        dy + (dh - outH) / 2,
        outW,
        outH
      );
    }

    function captionAt(t: number) {
      const seg = segments.find((s) => s.start <= t && s.end >= t);
      if (!seg) return null;
      const words = seg.words?.length
        ? seg.words
        : seg.text
            .trim()
            .split(/\s+/)
            .map((w, i, arr) => ({
              word: w,
              start: seg.start + ((seg.end - seg.start) * i) / arr.length,
              end: seg.start + ((seg.end - seg.start) * (i + 1)) / arr.length,
            }));
      // Group into short lines, the way the burned captions page.
      const line: Word[] = [];
      let chars = 0;
      for (const w of words) {
        if (w.end < t - 1.2) continue;
        if (chars > 26 && line.length) break;
        line.push(w);
        chars += w.word.trim().length + 1;
      }
      return line.length ? line : null;
    }

    function frame() {
      const c = ctx!;
      c.fillStyle = paint.ground;
      c.fillRect(0, 0, W, H);

      if (v!.readyState >= 2) {
        if (daw && cam) {
          drawPane(c, cam, 0, 0, W, TOP_H);
          drawPane(c, daw, 0, TOP_H, W, BOT_H);
        } else if (cam) {
          // Single-pane: fitted full width in the upper-middle.
          const [, , sw, sh] = cam;
          const outH = (W * sh) / sw;
          drawPane(c, cam, 0, 430, W, outH);
        }
      }

      if (showCaptions) {
        const line = captionAt(v!.currentTime);
        if (line) {
          c.textAlign = "center";
          c.textBaseline = "middle";
          const text = line.map((w) => w.word.trim().toUpperCase());
          // Fit the line inside the frame. A caption that runs off both edges is
          // the "titles cut off at clip edges" defect, and it should be visible
          // here rather than discovered in a finished render.
          const SAFE_W = W - 120;
          let size = 62;
          let widths: number[] = [];
          let total = 0;
          for (; size >= 34; size -= 2) {
            c.font = `700 ${size}px Archivo, system-ui, sans-serif`;
            widths = text.map((t) => c.measureText(`${t} `).width);
            total = widths.reduce((a, b) => a + b, 0);
            if (total <= SAFE_W) break;
          }
          let x = W / 2 - total / 2;
          const active = line.findIndex(
            (w) => w.start <= v!.currentTime && w.end >= v!.currentTime
          );
          text.forEach((t, i) => {
            c.lineWidth = 10;
            c.strokeStyle = paint.ground;
            c.lineJoin = "round";
            c.strokeText(t, x + widths[i] / 2, CAPTION_Y);
            // The burned render sets captions in white on black; here they take
            // the theme's ink and ground, which is the same reading at a glance
            // and keeps the preview in one palette with the tool around it.
            c.fillStyle = i === active ? paint.amber : paint.ink;
            c.fillText(t, x + widths[i] / 2, CAPTION_Y);
            x += widths[i];
          });
        }
      }

      // Where the mark sits, so its placement is visible while editing.
      c.strokeStyle = paint.amber;
      c.lineWidth = 3;
      c.strokeRect((W - MARK.w) / 2, MARK.bottom - MARK.h, MARK.w, MARK.h);

      if (showSafe) {
        c.fillStyle = safeFill;
        c.fillRect(0, 1570, W, H - 1570); // covered by Reels' caption block
        c.fillRect(939, 0, W - 939, H); // TikTok's button rail
      }

      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [video, cam, daw, segments, showSafe, showCaptions, theme]);

  return (
    <canvas
      ref={canvas}
      width={W}
      height={H}
      className={className ?? "h-full w-auto border border-line-strong"}
    />
  );
}
