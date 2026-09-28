"use client";

import Image from "next/image";
import { SocialIcons } from "./social-icons";

export function NewsletterSection() {
  return (
    <section
      className="relative bg-[rgb(19,27,14)] py-16 md:py-24"
      style={{
        backgroundImage: "url('/legacy/backgrounds/newslatter.jpg')",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative z-10 legacy-container">
        <div className="mb-10 flex justify-center">
          <SocialIcons />
        </div>

        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div className="relative aspect-video overflow-hidden md:aspect-[4/3]">
            <Image
              src="/legacy/images/merch-drop.jpg"
              alt="Yanchan in the studio"
              fill
              className="object-cover"
              sizes="(max-width: 1024px) 100vw, 50vw"
            />
          </div>

          <div>
            <h2 className="mb-4 font-serif text-[clamp(1.75rem,3vw,2.5rem)] font-normal uppercase tracking-tight text-white">
              DOWN FOR MORE? I GOT YOU.
            </h2>
            <p className="mb-8 font-sans text-base text-white/80">
              Stay in the Loop with Exclusive Content, Merch, Events, and More!
            </p>

            <form className="mb-4 flex flex-col gap-3 sm:flex-row">
              <input
                type="email"
                placeholder="Email Address*"
                required
                className="flex-1 border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/50 focus:border-[rgb(255,145,77)] focus:outline-none"
              />
              <input
                type="text"
                placeholder="Country*"
                required
                className="flex-1 border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/50 focus:border-[rgb(255,145,77)] focus:outline-none"
              />
              <button
                type="submit"
                className="bg-[rgb(255,145,77)] px-8 py-3 font-mono text-sm font-bold uppercase tracking-[0.1em] text-black transition-colors hover:bg-white"
              >
                Submit
              </button>
            </form>
            <p className="font-sans text-xs leading-relaxed text-white/60">
              By subscribing to Yanchan Produced, you are consenting to receive
              promotional Emails and Consent is not a condition of any purchase.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
