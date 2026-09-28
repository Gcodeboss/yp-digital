"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { ArrowDown, Play } from "lucide-react";
import { Marquee } from "./marquee";

export function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], [0, 160]);
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1.15]);
  const fade = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  return (
    <section
      ref={ref}
      className="relative flex min-h-dvh flex-col justify-end overflow-hidden"
    >
      <motion.div style={{ scale }} className="absolute inset-0 isolate">
        <Image
          src="/assets/hero-artist.jpg"
          alt="Yanchan Produced"
          fill
          priority
          sizes="100vw"
          className="object-cover object-[center_15%] grayscale contrast-125 brightness-110 sm:object-[center_20%]"
        />
        {/* Red duotone tint to match brand aesthetic */}
        <div className="absolute inset-0 bg-[#9e1f0c] mix-blend-color" />
        <div className="absolute inset-0 bg-[#5a160a] opacity-45 mix-blend-multiply" />
        <div className="absolute inset-0 bg-[#f58804] opacity-20 mix-blend-overlay" />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/55 to-black/30" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/45 to-transparent" />
      </motion.div>

      <motion.div
        style={{ y, opacity: fade }}
        className="relative z-10 mx-auto w-full max-w-[1320px] px-5 pb-10 pt-28 sm:px-8 sm:pb-16"
      >
        <motion.span
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, ease: [0.16, 1, 0.3, 1], duration: 0.8 }}
          className="mb-5 inline-flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.3em] text-amber"
        >
          <span className="h-px w-8 bg-amber" />
          Producer · Mridangam · Scarborough
        </motion.span>

        <h1 className="font-display uppercase leading-[0.82] text-cream text-shadow-media">
          <motion.span
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, ease: [0.16, 1, 0.3, 1], duration: 0.9 }}
            className="block text-[clamp(3.2rem,14vw,10rem)]"
          >
            Yanchan
          </motion.span>
          <motion.span
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.42, ease: [0.16, 1, 0.3, 1], duration: 0.9 }}
            className="block pl-[8vw] text-[clamp(3.2rem,14vw,10rem)] text-amber"
          >
            Produced
          </motion.span>
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, ease: [0.16, 1, 0.3, 1], duration: 0.8 }}
          className="mt-6 max-w-md text-base leading-relaxed text-cream/85 sm:text-lg"
        >
          Where the mridangam meets the 808. Records, live sessions and merch
          that bridge South Indian tradition with North American hip-hop.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.72, ease: [0.16, 1, 0.3, 1], duration: 0.8 }}
          className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center"
        >
          <Link
            href="/music"
            className="inline-flex items-center justify-center gap-2 rounded-[4px] bg-amber px-8 py-4 font-head text-sm font-bold uppercase tracking-[0.1em] text-void transition-all hover:scale-[1.03] hover:bg-sienna"
          >
            <Play size={16} /> Listen Now
          </Link>
          <Link
            href="/store"
            className="inline-flex items-center justify-center gap-2 rounded-[4px] border border-cream/30 px-8 py-4 font-head text-sm font-bold uppercase tracking-[0.1em] text-cream transition-all hover:border-cream hover:bg-cream/5"
          >
            Shop the merch
          </Link>
        </motion.div>
      </motion.div>

      <div className="relative z-10 border-y border-white/10 bg-black/60 py-3 lg:bg-black/40 lg:backdrop-blur-sm">
        <Marquee
          text="Mrithangam Raps · 12M+ Streams · Coke Studio · NBA · Love Island UK · Scarborough · "
          duration={40}
          className="opacity-30"
        />
      </div>

      <motion.div
        style={{ opacity: fade }}
        className="pointer-events-none absolute bottom-24 right-6 z-10 hidden text-warmgray sm:block"
      >
        <ArrowDown className="animate-bounce" size={22} />
      </motion.div>
    </section>
  );
}
