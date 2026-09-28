"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, ChevronLeft, ChevronRight, Play, X } from "lucide-react";
import {
  SESSIONS,
  YOUTUBE_CHANNEL,
  ytThumb,
} from "@/lib/content";
import { useStore } from "./store-provider";
import { Reveal } from "./reveal";

/**
 * The Orange Room Sessions block.
 *
 * Two rails, one shape. The sessions themselves come from YouTube, because
 * that is where Yanchan said they belong. The Instagram rail below carries the
 * India Edition, which is different work and stays where it was posted.
 *
 * The tiles are deliberately identical between the two. Every session on his
 * channel is uploaded as a vertical Short, so YouTube's `oardefault.jpg` hands
 * back the original 9:16 frame and the portrait tile the series has always had
 * needs no crop, no letterbox and no change of geometry. A 16:9 still forced
 * into this box is exactly the ugly crop we were told to avoid, so we never
 * ask for one here.
 *
 * No like count is rendered on either rail, and neither is ordered by one.
 */

type Tile = {
  key: string;
  poster: string;
  edition: string;
  title: string;
  /** Embed URL opened in the portrait modal when the tile is tapped. */
  embed: string;
  /** Sizes hint passed to next/image. */
  sizes: string;
};

const TILE_SIZES = "(max-width:640px) 70vw, 240px";

function PortraitModal({ tile, onClose }: { tile: Tile; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={tile.title}
    >
      <motion.div
        initial={{ scale: 0.94, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 8 }}
        transition={{ ease: [0.16, 1, 0.3, 1], duration: 0.4 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[400px]"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute -top-11 right-0 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-cream transition-colors hover:border-amber hover:text-amber"
        >
          <X size={17} />
        </button>
        {/* Portrait frame, same height for a Short and for a reel. */}
        <iframe
          src={tile.embed}
          title={`${tile.edition}: ${tile.title}`}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          scrolling="no"
          className="h-[min(78vh,700px)] w-full rounded-[4px] border border-white/10 bg-charcoal"
        />
      </motion.div>
    </motion.div>
  );
}

function Rail({
  tiles,
  link,
  railLabel,
}: {
  tiles: Tile[];
  link: { href: string; label: string };
  railLabel: string;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<Tile | null>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const { stop } = useStore();

  const measure = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({
      start: el.scrollLeft <= 4,
      end: max <= 4 || el.scrollLeft >= max - 4,
    });
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  const scrollBy = (dir: 1 | -1) => {
    const el = railRef.current;
    if (!el) return;
    const card = el.querySelector("[data-reel-card]") as HTMLElement | null;
    const step = card ? card.offsetWidth + 20 : el.clientWidth * 0.8;
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  };

  function openTile(t: Tile) {
    stop(); // don't let the audio player run under the video
    setOpen(t);
  }

  return (
    <div className="relative">
      <div className="mb-6 flex items-center justify-between gap-4">
        <a
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1.5 font-mono text-[0.65rem] uppercase tracking-[0.22em] text-warmgray transition-colors hover:text-amber"
        >
          {link.label} <ArrowUpRight size={13} />
        </a>
        <div className="flex gap-2">
          <button
            onClick={() => scrollBy(-1)}
            disabled={edges.start}
            aria-label={`Previous ${railLabel}`}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-cream transition-colors hover:border-amber hover:text-amber disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronLeft size={17} />
          </button>
          <button
            onClick={() => scrollBy(1)}
            disabled={edges.end}
            aria-label={`More ${railLabel}`}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-cream transition-colors hover:border-amber hover:text-amber disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </div>

      <Reveal>
        <div
          ref={railRef}
          onScroll={measure}
          className="-mx-5 flex snap-x snap-mandatory gap-5 overflow-x-auto px-5 pb-4 [scrollbar-width:none] sm:-mx-8 sm:px-8 [&::-webkit-scrollbar]:hidden"
        >
          {tiles.map((t) => (
            <button
              key={t.key}
              data-reel-card
              onClick={() => openTile(t)}
              aria-label={`Play ${t.edition} with ${t.title}`}
              className="group/reel relative w-[70vw] max-w-[260px] shrink-0 snap-start text-left sm:w-[240px]"
            >
              <span className="relative block aspect-[9/16] overflow-hidden rounded-[6px] border border-white/10 bg-coal transition-colors duration-500 group-hover/reel:border-amber/60">
                <Image
                  src={t.poster}
                  alt={t.title}
                  fill
                  sizes={t.sizes}
                  className="object-cover object-center transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/reel:scale-105"
                />
                <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-black/30" />

                <span className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-gold/90 text-void opacity-0 shadow-[0_12px_40px_-8px_rgba(255,222,0,0.7)] transition-all duration-500 group-hover/reel:opacity-100">
                  <Play size={22} className="ml-1" fill="currentColor" />
                </span>

                <span className="absolute inset-x-0 bottom-0 p-3.5">
                  <span className="block truncate font-mono text-[0.62rem] uppercase tracking-[0.2em] lg:text-[0.55rem] text-amber">
                    {t.edition}
                  </span>
                  <span className="mt-1 block font-head text-[0.95rem] font-bold leading-snug text-cream">
                    {t.title}
                  </span>
                </span>
              </span>
            </button>
          ))}
        </div>
      </Reveal>

      <AnimatePresence>
        {open && <PortraitModal tile={open} onClose={() => setOpen(null)} />}
      </AnimatePresence>
    </div>
  );
}

/** The sessions themselves. YouTube, in the original 9:16 frame. */
const sessionTiles: Tile[] = SESSIONS.map((s) => ({
  key: s.id,
  poster: ytThumb(s.youtubeId, "oar"),
  edition: s.edition,
  title: s.guest,
  embed: `https://www.youtube-nocookie.com/embed/${s.youtubeId}?autoplay=1&rel=0&modestbranding=1&playsinline=1`,
  sizes: TILE_SIZES,
}));

export function OrangeRoomSessions() {
  return (
    <div className="space-y-12">
      <Rail
        tiles={sessionTiles}
        link={{ href: YOUTUBE_CHANNEL, label: "Watch on YouTube" }}
        railLabel="sessions"
      />
    </div>
  );
}
