import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Reveal } from "@/components/reveal";
import { TourBoard } from "@/components/tour-board";
import { Button, Eyebrow, Section, SectionHeading } from "@/components/ui";
import { EventJsonLd } from "@/components/structured-data";
import { TOUR } from "@/lib/content";
import { TOUR_PUBLIC } from "@/lib/flags";

export const metadata: Metadata = {
  title: "Tour",
  description:
    "Catch Yanchan Produced live: the 2026 run through Toronto, New York, Vancouver and San Francisco.",
  alternates: { canonical: "/tour" },
  // Hidden pages must not invite crawling, even though the redirect below means
  // this metadata is not normally served.
  robots: TOUR_PUBLIC ? undefined : { index: false, follow: false },
};

export default function TourPage() {
  /* Hidden, not deleted — see TOUR_PUBLIC in src/lib/flags.ts. A temporary
     redirect keeps the URL alive and tells crawlers nothing permanent. */
  if (!TOUR_PUBLIC) redirect("/");

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = TOUR.filter((t) => t.date >= today);

  /* Only future dates, and only the ones with a real ticket link. */
  const eventsForSearch = upcoming.map((t) => ({
    date: t.date,
    city: t.city,
    venue: t.venue,
    url: t.ticketUrl && t.ticketUrl !== "#" ? t.ticketUrl : undefined,
  }));
  const past = TOUR.filter((t) => t.date < today);

  return (
    <>
      <EventJsonLd events={eventsForSearch} />
    <>
      <Section className="relative overflow-hidden !pb-12 !pt-28 sm:!pt-32">
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-[10%] -top-40 bottom-0 -z-10 bg-[radial-gradient(50%_45%_at_25%_30%,rgba(245,136,4,0.16),transparent_70%),radial-gradient(40%_40%_at_88%_75%,rgba(126,43,12,0.32),transparent_70%)]"
        />
        <SectionHeading
          as="h1"
          eyebrow="Live"
          title={
            <>
              On <span className="text-amber">tour</span>
            </>
          }
          intro="Mridangam under the stage lights, crowd in full voice. Hover a date to see the room, tap it for tickets."
        />
      </Section>

      {upcoming.length === 0 ? (
        <Section className="!pt-0">
          <div className="border border-white/10 p-12 text-center">
            <p className="font-display text-2xl uppercase text-cream">
              No dates announced
            </p>
            <p className="mt-2 text-warmgray">
              Want Yanchan in your city? Send a booking inquiry.
            </p>
            <Button href="/#booking" variant="secondary" className="mt-6">
              Booking inquiry
            </Button>
          </div>
        </Section>
      ) : (
        <TourBoard dates={upcoming} />
      )}

      {past.length > 0 && (
        <Section>
          <div className="mb-6 flex items-center gap-4">
            <span className="font-mono text-[0.65rem] uppercase tracking-[0.3em] lg:text-[0.6rem] text-warmgray">
              Played
            </span>
            <span className="h-px flex-1 bg-white/10" />
          </div>
          <ul className="divide-y divide-white/8 border-y border-white/8">
            {past.map((t) => (
              <li
                key={t.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 py-3.5 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_auto]"
              >
                <span className="truncate font-head text-sm font-bold uppercase text-cream/50">
                  {t.city}
                </span>
                <span className="hidden truncate font-mono text-[0.65rem] uppercase tracking-[0.16em] text-warmgray md:block">
                  {t.venue}
                </span>
                <span className="font-mono text-[0.65rem] tracking-[0.16em] text-warmgray">
                  {t.date.slice(0, 4)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section className="border-t border-white/10 bg-gradient-to-b from-black to-coal text-center">
        <Reveal>
          <Eyebrow className="mb-6 justify-center">Not on the list?</Eyebrow>
          <h2 className="mx-auto max-w-3xl font-display text-[clamp(2rem,6vw,4.5rem)] uppercase leading-[0.92] text-cream">
            Bring the mridangam{" "}
            <span className="text-amber">to your city.</span>
          </h2>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button href="/#booking">Booking inquiry</Button>
            <Button href="/music" variant="ghost">
              Hear the live sound
            </Button>
          </div>
        </Reveal>
      </Section>
    </>
    </>
  );
}
