"use client";

import Image from "next/image";

const logos = [
  { src: "/legacy/logos/Group-99.png", alt: "COMPLEX" },
  { src: "/legacy/logos/Group-13.png", alt: "GO" },
  { src: "/legacy/logos/Group-97.png", alt: "The Times of India" },
  { src: "/legacy/logos/Group-96.png", alt: "Hindustan Times" },
  { src: "/legacy/logos/Group-95.png", alt: "blogTO" },
  { src: "/legacy/logos/Group-94-1.png", alt: "Gent's Post" },
  { src: "/legacy/logos/Group-102.png", alt: "CBC" },
  { src: "/legacy/logos/Group-101.png", alt: "Rolling Stone" },
  { src: "/legacy/logos/Group-100.png", alt: "The Guardian" },
];

export function AsSeenOnSection() {
  return (
    <section className="bg-[rgb(19,27,14)] py-16 md:py-20">
      <div className="legacy-container">
        <h2 className="mb-10 text-center font-serif text-sm font-normal uppercase tracking-[0.2em] text-white/70 md:mb-12">
          AS SEEN ON
        </h2>
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-8 md:gap-x-14 lg:gap-x-20">
          {logos.map((logo) => (
            <div
              key={logo.alt}
              className="relative h-8 w-auto opacity-70 grayscale transition-opacity hover:opacity-100 md:h-10"
            >
              <Image
                src={logo.src}
                alt={logo.alt}
                height={40}
                width={140}
                className="h-full w-auto object-contain"
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
