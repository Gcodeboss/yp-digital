"use client";

import Image from "next/image";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, Pause, Play, X } from "lucide-react";
import { useStore, usePlayhead } from "./store-provider";

/** Seconds to m:ss. */
function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function MiniPlayer() {
  const { now, playing, toggle, stop } = useStore();
  const { position, duration, error } = usePlayhead();

  // The transport only appears when there is a real source behind it. An error
  // from the player (an embed the owner has blocked, say) counts as no source.
  const playable = Boolean(now?.youtubeId) && !error;
  const elsewhere = now?.link;
  const percent =
    playable && duration > 0
      ? Math.min(100, Math.max(0, (position / duration) * 100))
      : 0;

  return (
    <AnimatePresence>
      {now && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-x-0 bottom-0 z-50 border-t border-amber/30 bg-coal/95 lg:backdrop-blur-xl"
        >
          {/* Real position, read back from the player four times a second. The
              short transition only smooths between two true readings. */}
          <div className="h-[3px] w-full bg-white/10">
            <div
              className="h-full bg-amber transition-[width] duration-300 ease-linear"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="mx-auto flex max-w-[1320px] items-center gap-3 px-4 py-3">
            {playable ? (
              <button
                onClick={toggle}
                aria-label={playing ? "Pause" : "Play"}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gold text-void transition-transform hover:scale-105"
              >
                {playing ? (
                  <Pause size={18} />
                ) : (
                  <Play size={18} className="ml-0.5" />
                )}
              </button>
            ) : elsewhere ? (
              <a
                href={elsewhere}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Listen to ${now.title} elsewhere`}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gold text-void transition-transform hover:scale-105"
              >
                <ArrowUpRight size={18} />
              </a>
            ) : (
              <span
                aria-hidden
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-warmgray"
              >
                <Play size={18} className="ml-0.5" />
              </span>
            )}
            <Image
              src={now.art}
              alt=""
              width={44}
              height={44}
              className="h-11 w-11 shrink-0 object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-head text-sm font-bold text-cream">
                {now.title}
              </p>
              <p className="truncate font-mono text-[0.7rem] uppercase tracking-wider text-warmgray">
                {now.subtitle}
              </p>
            </div>
            <p className="shrink-0 font-mono text-[0.65rem] tabular-nums tracking-wider text-warmgray">
              {error
                ? "Unavailable"
                : playable
                  ? duration > 0
                    ? `${clock(position)} / ${clock(duration)}`
                    : clock(position)
                  : "Listen"}
            </p>
            {playing && (
              <div className="hidden items-end gap-[3px] sm:flex" aria-hidden>
                {[0, 1, 2, 3].map((i) => (
                  <motion.span
                    key={i}
                    className="w-[3px] bg-amber"
                    animate={{ height: [6, 18, 6] }}
                    transition={{
                      duration: 0.6,
                      repeat: Infinity,
                      delay: i * 0.12,
                    }}
                  />
                ))}
              </div>
            )}
            <button
              onClick={stop}
              aria-label="Close player"
              className="flex h-9 w-9 items-center justify-center text-warmgray hover:text-cream"
            >
              <X size={18} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
