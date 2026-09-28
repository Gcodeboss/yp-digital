"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Menu, ShoppingBag, X } from "lucide-react";
import { useStore } from "./store-provider";
import { TOUR_PUBLIC } from "@/lib/flags";

const NAV = [
  { label: "Music", href: "/music" },
  { label: "Store", href: "/store" },
  { label: "About", href: "/about" },
  ...(TOUR_PUBLIC ? [{ label: "Tour", href: "/tour" }] : []),
  { label: "Press", href: "/press" },
  { label: "Booking", href: "/#booking" },
];

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { count, setCartOpen } = useStore();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
  }, [open]);

  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-40 transition-all duration-500 ${
          scrolled
            ? "border-b border-white/10 bg-black/95 lg:bg-black/85 lg:backdrop-blur-xl"
            : "bg-gradient-to-b from-black/60 to-transparent"
        }`}
      >
        <div className="mx-auto flex max-w-[1320px] items-center justify-between px-5 py-3.5 sm:px-8">
          <Link
            href="/"
            className="group relative z-10"
            aria-label="Yanchan Produced, home"
          >
            <Image
              src="/brand/yanchan-logo-white.png"
              alt="Yanchan Produced"
              width={180}
              height={100}
              priority
              className="-my-1 h-12 w-auto transition-opacity group-hover:opacity-80 sm:-my-2 sm:h-14"
            />
          </Link>

          <nav className="hidden items-center gap-8 md:flex">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="group relative inline-flex min-h-11 items-center font-head text-xs font-bold uppercase tracking-[0.15em] text-cream/80 transition-colors hover:text-cream"
              >
                {n.label}
                <span className="absolute bottom-2 left-0 h-px w-0 bg-amber transition-all duration-300 group-hover:w-full" />
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCartOpen(true)}
              aria-label="Open cart"
              className="relative flex h-11 w-11 items-center justify-center text-cream transition-colors hover:text-amber"
            >
              <ShoppingBag size={20} />
              {count > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber px-1 font-mono text-[0.6rem] font-bold text-void">
                  {count}
                </span>
              )}
            </button>
            <Link
              href="/store"
              className="hidden rounded-[4px] bg-amber px-5 py-2.5 font-head text-xs font-bold uppercase tracking-[0.1em] text-void transition-all hover:scale-[1.03] hover:bg-sienna sm:inline-block"
            >
              Shop
            </Link>
            <button
              onClick={() => setOpen(true)}
              aria-label="Open menu"
              className="flex h-11 w-11 items-center justify-center text-cream md:hidden"
            >
              <Menu size={24} />
            </button>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col bg-void md:hidden"
          >
            <div className="flex items-center justify-between px-5 py-3.5">
              <Image
                src="/brand/yanchan-logo-white.png"
                alt="Yanchan Produced"
                width={180}
                height={100}
                className="h-9 w-auto"
              />
              <button
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="flex h-11 w-11 items-center justify-center text-cream"
              >
                <X size={26} />
              </button>
            </div>
            <nav className="flex flex-1 flex-col justify-center gap-2 px-6">
              {NAV.map((n, i) => (
                <motion.div
                  key={n.href}
                  initial={{ opacity: 0, x: -30 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    delay: 0.05 + i * 0.07,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                >
                  <Link
                    href={n.href}
                    onClick={() => setOpen(false)}
                    className="block font-display text-[15vw] uppercase leading-[1.05] text-cream transition-colors hover:text-amber"
                  >
                    {n.label}
                  </Link>
                </motion.div>
              ))}
            </nav>
            <div className="px-6 pb-10">
              <Link
                href="/store"
                onClick={() => setOpen(false)}
                className="block rounded-[4px] bg-amber py-4 text-center font-head font-bold uppercase tracking-widest text-void"
              >
                Shop the tour drop
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
