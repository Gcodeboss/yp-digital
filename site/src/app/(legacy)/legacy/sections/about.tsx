"use client";

import Image from "next/image";

export function AboutSection() {
  return (
    <section id="about" className="relative overflow-hidden bg-[rgb(19,27,14)]">
      <div className="grid min-h-[600px] md:grid-cols-2">
        {/* Left image */}
        <div className="relative h-[400px] md:h-auto">
          <Image
            src="/legacy/images/Rectangle-35.jpg"
            alt="Yanchan Produced"
            fill
            className="object-cover object-top"
            sizes="(max-width: 768px) 100vw, 50vw"
          />
        </div>

        {/* Right orange panel */}
        <div className="relative flex items-center bg-[rgb(255,145,77)] px-8 py-16 md:px-16 lg:px-20">
          {/* Decorative curve to blend with left image */}
          <div className="absolute left-0 top-0 hidden h-full w-24 -translate-x-1/2 rounded-full bg-[rgb(255,145,77)] md:block" />

          <div className="relative z-10 max-w-xl">
            <h2
              className="mb-6 font-legacy-display text-[clamp(2.5rem,5vw,4.5rem)] font-normal leading-[1.05] text-white"
              style={{ fontFamily: "'Cehua Free', serif" }}
            >
              Making Beats With
              <br />A South Asian Twist
            </h2>
            <div className="space-y-4 font-sans text-base leading-relaxed text-white/95 md:text-lg">
              <p>
                Yanchan Produced is a Canadian-Tamil producer, mixing engineer,
                songwriter and Mridangist. Known for making beats with a South
                Asian twist, his release of solo and collaborative projects has
                garnered over 12 million streams on Spotify.
              </p>
              <p>
                Yanchan&apos;s production has been affiliated with reputable
                labels and high-level artists over the years including
                collaborators Russ, SVDP, Shruthi Hassan, Pressa, Kristina
                Maria, Yung Tory, and Charle$.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
