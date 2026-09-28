import Link from "next/link";
import { SOCIALS } from "@/lib/content";
import { TOUR_PUBLIC } from "@/lib/flags";
import { NewsletterForm } from "./newsletter-form";
import { ConsentFooterLink } from "./consent-banner";

export function SiteFooter() {
  return (
    <footer className="relative z-[2] border-t border-white/10 bg-coal">
      <div className="mx-auto max-w-[1320px] px-5 py-16 sm:px-8">
        <div className="grid gap-12 md:grid-cols-[1.2fr_1fr_1fr]">
          <div>
            <p className="font-display text-3xl uppercase leading-none text-cream">
              yanchan<span className="text-amber"> produced</span>
            </p>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-warmgray">
              Bridging South Indian tradition with North American hip-hop.
              Scarborough to the world.
            </p>
            <p className="mt-6 font-mono text-[0.7rem] uppercase tracking-[0.25em] text-amber">
              Heart · Passion · Certainty
            </p>
          </div>

          <div>
            <h3 className="mb-4 font-mono text-[0.7rem] uppercase tracking-[0.25em] text-warmgray">
              Explore
            </h3>
            <ul className="space-y-2.5 text-sm">
              {[
                ["Music", "/music"],
                ["Merch", "/store"],
                ["About", "/about"],
                ...(TOUR_PUBLIC ? [["Tour", "/tour"]] : []),
                ["Press", "/press"],
                ["Booking", "/#booking"],
              ].map(([label, href]) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="inline-flex min-h-11 items-center text-cream/80 transition-colors hover:text-amber lg:min-h-0"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="mb-4 font-mono text-[0.7rem] uppercase tracking-[0.25em] text-warmgray">
              Follow
            </h3>
            <ul className="space-y-2.5 text-sm">
              {SOCIALS.map((s) => (
                <li key={s.label}>
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center text-cream/80 transition-colors hover:text-amber lg:min-h-0"
                  >
                    {s.label} ↗
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-14 border-t border-white/10 pt-8">
          <p className="mb-4 font-mono text-[0.7rem] uppercase tracking-[0.25em] text-warmgray">
            Early drops + first listen
          </p>
          <NewsletterForm source="footer" />
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-white/10 pt-6 text-xs text-warmgray sm:flex-row sm:items-center">
          <span>
            © {new Date().getFullYear()} Yanchan Rajmohan · Emtee Music Group
          </span>
          <span className="flex items-center gap-4">
            <ConsentFooterLink />
            <span className="font-mono uppercase tracking-wider">
              A life not trying is a life not lived at all.
            </span>
          </span>
        </div>
      </div>
    </footer>
  );
}
