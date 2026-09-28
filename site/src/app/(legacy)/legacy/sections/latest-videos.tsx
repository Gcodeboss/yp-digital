"use client";

import Link from "next/link";

const videos = [
  {
    id: "SePmCgtpw6s",
    title: "Inimel by Shruti and Kamal Haasan",
  },
  {
    id: "IIat8oxEIbE",
    title: "Russ - The Wind",
  },
  {
    id: "941Di9fGPHo",
    title:
      "Coke Studio Tamil | Nammaaley | Yanchan Produced x Asal Kolaar x Girishh Gopalkrishnan",
  },
  {
    id: "ehQFhlZHWw0",
    title: "Yanchan Produced LIVE x Toronto | Recap",
  },
];

export function LatestVideosSection() {
  return (
    <section
      id="videos"
      className="relative bg-[rgb(19,27,14)] py-16 md:py-24"
      style={{
        backgroundImage: "url('/legacy/backgrounds/Latest-Music-Videos.jpg')",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative z-10 legacy-container">
        <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-serif text-[clamp(1.75rem,4vw,3rem)] font-normal uppercase tracking-tight text-[rgb(255,145,77)]">
            Latest Videos
          </h2>
          <Link
            href="https://www.youtube.com/c/yanchanproduced"
            target="_blank"
            rel="noopener noreferrer"
            className="legacy-btn w-fit"
          >
            Explore More
          </Link>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {videos.map((video) => (
            <div key={video.id} className="group">
              <div className="legacy-video-embed mb-4 overflow-hidden rounded-sm shadow-lg">
                <iframe
                  src={`https://www.youtube.com/embed/${video.id}?controls=0&rel=0&playsinline=0&modestbranding=0`}
                  title={video.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  loading="lazy"
                />
              </div>
              <h3 className="font-serif text-lg font-normal text-white transition-colors group-hover:text-[rgb(255,145,77)] md:text-xl">
                {video.title}
              </h3>
            </div>
          ))}
        </div>

        <h2 className="mt-16 font-serif text-[clamp(1.5rem,3vw,2.5rem)] font-normal uppercase tracking-tight text-[rgb(255,145,77)] md:mt-20">
          Latest Music Videos
        </h2>
      </div>
    </section>
  );
}
