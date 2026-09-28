"use client";

import Image from "next/image";
import Link from "next/link";

const pressItems = [
  {
    image: "/legacy/press/bringing-worlds-together.jpg",
    logo: "/legacy/logos/Group-100.png",
    title:
      "Bringing Worlds Together - Yanchan Produced takes Tamil music to the NBA and beyond",
    href: "https://yanchanproduced.com/press/",
  },
  {
    image: "/legacy/press/Im-in-this-city.jpg",
    logo: "/legacy/logos/Group-97.png",
    title: "I'm in this city because of my love for music: Yanchan",
    href: "https://yanchanproduced.com/press/",
  },
  {
    image: "/legacy/press/Yanchan-on-opening.jpg",
    logo: "/legacy/logos/Group-96.png",
    title: "Yanchan on opening for 50 Cent: Performed an hour-long set",
    href: "https://yanchanproduced.com/press/",
  },
  {
    image: "/legacy/press/Big-City.jpg",
    logo: "/legacy/logos/cbc-logo.png",
    title: "Scarborough-based producer Yanchan about his new project.",
    href: "https://yanchanproduced.com/press/",
  },
  {
    image: "/legacy/press/Yanchan-and-Sandeep.jpg",
    logo: "/legacy/logos/Group-101.png",
    title:
      "Yanchan and Sandeep Narayan's Album 'Arul' Wants to Make Carnatic Music",
    href: "https://yanchanproduced.com/press/",
  },
  {
    image: "/legacy/press/Yanchan-Produced.jpg",
    logo: "/legacy/logos/Group-94-1.png",
    title:
      "Yanchan Produced: What a Night In Jail Taught Me; Growing Up Tamil in Canada",
    href: "https://yanchanproduced.com/press/",
  },
];

export function PressSection() {
  return (
    <section className="bg-[rgb(19,27,14)] py-16 md:py-24">
      <div className="legacy-container">
        <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="font-serif text-[clamp(1.75rem,4vw,3rem)] font-normal uppercase leading-[1.1] text-[rgb(255,145,77)]">
            Explore Our
            <br />
            Featured Press
          </h2>
          <Link
            href="https://yanchanproduced.com/press/"
            target="_blank"
            rel="noopener noreferrer"
            className="legacy-btn w-fit"
          >
            View All Press
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {pressItems.map((item) => (
            <Link
              key={item.title}
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group block"
            >
              <div className="relative aspect-[3/4] overflow-hidden">
                <Image
                  src={item.image}
                  alt={item.title}
                  fill
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-4">
                  <div className="mb-3 h-6 w-auto">
                    <Image
                      src={item.logo}
                      alt=""
                      height={24}
                      width={120}
                      className="h-full w-auto object-contain"
                    />
                  </div>
                  <h3 className="font-sans text-xs font-medium uppercase leading-snug text-white/90">
                    {item.title}
                  </h3>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
