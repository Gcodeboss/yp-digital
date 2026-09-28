"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

const navLinks = [
  { label: "HOME", href: "#home" },
  { label: "ABOUT", href: "#about" },
  { label: "MUSIC", href: "#music" },
  { label: "VIDEOS", href: "#videos" },
  { label: "CONTACT", href: "#contact" },
];

export function LegacyHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="fixed left-0 right-0 top-0 z-50 bg-black/20 backdrop-blur-sm">
      <div className="legacy-container flex items-center justify-between py-4">
        <Link href="/legacy" className="relative h-10 w-[110px]">
          <Image
            src="/legacy/logos/yanchan-559x246.png"
            alt="Yanchan Produced"
            fill
            className="object-contain"
            priority
          />
        </Link>

        <nav className="hidden items-center gap-10 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="font-mono text-xs font-semibold tracking-[0.15em] text-white transition-colors hover:text-[rgb(255,145,77)]"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <button
          className="flex h-10 w-10 flex-col items-center justify-center gap-1.5 md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          <span className="block h-0.5 w-6 bg-white" />
          <span className="block h-0.5 w-6 bg-white" />
          <span className="block h-0.5 w-4 bg-white" />
        </button>
      </div>

      {mobileOpen && (
        <div className="absolute left-0 right-0 top-full bg-[rgb(19,27,14)] px-6 py-6 md:hidden">
          <nav className="flex flex-col items-center gap-5">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="font-mono text-sm font-semibold tracking-[0.15em] text-white transition-colors hover:text-[rgb(255,145,77)]"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
