"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";

const releases = [
  {
    src: "/legacy/releases/anjuliemusic_abstract_heart_ethereal_oil_painting_warm_colors_574f5995-d3f6-4780-94d5-fabe392cca87.png",
    title: "Abstract Heart",
  },
  {
    src: "/legacy/releases/Brown-Vintage-Minimalist-Music-Album-Cover-3-1-1024x1024.png",
    title: "Vintage Minimalist",
  },
  {
    src: "/legacy/releases/artworks-YYsBWyFy2uBq-0-t500x500.jpg",
    title: "Artwork YYsBWyFy2uBq",
  },
  {
    src: "/legacy/releases/spotifydown-com-Chai-and-Sunshine-mp3-image.jpg",
    title: "Chai and Sunshine",
  },
  {
    src: "/legacy/releases/artworks-TYlB41cABBrqKEbB-NESP9g-t500x500.jpg",
    title: "Artwork TYlB41cABBrqKEbB",
  },
  { src: "/legacy/releases/image-9.png", title: "Image 9" },
  { src: "/legacy/releases/remember-1024x1024.png", title: "Remember" },
  { src: "/legacy/releases/img_2.png", title: "Image 2" },
  { src: "/legacy/releases/Inimel.jpg", title: "Inimel" },
];

export function LatestReleaseSection() {
  const [index, setIndex] = useState(4);

  const prev = () => setIndex((i) => (i === 0 ? releases.length - 1 : i - 1));
  const next = () => setIndex((i) => (i === releases.length - 1 ? 0 : i + 1));

  return (
    <section
      id="music"
      className="relative overflow-hidden bg-[rgb(19,27,14)] py-16 md:py-24"
      style={{
        backgroundImage: "url('/legacy/backgrounds/Background-scaled.jpg')",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative z-10 legacy-container">
        <div className="mb-10 flex items-center justify-between">
          <h2 className="font-serif text-[clamp(1.75rem,4vw,3rem)] font-normal uppercase tracking-tight text-[rgb(255,145,77)]">
            Latest Release
          </h2>
          <Link
            href="https://open.spotify.com/artist/4GKSZvPRVHCR8TrVVWu9HH"
            target="_blank"
            rel="noopener noreferrer"
            className="legacy-btn"
          >
            Explore More
          </Link>
        </div>

        <div className="relative flex items-center justify-center py-8">
          <button
            onClick={prev}
            className="absolute left-0 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-[rgb(255,145,77)] md:left-4"
            aria-label="Previous release"
          >
            <ChevronLeft size={24} />
          </button>

          <div className="relative flex items-center justify-center gap-4 md:gap-6">
            {[-2, -1, 0, 1, 2].map((offset) => {
              const i = (index + offset + releases.length) % releases.length;
              const isCenter = offset === 0;
              return (
                <div
                  key={`${i}-${offset}`}
                  className={`relative transition-all duration-300 ${
                    Math.abs(offset) === 2
                      ? "hidden h-40 w-40 opacity-40 md:block"
                      : Math.abs(offset) === 1
                        ? "h-48 w-48 opacity-70 md:h-56 md:w-56"
                        : "h-56 w-56 md:h-80 md:w-80"
                  }`}
                >
                  <Image
                    src={releases[i].src}
                    alt={releases[i].title}
                    fill
                    className="object-cover shadow-2xl"
                  />
                  {isCenter && (
                    <button className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors hover:bg-black/30">
                      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm md:h-20 md:w-20">
                        <Play className="ml-1 h-8 w-8 fill-white text-white md:h-10 md:w-10" />
                      </div>
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <button
            onClick={next}
            className="absolute right-0 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-[rgb(255,145,77)] md:right-4"
            aria-label="Next release"
          >
            <ChevronRight size={24} />
          </button>
        </div>
      </div>
    </section>
  );
}
