import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";
import { DiscographyGrid } from "@/components/discography-grid";
import { VideoGallery } from "@/components/video-gallery";
import { Reveal } from "@/components/reveal";
import { Button, Eyebrow, Section, SectionHeading } from "@/components/ui";
import { RELEASES, SOCIALS, YOUTUBE_CHANNEL } from "@/lib/content";

export const metadata: Metadata = {
  title: "Music & Videos",
  description:
    "Stream the latest Yanchan Produced releases and watch the Mrithangam Raps series, official audio and live sessions.",
  alternates: { canonical: "/music" },
};

const PLATFORMS = ["Spotify", "YouTube", "Instagram", "TikTok"] as const;

export default function MusicPage() {
  const years = RELEASES.map((r) => Number(r.year)).filter(Boolean);
  const span = `${Math.min(...years)} to ${Math.max(...years)}`;

  return (
    <>
      {/* ── HERO ─────────────────────────────────────────── */}
      <Section className="relative overflow-hidden !pt-28 sm:!pt-32">
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-[10%] -top-40 bottom-0 -z-10 bg-[radial-gradient(50%_45%_at_30%_25%,rgba(245,136,4,0.16),transparent_70%),radial-gradient(40%_40%_at_85%_70%,rgba(126,43,12,0.32),transparent_70%)]"
        />
        <SectionHeading
          as="h1"
          eyebrow="Discography"
          title={
            <>
              The <span className="text-amber">music</span>
            </>
          }
          intro="Records that bridge the mridangam and the 808. Every drum performed live, never pulled from a library. Tap any cover to open it."
        />

        <Reveal delay={0.1} className="mt-9 flex flex-wrap items-center gap-2">
          {PLATFORMS.map((name) => {
            const s = SOCIALS.find((x) => x.label === name);
            if (!s) return null;
            return (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-cream/20 px-5 py-2 font-head text-[0.7rem] font-bold uppercase tracking-[0.12em] text-cream/80 transition-colors hover:border-amber hover:text-amber"
              >
                {s.label}
                <ArrowUpRight size={13} />
              </a>
            );
          })}
        </Reveal>
      </Section>

      {/* ── DISCOGRAPHY ──────────────────────────────────── */}
      <Section className="!pt-6">
        <div className="mb-8 flex items-center gap-4">
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.3em] lg:text-[0.6rem] text-warmgray">
            {RELEASES.length} releases · {span}
          </span>
          <span className="h-px flex-1 bg-white/10" />
        </div>
        <DiscographyGrid />
      </Section>

      {/* ── VIDEOS ───────────────────────────────────────── */}
      <Section className="relative overflow-hidden border-t border-white/10 bg-coal">
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

      {/* ── CTA ──────────────────────────────────────────── */}
      <Section className="border-t border-white/10 bg-gradient-to-b from-black to-coal text-center">
        <Reveal>
          <Eyebrow className="mb-6 justify-center">Heard something?</Eyebrow>
          <h2 className="mx-auto max-w-3xl font-display text-[clamp(2rem,6vw,4.5rem)] uppercase leading-[0.92] text-cream">
            Let&apos;s put that sound{" "}
            <span className="text-amber">on your record.</span>
          </h2>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button href="/#booking">Work with Yanchan</Button>
            <Button href="/store" variant="ghost">
              Shop the merch
            </Button>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
