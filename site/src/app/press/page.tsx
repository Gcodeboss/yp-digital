import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { PRESS_ARTICLES, PRESS, formatDate } from "@/lib/content";
import { Section, Button } from "@/components/ui";

export const metadata: Metadata = {
  title: "Press & Features",
  description:
    "Yanchan Produced in the press: features, interviews and profiles from Rolling Stone India, Complex, GQ India, Vogue India, CBC and more.",
  alternates: { canonical: "/press" },
};

export default function PressPage() {
  const featured = PRESS_ARTICLES.find((a) => a.featured) ?? PRESS_ARTICLES[0];
  const rest = PRESS_ARTICLES.filter((a) => a.slug !== featured.slug);

  return (
    <>
      {/* MASTHEAD */}
      <Section className="!pb-8 !pt-28 sm:!pt-32">
        <div className="border-b border-white/15 pb-8">
          <span className="inline-flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.3em] text-amber">
            <span className="h-px w-8 bg-amber" />
            The Press Room
          </span>
          <h1 className="mt-5 font-display text-[clamp(2.8rem,9vw,7rem)] uppercase leading-[0.85] text-cream">
            Press &amp; <span className="text-amber">Features</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-warmgray sm:text-lg">
            From a six-year-old mridangam prodigy to a global hip-hop producer,
            the writing, the interviews and the profiles documenting how Yanchan
            built a bridge between South India and the 416.
          </p>
        </div>

        {/* OUTLET LINE */}
        <div className="flex flex-wrap items-center gap-x-7 gap-y-3 py-6">
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-warmgray">
            As featured in
          </span>
          {PRESS.map((p) => (
            <span
              key={p}
              className="font-head text-sm font-bold uppercase tracking-[0.08em] text-cream/55"
            >
              {p}
            </span>
          ))}
        </div>
      </Section>

      {/* FEATURED LEAD STORY */}
      <Section className="!py-0">
        <Link
          href={`/press/${featured.slug}`}
          className="group grid items-stretch gap-8 border-y border-white/10 py-8 lg:grid-cols-[1.15fr_1fr] lg:gap-12"
        >
          <div className="relative aspect-[16/11] overflow-hidden bg-coal">
            <Image
              src={featured.image}
              alt={featured.title}
              fill
              priority
              sizes="(max-width:1024px) 100vw, 720px"
              className="object-contain transition-transform duration-700 group-hover:scale-[1.03]"
            />
            <span className="absolute left-4 top-4 bg-amber px-2.5 py-1 font-mono text-[0.6rem] font-bold uppercase tracking-[0.15em] text-void">
              Lead Story
            </span>
          </div>
          <div className="flex flex-col justify-center">
            <div className="flex items-center gap-3 font-mono text-[0.7rem] uppercase tracking-[0.2em] text-amber">
              <span>{featured.outlet}</span>
              <span className="text-warmgray">/ {featured.category}</span>
            </div>
            <h2 className="mt-4 font-display text-[clamp(1.8rem,4vw,3.2rem)] uppercase leading-[0.95] text-cream transition-colors group-hover:text-amber">
              {featured.title}
            </h2>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-warmgray sm:text-lg">
              {featured.deck}
            </p>
            <div className="mt-6 flex items-center gap-4 font-mono text-[0.7rem] uppercase tracking-[0.15em] text-warmgray">
              <span>{formatDate(featured.date)}</span>
              <span className="h-1 w-1 rounded-full bg-warmgray" />
              <span>{featured.readMins} min read</span>
              <span className="ml-auto inline-flex items-center gap-1 text-amber">
                Read <ArrowUpRight size={14} />
              </span>
            </div>
          </div>
        </Link>
      </Section>

      {/* ARCHIVE GRID */}
      <Section className="!pt-12">
        <div className="mb-8 flex items-baseline justify-between border-b border-white/10 pb-4">
          <h2 className="font-head text-sm font-bold uppercase tracking-[0.2em] text-cream">
            Latest Coverage
          </h2>
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-warmgray">
            {rest.length} stories
          </span>
        </div>

        <div className="grid gap-x-7 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((a) => (
            <Link
              key={a.slug}
              href={`/press/${a.slug}`}
              className="group flex flex-col"
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-coal">
                <Image
                  src={a.image}
                  alt={a.title}
                  fill
                  sizes="(max-width:640px) 100vw, (max-width:1024px) 50vw, 400px"
                  className="object-contain transition-transform duration-700 group-hover:scale-[1.04]"
                />
              </div>
              <div className="mt-4 flex items-center gap-2.5 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-amber">
                <span>{a.outlet}</span>
                <span className="text-warmgray">/ {a.category}</span>
              </div>
              <h3 className="mt-2.5 font-display text-[1.6rem] uppercase leading-[0.98] text-cream transition-colors group-hover:text-amber">
                {a.title}
              </h3>
              <p className="mt-2.5 line-clamp-3 flex-1 text-sm leading-relaxed text-warmgray">
                {a.deck}
              </p>
              <div className="mt-4 flex items-center gap-3 font-mono text-[0.65rem] uppercase tracking-[0.15em] text-warmgray">
                <span>{formatDate(a.date)}</span>
                <span className="h-1 w-1 rounded-full bg-warmgray" />
                <span>{a.readMins} min</span>
              </div>
            </Link>
          ))}
        </div>
      </Section>

      {/* PRESS CONTACT */}
      <Section className="border-t border-white/10 bg-coal">
        <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <div>
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.25em] text-amber">
              Press &amp; Media
            </span>
            <h2 className="mt-3 font-display text-[clamp(1.8rem,4vw,3rem)] uppercase leading-[0.95] text-cream">
              Writing about Yanchan?
            </h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-warmgray">
              For interviews, assets and the full EPK, reach the team directly.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Button href="mailto:yanchan@emteemusicgroup.com" external>
              Request press kit
            </Button>
            <Button href="/#booking" variant="ghost">
              Booking &amp; partnerships
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}
