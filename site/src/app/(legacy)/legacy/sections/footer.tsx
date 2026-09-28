"use client";

import Link from "next/link";

const footerLinks = [
  { label: "HOME", href: "#home" },
  { label: "ABOUT", href: "#about" },
  { label: "MUSIC", href: "#music" },
  { label: "VIDEOS", href: "#videos" },
  { label: "CONTACT", href: "#contact" },
];

export function LegacyFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-[rgb(19,27,14)] py-10">
      <div className="legacy-container text-center">
        <nav className="mb-6 flex flex-wrap items-center justify-center gap-6">
          {footerLinks.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="font-mono text-xs font-semibold tracking-[0.15em] text-white transition-colors hover:text-[rgb(255,145,77)]"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <p className="font-mono text-xs tracking-[0.1em] text-white/60">
          @ {year} Yanchan Produced ALL RIGHTS RESERVED
        </p>
      </div>
    </footer>
  );
}
