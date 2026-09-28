import type { Metadata } from "next";
import Image from "next/image";
import { Reveal } from "@/components/reveal";
import { Button, Eyebrow, Section, SectionHeading } from "@/components/ui";

export const metadata: Metadata = {
  title: "About",
  description:
    "Yanchan Rajmohan: Canadian-Tamil producer, mixing engineer, singer and professional Mridangam player from Scarborough. The story behind the bridge.",
  alternates: { canonical: "/about" },
};

const TIMELINE = [
  {
    year: "Age 8",
    text: "Youngest in Canada to perform a Mridangam Arangetram.",
  },
  {
    year: "2020",
    text: "Launches the viral “Mrithangam Raps” series with SVDP.",
  },
  {
    year: "2024",
    text: "First artist of Eelam origin to perform at an NBA game.",
  },
  {
    year: "2025",
    text: "Coke Studio Tamil release + “Chai & Sunshine” with Anjulie.",
  },
];

const PILLARS = [
  { t: "Heritage", d: "Tamil roots, Carnatic discipline, Eelam pride." },
  { t: "Innovation", d: "Genre-bending fusion. Lean into the fear." },
  { t: "Hustle", d: "Scarborough grind. Self-made. Community first." },
  { t: "Heart", d: "Heart, Passion, Certainty: the life philosophy." },
];

export default function AboutPage() {
  return (
    <>
      <Section className="!pt-28 sm:!pt-32">
        <div className="grid items-end gap-10 lg:grid-cols-2">
          <div>
            <Eyebrow className="mb-5">The Story</Eyebrow>
            <h1 className="font-display text-[clamp(3rem,10vw,7rem)] uppercase leading-[0.85] text-cream">
              Scarborough
              <br />
              <span className="text-amber">raised.</span>
            </h1>
            <p className="mt-6 max-w-md leading-relaxed text-warmgray">
              Yanchan uses his legal first name as his stage name. No alter ego.
              Authenticity is non-negotiable, and the music is a love letter to
              the city that made him.
            </p>
          </div>
          <Reveal className="relative aspect-[4/5] overflow-hidden">
            <Image
              src="/assets/Yanchan-and-Sandeep.jpg"
              alt="Yanchan"
              fill
              sizes="(max-width:1024px) 100vw, 600px"
              className="object-cover"
            />
          </Reveal>
        </div>
      </Section>

      <Section className="border-t border-white/10 bg-coal">
        <SectionHeading
          eyebrow="What drives it"
          title="Four pillars"
          className="mb-10"
        />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map((p) => (
            <Reveal key={p.t} className="border border-white/8 bg-charcoal p-6">
              <p className="font-display text-2xl uppercase text-amber">
                {p.t}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-warmgray">
                {p.d}
              </p>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section className="border-t border-white/10">
        <SectionHeading
          eyebrow="Milestones"
          title="The road"
          className="mb-10"
        />
        <div className="space-y-px">
          {TIMELINE.map((m) => (
            <Reveal
              key={m.year}
              className="flex flex-col gap-2 border-t border-white/10 py-6 sm:flex-row sm:items-baseline sm:gap-10"
            >
              <span className="w-28 shrink-0 font-mono text-sm uppercase tracking-wider text-amber">
                {m.year}
              </span>
              <span className="font-head text-lg text-cream sm:text-xl">
                {m.text}
              </span>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section className="border-t border-white/10 bg-gradient-to-b from-coal to-black text-center">
        <Reveal>
          <h2 className="mx-auto max-w-2xl font-display text-[clamp(2rem,6vw,4rem)] uppercase leading-[0.95] text-cream">
            Let&apos;s make something{" "}
            <span className="text-amber">that lasts.</span>
          </h2>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button href="/#booking">Work with Yanchan</Button>
            <Button href="/music" variant="ghost">
              Hear the music
            </Button>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
