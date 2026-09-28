"use client";

import Image from "next/image";
import { useState } from "react";
import { Play } from "lucide-react";
import { Section, Button } from "./ui";

const KICK_HANDLE = "yanchanproduced";
const KICK_URL = `https://kick.com/${KICK_HANDLE}`;
// Kick's embeddable player. It only renders for domains the channel has
// allow-listed, so it stays behind a click and we show a designed panel until
// then — an unauthorised domain otherwise renders a dead black rectangle.
const KICK_EMBED = `https://player.kick.com/${KICK_HANDLE}?autoplay=true&muted=true`;

export function LiveStream() {
  const [showPlayer, setShowPlayer] = useState(false);

  return (
    <Section id="live" className="border-t border-white/10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-2xl">
          <span className="mb-5 inline-flex items-center gap-2.5 font-mono text-[0.7rem] uppercase tracking-[0.25em] text-amber">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
            </span>
            Live on Kick
          </span>
          <h2 className="font-display text-[clamp(2.2rem,6vw,4.5rem)] uppercase leading-[0.92] text-cream">
            In the <span className="text-amber">studio</span>, live
          </h2>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-warmgray sm:text-lg">
            Beat cook-ups, live mridangam sessions and Q&amp;As, streamed
            straight from Scarborough. Tap in when the light&apos;s on.
          </p>
        </div>
        <Button
          href={KICK_URL}
          external
          variant="secondary"
          className="shrink-0"
        >
          Open on Kick ↗
        </Button>
      </div>

      <div className="group relative aspect-[16/9] w-full overflow-hidden border border-white/10 bg-charcoal shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)]">
        {showPlayer ? (
          <iframe
            src={KICK_EMBED}
            title="Yanchan Produced · latest stream on Kick"
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 h-full w-full"
          />
        ) : (
          <button
            onClick={() => setShowPlayer(true)}
            aria-label="Load the Kick player"
            className="absolute inset-0 block"
          >
            <Image
              src="/assets/Booking.jpg"
              alt=""
              fill
              sizes="(max-width:1024px) 100vw, 1280px"
              className="object-cover opacity-60 transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03]"
            />
            <span className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/50 to-black/40" />
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#53fc18] text-void shadow-[0_16px_50px_-10px_rgba(83,252,24,0.5)] transition-transform duration-500 group-hover:scale-110 sm:h-20 sm:w-20">
                <Play size={26} className="ml-1" fill="currentColor" />
              </span>
              <span className="px-5 font-head text-sm font-bold uppercase tracking-[0.14em] text-cream">
                Load the live player
              </span>
              <span className="px-5 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-warmgray">
                kick.com/{KICK_HANDLE}
              </span>
            </span>
          </button>
        )}
      </div>

      <p className="mt-4 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-warmgray">
        Player blocked or offline? Watch the stream &amp; replays at{" "}
        <a
          href={KICK_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center text-amber underline-offset-2 hover:underline lg:min-h-0"
        >
          kick.com/{KICK_HANDLE}
        </a>
      </p>
    </Section>
  );
}
