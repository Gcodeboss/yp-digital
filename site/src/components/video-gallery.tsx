"use client";

import Image from "next/image";
import { useState } from "react";
import { Play } from "lucide-react";
import { VIDEOS, ytThumb, type VideoItem } from "@/lib/content";
import { useStore } from "./store-provider";
import { Reveal, Stagger, StaggerItem } from "./reveal";

export function VideoGallery() {
  const [active, setActive] = useState<VideoItem>(VIDEOS[0]);
  const [live, setLive] = useState(false);
  const { stop } = useStore();

  function pick(v: VideoItem, autoplay: boolean) {
    // Never let the audio player and a video talk over each other.
    stop();
    setActive(v);
    setLive(autoplay);
  }

  const queue = VIDEOS.filter((v) => v.id !== active.id);

  return (
    <div>
      {/* ── FEATURED PLAYER ──────────────────────────────── */}
      <Reveal className="group relative">
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-6 -z-10 bg-[radial-gradient(60%_60%_at_50%_50%,rgba(245,136,4,0.18),transparent_70%)] blur-2xl"
        />
        <div className="relative aspect-video w-full overflow-hidden border border-white/10 bg-charcoal">
          {live ? (
            <iframe
              key={active.youtubeId}
              src={`https://www.youtube-nocookie.com/embed/${active.youtubeId}?autoplay=1&rel=0&modestbranding=1`}
              title={active.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 h-full w-full"
            />
          ) : (
            <button
              onClick={() => pick(active, true)}
              aria-label={`Play ${active.title}`}
              className="absolute inset-0 block"
            >
              <Image
                src={ytThumb(active.youtubeId)}
                alt={active.title}
                fill
                sizes="(max-width:1024px) 100vw, 900px"
                className="object-cover transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03]"
              />
              <span className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-black/10" />

              <span className="absolute left-1/2 top-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-gold text-void shadow-[0_16px_50px_-10px_rgba(255,222,0,0.6)] transition-transform duration-500 group-hover:scale-110">
                <Play size={30} className="ml-1.5" fill="currentColor" />
              </span>

              <span className="absolute inset-x-0 bottom-0 p-5 text-left sm:p-8">
                {active.series && (
                  <span className="block font-mono text-[0.65rem] uppercase tracking-[0.28em] text-amber">
                    {active.series}
                  </span>
                )}
                <span className="mt-2 block font-display text-[clamp(1.5rem,3.6vw,2.8rem)] uppercase leading-[0.95] text-cream">
                  {active.title}
                </span>
                {active.note && (
                  <span className="mt-2 block font-mono text-[0.65rem] uppercase tracking-[0.2em] text-warmgray">
                    {active.note}
                  </span>
                )}
              </span>
            </button>
          )}
        </div>
      </Reveal>

      {/* ── QUEUE ────────────────────────────────────────── */}
      <Reveal delay={0.1} className="mt-10 flex items-center gap-4">
        <span className="font-mono text-[0.65rem] uppercase tracking-[0.3em] lg:text-[0.6rem] text-warmgray">
          Up next
        </span>
        <span className="h-px flex-1 bg-white/10" />
      </Reveal>

      <Stagger className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-5">
        {queue.map((v) => (
          <StaggerItem key={v.id}>
            <button
              onClick={() => pick(v, true)}
              aria-label={`Play ${v.title}`}
              className="group/thumb block w-full text-left"
            >
              <span className="relative block aspect-video overflow-hidden border border-white/8 bg-coal transition-colors group-hover/thumb:border-amber/50">
                <Image
                  src={ytThumb(v.youtubeId, "hq")}
                  alt={v.title}
                  fill
                  sizes="(max-width:768px) 50vw, 240px"
                  className="object-cover opacity-70 transition-all duration-500 group-hover/thumb:scale-105 group-hover/thumb:opacity-100"
                />
                <span className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                <span className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-gold/0 text-cream transition-all duration-300 group-hover/thumb:bg-gold group-hover/thumb:text-void">
                  <Play size={13} className="ml-0.5" fill="currentColor" />
                </span>
              </span>
              <span className="mt-3 block font-head text-[0.85rem] font-bold leading-snug text-cream/90 transition-colors group-hover/thumb:text-cream">
                {v.title}
              </span>
              {v.series && (
                <span className="mt-1 block font-mono text-[0.65rem] uppercase tracking-[0.14em] lg:text-[0.6rem] text-warmgray">
                  {v.series}
                </span>
              )}
            </button>
          </StaggerItem>
        ))}
      </Stagger>
    </div>
  );
}
