"use client";

import Image from "next/image";
import { ArrowUpRight, Pause, Play } from "lucide-react";
import { RELEASES, type Release } from "@/lib/content";
import { useStore } from "./store-provider";
import { Reveal, Stagger, StaggerItem } from "./reveal";

function trackOf(r: Release) {
  return {
    id: r.id,
    title: r.title,
    subtitle: r.feat ? `feat. ${r.feat}` : "Yanchan Produced",
    art: r.art,
    // Only set where an official video for this release has been verified.
    // Absent means the player has nothing to play and falls back to the link,
    // rather than offering a control that does nothing.
    youtubeId: r.youtubeId,
    link: r.spotify ?? r.youtube,
  };
}

function Equalizer({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden className={`flex h-4 items-end gap-[3px] ${className}`}>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="eq-bar w-[3px] bg-gold"
          style={{ height: "100%", animationDelay: `${i * 0.14}s` }}
        />
      ))}
    </span>
  );
}

export function FeaturedReleases() {
  const { play, now, playing, toggle } = useStore();
  const [featured, ...rest] = RELEASES;

  const isLive = (r: Release) => now?.id === r.id;
  const isSpinning = (r: Release) => isLive(r) && playing;

  function hit(r: Release) {
    if (isLive(r)) toggle();
    else play(trackOf(r));
  }

  const links = [
    featured.spotify && { label: "Spotify", href: featured.spotify },
    featured.youtube && { label: "YouTube", href: featured.youtube },
    featured.apple && { label: "Apple Music", href: featured.apple },
  ].filter(Boolean) as { label: string; href: string }[];

  return (
    <div className="relative">
      {/* Ambient wash */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-[14%] -top-40 bottom-[-15%] -z-10 bg-[radial-gradient(55%_50%_at_25%_35%,rgba(245,136,4,0.20),transparent_70%),radial-gradient(45%_45%_at_88%_80%,rgba(126,43,12,0.40),transparent_70%)]"
      />

      <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1fr)] lg:gap-16">
        {/* ── FEATURED SLEEVE + VINYL ───────────────────────── */}
        <Reveal className="group relative mx-auto w-full max-w-[520px] lg:mx-0">
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-10 -z-10 bg-[radial-gradient(circle,rgba(245,136,4,0.25),transparent_65%)] blur-2xl transition-opacity duration-700 group-hover:opacity-100 opacity-70"
          />

          <div className="relative aspect-square w-full">
            {/* Vinyl, peeks out of the sleeve, slides further on hover, spins while playing */}
            <div className="absolute inset-y-[6%] left-[8%] aspect-square translate-x-[8%] transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-[30%] sm:translate-x-[16%]">
              <div
                className={`relative h-full w-full rounded-full ring-1 ring-white/15 shadow-[0_30px_70px_-25px_rgba(0,0,0,0.95),0_0_70px_-12px_rgba(245,136,4,0.4)] ${
                  isSpinning(featured) ? "animate-vinyl" : ""
                }`}
                style={{
                  background:
                    "repeating-radial-gradient(circle at 50% 50%, #121212 0 2px, #232323 2px 3px)",
                }}
              >
                <span className="absolute inset-0 rounded-full bg-[conic-gradient(from_0deg,rgba(255,255,255,0.22),transparent_22%,rgba(245,136,4,0.14)_48%,transparent_72%,rgba(255,255,255,0.18))]" />
                <span className="absolute left-1/2 top-1/2 h-[30%] w-[30%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber" />
                <span className="absolute left-1/2 top-1/2 h-[4%] w-[4%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-void" />
              </div>
            </div>

            {/* Sleeve */}
            <div className="absolute inset-0 z-10 overflow-hidden border border-amber/25 bg-charcoal shadow-[0_40px_90px_-35px_#000,0_0_0_1px_rgba(245,136,4,0.08)]">
              <Image
                src={featured.art}
                alt={featured.title}
                fill
                sizes="(max-width:1024px) 90vw, 460px"
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/10" />

              {featured.tag && (
                <span className="absolute left-4 top-4 flex items-center gap-2 bg-amber px-2.5 py-1 font-mono text-[0.65rem] font-bold uppercase tracking-[0.18em] lg:text-[0.6rem] text-void">
                  <span className="h-1.5 w-1.5 rounded-full bg-void" />
                  {featured.tag}
                </span>
              )}

              <button
                onClick={() => hit(featured)}
                aria-label={
                  isSpinning(featured)
                    ? `Pause ${featured.title}`
                    : `Play ${featured.title}`
                }
                className="absolute bottom-4 left-4 flex items-center gap-3 rounded-full bg-gold py-2 pl-2 pr-5 text-void shadow-[0_10px_30px_-8px_rgba(255,222,0,0.55)] transition-transform duration-300 hover:scale-[1.04]"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-void text-gold">
                  {isSpinning(featured) ? (
                    <Pause size={16} />
                  ) : (
                    <Play size={16} className="ml-0.5" />
                  )}
                </span>
                <span className="font-head text-xs font-bold uppercase tracking-[0.14em]">
                  {isSpinning(featured) ? "Playing" : "Play"}
                </span>
              </button>
            </div>
          </div>
        </Reveal>

        {/* ── FEATURED META + BACK CATALOGUE ────────────────── */}
        <div>
          <Reveal delay={0.08}>
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.3em] text-warmgray">
              Out now · {featured.year}
            </p>
            <h3 className="mt-3 font-display text-[clamp(2.4rem,5.5vw,4.2rem)] uppercase leading-[0.88] text-cream">
              {featured.title.split(" ").map((w, i, arr) => (
                <span
                  key={w + i}
                  className={i === arr.length - 1 ? "text-amber" : ""}
                >
                  {w}
                  {i < arr.length - 1 ? " " : ""}
                </span>
              ))}
            </h3>
            {featured.feat && (
              <p className="mt-3 font-head text-sm font-bold uppercase tracking-[0.14em] text-warmgray">
                feat. <span className="text-cream">{featured.feat}</span>
              </p>
            )}

            {links.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-2">
                {links.map((l) => (
                  <a
                    key={l.label}
                    href={l.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-cream/20 px-5 py-2 font-head text-[0.7rem] font-bold uppercase tracking-[0.12em] text-cream/80 transition-colors hover:border-amber hover:text-amber"
                  >
                    {l.label}
                    <ArrowUpRight size={13} />
                  </a>
                ))}
              </div>
            )}
          </Reveal>

          {/* Back catalogue */}
          <Reveal delay={0.14} className="mt-10 flex items-center gap-4">
            <span className="font-mono text-[0.65rem] uppercase tracking-[0.3em] lg:text-[0.6rem] text-warmgray">
              In the catalogue
            </span>
            <span className="h-px flex-1 bg-white/10" />
          </Reveal>

          <Stagger className="mt-2 divide-y divide-white/8 border-b border-white/8">
            {rest.map((r, i) => (
              <StaggerItem key={r.id} y={16}>
                <button
                  onClick={() => hit(r)}
                  aria-label={
                    isSpinning(r) ? `Pause ${r.title}` : `Play ${r.title}`
                  }
                  className="group/row relative flex w-full items-center gap-4 py-3.5 pl-3 pr-2 text-left transition-colors duration-300 hover:bg-amber/[0.06]"
                >
                  <span
                    aria-hidden
                    className={`absolute left-0 top-1/2 w-[2px] -translate-y-1/2 bg-amber transition-all duration-300 ${
                      isLive(r) ? "h-full" : "h-0 group-hover/row:h-full"
                    }`}
                  />

                  <span
                    className={`w-6 shrink-0 font-mono text-[0.7rem] tabular-nums transition-colors ${
                      isLive(r)
                        ? "text-amber"
                        : "text-warmgray group-hover/row:text-amber"
                    }`}
                  >
                    {String(i + 2).padStart(2, "0")}
                  </span>

                  <span className="relative h-11 w-11 shrink-0 overflow-hidden bg-coal">
                    <Image
                      src={r.art}
                      alt={r.title}
                      fill
                      sizes="44px"
                      className={`object-cover transition-all duration-500 ${
                        isLive(r)
                          ? "grayscale-0 opacity-100"
                          : "opacity-60 grayscale group-hover/row:opacity-100 group-hover/row:grayscale-0"
                      }`}
                    />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-head text-[0.95rem] font-bold text-cream transition-transform duration-300 group-hover/row:translate-x-1">
                      {r.title}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[0.65rem] uppercase tracking-[0.14em] text-warmgray">
                      {r.feat ? `feat. ${r.feat}` : "Yanchan Produced"}
                    </span>
                  </span>

                  <span className="hidden shrink-0 font-mono text-[0.65rem] tracking-[0.14em] text-warmgray sm:block">
                    {r.year}
                  </span>

                  <span className="flex h-8 w-8 shrink-0 items-center justify-center text-warmgray transition-colors group-hover/row:text-gold">
                    {isSpinning(r) ? (
                      <Equalizer />
                    ) : isLive(r) ? (
                      <Play size={15} className="ml-0.5 text-gold" />
                    ) : (
                      <Play size={15} className="ml-0.5" />
                    )}
                  </span>
                </button>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </div>
    </div>
  );
}
