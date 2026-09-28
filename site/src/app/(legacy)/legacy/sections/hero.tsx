"use client";

import Image from "next/image";
import { SocialIcons } from "./social-icons";

export function HeroSection() {
  return (
    <section
      id="home"
      className="relative flex min-h-screen items-center justify-center overflow-hidden"
    >
      {/* Video background */}
      <div className="absolute inset-0 z-0">
        <iframe
          src="https://www.youtube.com/embed/SePmCgtpw6s?controls=0&rel=0&playsinline=1&enablejsapi=1&autoplay=1&mute=1&loop=1&playlist=SePmCgtpw6s"
          title="Yanchan Produced LIVE x Toronto | Recap"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="absolute left-1/2 top-1/2 h-[150%] w-[150%] -translate-x-1/2 -translate-y-1/2 object-cover"
        />
        <div className="absolute inset-0 bg-black/30" />
      </div>

      {/* Center logo */}
      <div className="relative z-10 px-4 text-center">
        <Image
          src="/legacy/logos/yanchan-559x246.png"
          alt="Yanchan Produced"
          width={559}
          height={246}
          className="mx-auto h-auto w-full max-w-[420px] md:max-w-[520px]"
          priority
        />
      </div>

      {/* Right social icons */}
      <div className="absolute right-6 top-1/2 z-10 hidden -translate-y-1/2 md:right-10 lg:block">
        <SocialIcons vertical />
      </div>
    </section>
  );
}
