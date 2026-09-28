import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Star } from "lucide-react";
import { Hero } from "@/components/hero";
import { Reveal, Stagger, StaggerItem } from "@/components/reveal";
import { Button, Eyebrow, Section, SectionHeading } from "@/components/ui";
import { BookingForm } from "@/components/booking-form";

import type { Metadata } from "next";

/**
 * The homepage is the one page whose canonical genuinely IS the site root. It
 * states it explicitly rather than relying on a layout-wide default: that
 * default is exactly what made every other page claim to be this one.
 */
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};
import { FeaturedReleases } from "@/components/featured-releases";
import { OrangeRoomSessions } from "@/components/reels-slider";
import { VideoGallery } from "@/components/video-gallery";
import { LiveStream } from "@/components/live-stream";
import { ProductPlate } from "@/components/merch-grid";
import {
  PRESS,
  REACH,
  STATS,
  FAQ,
  YOUTUBE_CHANNEL,
} from "@/lib/content";
import { MERCH, formatCad } from "@/lib/merch";

export default function Home() {
  return (
    <>
      <Hero />

      {/* PRESS / SOCIAL PROOF */}
      <Link
        href="/press"
        className="group block border-b border-white/10 bg-coal py-7"
      >
        <div className="mx-auto max-w-[1320px] px-5 sm:px-8">
          <p className="mb-5 text-center font-mono text-[0.65rem] uppercase tracking-[0.3em] text-warmgray">
            As featured in{" "}
            <span className="text-amber">· read the press →</span>
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
            {PRESS.map((p) => (
              <span
                key={p}
                className="font-head text-lg font-extrabold uppercase tracking-tight text-cream/40 transition-colors group-hover:text-cream/70"
              >
                {p}
              </span>
            ))}
          </div>
        </div>
      </Link>

      {/* STATS */}
      <Section className="!py-14">
        <Stagger className="grid grid-cols-2 gap-6 md:grid-cols-4">
          {STATS.map((s) => (
            <StaggerItem key={s.label} className="text-center md:text-left">
              <p className="font-display text-[clamp(2.5rem,6vw,4rem)] leading-none text-amber">
                {s.value}
              </p>
              <p className="mt-2 font-mono text-[0.7rem] uppercase tracking-[0.15em] text-warmgray">
                {s.label}
              </p>
            </StaggerItem>
          ))}
        </Stagger>
        <Reveal
          delay={0.2}
          className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 border-t border-white/10 pt-7 md:justify-start"
        >
          {REACH.map((r) => (
            <span
              key={r.label}
              className="font-mono text-[0.7rem] uppercase tracking-[0.15em] text-warmgray"
            >
              <span className="text-cream">{r.value}</span> {r.label}
            </span>
          ))}
        </Reveal>
      </Section>

      {/* ABOUT / BRIDGE */}
      <Section className="border-t border-white/10">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <Reveal className="relative aspect-[4/5] overflow-hidden">
            <Image
              src="/assets/yanchan-portrait.jpg"
              alt="Yanchan Produced, portrait"
              fill
              sizes="(max-width:1024px) 100vw, 600px"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
          </Reveal>
          <div>
            <SectionHeading
              eyebrow="The Bridge"
              title={
                <>
                  Two worlds.
                  <br />
                  <span className="text-amber">One pulse.</span>
                </>
              }
              intro="Yanchan Rajmohan is a Canadian-Tamil producer, mixing engineer, singer and professional Mridangam player from Scarborough. The youngest to perform a Mridangam Arangetram in Canada at age 8, and the first artist of Eelam origin to perform at an NBA game."
            />
            <p className="mt-5 max-w-xl leading-relaxed text-warmgray">
              No alter ego. No &ldquo;East meets West&rdquo; gimmick. Just the
              ancient rhythms of Carnatic percussion driving the raw pulse of
              hip-hop, trap and R&amp;B, recorded live and never sampled from a
              library.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button href="/about" variant="secondary">
                Full story
              </Button>
              <Button href="/#booking" variant="ghost">
                Work with Yanchan
              </Button>
            </div>
          </div>
        </div>
      </Section>

      {/* MUSIC: LATEST RELEASE */}
      <Section
        id="music"
        className="relative overflow-hidden border-t border-white/10 bg-coal"
      >
        <div className="mb-12 flex flex-wrap items-end justify-between gap-6">
          <SectionHeading
            eyebrow="Discography · New"
            title={
              <>
                Press <span className="text-amber">play.</span>
              </>
            }
            intro="Records that bridge the mridangam and the 808. Every drum is performed live, never pulled from a library."
          />
          <Button href="/music" variant="secondary" className="shrink-0">
            All music &amp; videos <ArrowRight size={16} />
          </Button>
        </div>
        <FeaturedReleases />
      </Section>

      {/* ORANGE ROOM SESSIONS */}
      <Section className="relative overflow-hidden border-t border-white/10">
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-[10%] -top-24 bottom-0 -z-10 bg-[radial-gradient(50%_50%_at_70%_30%,rgba(245,136,4,0.18),transparent_70%),radial-gradient(40%_40%_at_15%_80%,rgba(126,43,12,0.3),transparent_70%)]"
        />
        <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
          <SectionHeading
            eyebrow="The Series"
            title={
              <>
                Orange Room <span className="text-amber">Sessions.</span>
              </>
            }
            intro="One room, one guest, one take. Artists Yanchan rates come through and build something live under the அருள் neon. Tap a session to watch it here."
          />
        </div>
        <OrangeRoomSessions />
      </Section>

      {/* MERCH TEASER */}
      <Section className="defer-paint border-t border-white/10">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
          <SectionHeading
            eyebrow="Merch · Scarborough × South India"
            title={
              <>
                Wear the <span className="text-amber">sound.</span>
              </>
            }
            intro="The tour drop: one heavyweight hoodie, two long sleeves and two bandanas, built around the mridangam emblem. When a run is claimed the piece does not sell out, it stays buyable as a pre-order."
          />
          <Button href="/store" variant="secondary" className="shrink-0">
            Shop all merch <ArrowRight size={16} />
          </Button>
        </div>
        <Stagger className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4 md:gap-x-6">
          {MERCH.slice(0, 4).map((m) => (
            <StaggerItem key={m.id}>
              <Link
                href={`/store/${m.id}`}
                className="block rounded-[2px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber"
              >
                <ProductPlate sku={m} sizes="(min-width:768px) 22vw, 44vw" />
                <div className="mt-3 flex items-baseline justify-between gap-3">
                  <span className="font-head text-sm font-bold text-cream">
                    {m.name}
                  </span>
                  <span className="shrink-0 font-display text-lg text-cream">
                    {formatCad(m.priceCad)}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[0.58rem] uppercase tracking-[0.2em] text-warmgray">
                  {m.colourway}
                </p>
              </Link>
            </StaggerItem>
          ))}
        </Stagger>
      </Section>

      {/* YOUTUBE */}
      <Section className="defer-paint border-t border-white/10 bg-coal">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
          <SectionHeading
            eyebrow="Watch"
            title={
              <>
                On <span className="text-amber">camera.</span>
              </>
            }
            intro="Mrithangam Raps, official audio and live sessions. Pick one and it plays right here."
          />
          <Button
            href={YOUTUBE_CHANNEL}
            external
            variant="secondary"
            className="shrink-0"
          >
            The channel <ArrowUpRight size={16} />
          </Button>
        </div>
        <VideoGallery />
      </Section>

      {/* LIVE ON KICK */}
      <LiveStream />

      {/* CO-SIGNS */}
      <Section className="defer-paint border-t border-white/10">
        <Reveal>
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 flex justify-center gap-1 text-amber">
              {[0, 1, 2, 3, 4].map((i) => (
                <Star key={i} size={20} fill="currentColor" />
              ))}
            </div>
            <p className="font-display text-[clamp(1.5rem,4vw,2.8rem)] uppercase leading-tight text-cream">
              &ldquo;In order for things to grow, you have to{" "}
              <span className="text-amber">innovate.</span>&rdquo;
            </p>
            <p className="mt-6 font-mono text-xs uppercase tracking-[0.25em] text-warmgray">
              Lil Durk · Russ · Hanumankind · Shruti Haasan · Jonita Gandhi ·
              Pressa · SVDP · Santosh Narayanan
            </p>
          </div>
        </Reveal>
      </Section>

      {/* BOOKING */}
      <Section id="booking" className="border-t border-white/10 bg-coal">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <SectionHeading
              eyebrow="Work With Yanchan"
              title={
                <>
                  Let&apos;s build
                  <br />
                  something <span className="text-amber">real.</span>
                </>
              }
              intro="Custom beats, features, mixing, mridangam sessions and live bookings. Tell me what you're making and I reply personally."
            />
            <div className="mt-8 space-y-3 font-mono text-sm text-warmgray">
              <p>partnerships@yanchanproduced.com</p>
              <p>Emtee Music Group · Toronto, ON</p>
            </div>
          </div>
          <BookingForm />
        </div>
      </Section>

      {/* FAQ */}
      <Section className="defer-paint border-t border-white/10">
        <SectionHeading eyebrow="FAQ" title="Good to know" className="mb-10" />
        <div className="grid gap-x-12 gap-y-8 md:grid-cols-2">
          {FAQ.map((f) => (
            <Reveal key={f.q}>
              <h3 className="font-head text-lg font-bold text-cream">{f.q}</h3>
              <p className="mt-2 leading-relaxed text-warmgray">{f.a}</p>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* FINAL CTA */}
      <Section className="border-t border-white/10 bg-gradient-to-b from-coal to-black text-center">
        <Reveal>
          <Eyebrow className="mb-6 justify-center">
            Down for more? I got you.
          </Eyebrow>
          <h2 className="mx-auto max-w-3xl font-display text-[clamp(2.5rem,8vw,6rem)] uppercase leading-[0.9] text-cream">
            Scarborough <span className="text-amber">to the world</span>
          </h2>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button href="/music">Hear the catalogue</Button>
            <Button href="/store" variant="ghost">
              Shop the store
            </Button>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
