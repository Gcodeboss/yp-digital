"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { gsap } from "gsap";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { BASE, formatDate, type TourDate } from "@/lib/content";

gsap.registerPlugin(ScrambleTextPlugin);

// Mridangam solkattu — the syllables a player vocalises while drumming.
// Used as the scramble alphabet so even the noise is on-brand.
const SCRAMBLE_CHARS = "TAKADIMITHOMNAM";

const IDLE_DELAY = 4000;

type Row = {
  key: string;
  city: string;
  venue: string;
  date: string;
  status: string;
  year: string;
  image?: string;
  href?: string;
};

function toRow(t: TourDate): Row {
  // Three states, not two: a date can be announced before its tickets are,
  // and that must not read as "Sold out".
  const status = t.soldOut ? "Sold out" : t.ticketUrl ? "Tickets" : "Announced";
  return {
    key: t.id,
    city: t.city,
    venue: t.venue,
    date: formatDate(t.date).toUpperCase(),
    status,
    year: new Date(t.date + "T00:00:00").getFullYear().toString(),
    image: t.image,
    href: t.soldOut ? undefined : t.ticketUrl,
  };
}

const FIELDS = ["city", "venue", "date", "status", "year"] as const;

function TourRow({
  row,
  index,
  active,
  reduced,
  onEnter,
  registerRef,
}: {
  row: Row;
  index: number;
  active: boolean;
  reduced: boolean;
  onEnter: (index: number, image?: string) => void;
  registerRef: (index: number, el: HTMLLIElement | null) => void;
}) {
  const cells = useRef<
    Partial<Record<(typeof FIELDS)[number], HTMLSpanElement | null>>
  >({});

  useEffect(() => {
    FIELDS.forEach((field) => {
      const el = cells.current[field];
      if (!el) return;
      gsap.killTweensOf(el);
      if (active && !reduced) {
        gsap.to(el, {
          duration: 0.8,
          scrambleText: {
            text: row[field],
            chars: SCRAMBLE_CHARS,
            revealDelay: 0.3,
            speed: 0.4,
          },
        });
      } else {
        el.textContent = row[field];
      }
    });
  }, [active, reduced, row]);

  const soldOut = row.status === "Sold out";

  const body = (
    <>
      <span
        ref={(el) => {
          cells.current.city = el;
        }}
        className={`[grid-column:1] [grid-row:1] truncate font-head text-[0.95rem] font-bold uppercase tracking-tight transition-colors duration-300 sm:text-lg md:[grid-column:auto] md:[grid-row:auto] ${
          active ? "text-amber" : "text-cream"
        }`}
      >
        {row.city}
      </span>
      <span
        ref={(el) => {
          cells.current.venue = el;
        }}
        className="[grid-column:1] [grid-row:2] truncate font-mono text-[0.65rem] uppercase tracking-[0.16em] text-warmgray sm:text-[0.72rem] md:[grid-column:auto] md:[grid-row:auto]"
      >
        {row.venue}
      </span>
      <span
        ref={(el) => {
          cells.current.date = el;
        }}
        className="[grid-column:2] [grid-row:2] truncate text-right font-mono text-[0.65rem] uppercase tracking-[0.16em] text-cream/70 md:[grid-column:auto] md:[grid-row:auto] md:text-left md:text-[0.7rem]"
      >
        {row.date}
      </span>
      <span
        ref={(el) => {
          cells.current.status = el;
        }}
        className={`[grid-column:2] [grid-row:1] truncate text-right font-mono text-[0.65rem] uppercase tracking-[0.16em] md:[grid-column:auto] md:[grid-row:auto] md:text-left md:text-[0.7rem] ${
          soldOut ? "text-rust" : row.href ? "text-amber" : "text-warmgray"
        }`}
      >
        {row.status}
      </span>
      <span
        ref={(el) => {
          cells.current.year = el;
        }}
        className="hidden shrink-0 text-right font-mono text-[0.7rem] tracking-[0.16em] text-warmgray md:block"
      >
        {row.year}
      </span>
    </>
  );

  // Mobile: two lines (city / status, then venue / date). md+: one five-column row.
  const grid =
    "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1.5 py-4 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,0.6fr)_auto] md:gap-y-0 md:py-5";

  return (
    <li
      ref={(el) => registerRef(index, el)}
      onMouseEnter={() => onEnter(index, row.image)}
      onFocus={() => onEnter(index, row.image)}
      className="group/row relative border-t border-white/10"
    >
      <span
        aria-hidden
        className={`absolute left-0 top-0 h-px bg-amber transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          active ? "w-full" : "w-0"
        }`}
      />
      {row.href ? (
        <a
          href={row.href}
          target="_blank"
          rel="noopener noreferrer"
          className={`${grid} px-1 outline-none focus-visible:bg-amber/10`}
          aria-label={`Tickets: ${row.city}, ${row.venue}, ${row.date}`}
        >
          {body}
        </a>
      ) : (
        <div
          className={`${grid} px-1`}
          aria-label={`${row.city}, ${row.venue}, ${row.date}, ${row.status.toLowerCase()}`}
        >
          {body}
        </div>
      )}
    </li>
  );
}

function LocalTime() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: BASE.timeZone,
        hour12: true,
        hour: "numeric",
        minute: "numeric",
      }).formatToParts(new Date());
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
      setTime(
        `${get("hour")}\u200a:\u200a${get("minute")} ${get("dayPeriod")}`,
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // null until mounted so server and client markup agree
  return (
    <span className="font-mono text-[0.65rem] uppercase tracking-[0.22em] lg:text-[0.6rem] text-warmgray">
      {time ? `${time} local` : "\u00a0"}
    </span>
  );
}

export function TourBoard({ dates }: { dates: TourDate[] }) {
  const rows = dates.map(toRow);

  const [active, setActive] = useState(-1);
  const reduced = !!useReducedMotion();
  const bgRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const idleTween = useRef<gsap.core.Timeline | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Warm the backdrops so the first hover doesn't flash
  useEffect(() => {
    rows.forEach((r) => {
      if (!r.image) return;
      const img = new window.Image();
      img.src = r.image;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const registerRef = useCallback((i: number, el: HTMLLIElement | null) => {
    itemRefs.current[i] = el;
  }, []);

  const stopIdle = useCallback(() => {
    if (!idleTween.current) return;
    idleTween.current.kill();
    idleTween.current = null;
    itemRefs.current.forEach((el) => el && gsap.set(el, { opacity: 1 }));
  }, []);

  const startIdle = useCallback(() => {
    if (idleTween.current || reduced) return;
    const items = itemRefs.current.filter(Boolean) as HTMLLIElement[];
    if (!items.length) return;

    const tl = gsap.timeline({ repeat: -1, repeatDelay: 2 });
    items.forEach((el, i) => {
      tl.to(
        el,
        { opacity: 0.08, duration: 0.12, ease: "power2.inOut" },
        i * 0.06,
      );
      tl.to(
        el,
        { opacity: 1, duration: 0.12, ease: "power2.inOut" },
        items.length * 0.06 * 0.5 + i * 0.06,
      );
    });
    idleTween.current = tl;
  }, [reduced]);

  const armIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(startIdle, IDLE_DELAY);
  }, [startIdle]);

  const handleEnter = useCallback(
    (index: number, image?: string) => {
      stopIdle();
      if (idleTimer.current) clearTimeout(idleTimer.current);
      setActive(index);

      const bg = bgRef.current;
      if (!bg || !image) return;
      bg.style.backgroundImage = `url(${image})`;
      if (reduced) {
        bg.style.opacity = "1";
        return;
      }
      gsap.fromTo(
        bg,
        { opacity: 0, scale: 1.14 },
        {
          opacity: 1,
          scale: 1,
          duration: 0.9,
          ease: "power3.out",
          overwrite: true,
        },
      );
    },
    [reduced, stopIdle],
  );

  const handleLeave = useCallback(() => {
    setActive(-1);
    if (bgRef.current) {
      gsap.to(bgRef.current, { opacity: 0, duration: 0.5, overwrite: true });
    }
    armIdle();
  }, [armIdle]);

  useEffect(() => {
    armIdle();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      stopIdle();
    };
  }, [armIdle, stopIdle]);

  return (
    <div className="relative isolate overflow-hidden border-y border-white/10 bg-void">
      {/* Backdrop revealed on hover */}
      <div
        ref={bgRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-cover bg-center opacity-0 [filter:contrast(1.1)_saturate(0.85)]"
      />
      {/* Scrim: dark enough to keep the type legible, light enough to see the room */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-r from-void via-void/78 to-void/25"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-t from-void/95 via-void/20 to-void/60"
      />

      {/* Corner markers */}
      <div className="pointer-events-none absolute left-5 top-5 h-2 w-2 border border-amber sm:left-8 sm:top-8" />
      <div className="pointer-events-none absolute right-5 top-5 sm:right-8 sm:top-8">
        <span className="font-mono text-[0.65rem] uppercase tracking-[0.22em] lg:text-[0.6rem] text-warmgray">
          {dates.length} dates
        </span>
      </div>

      <div
        onMouseLeave={handleLeave}
        className="relative mx-auto w-full max-w-[1320px] px-5 pb-16 pt-20 sm:px-8 sm:pb-20 sm:pt-24"
      >
        {/* Column key */}
        <div className="mb-2 hidden grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,0.6fr)_auto] gap-x-4 px-1 pb-3 font-mono text-[0.62rem] uppercase tracking-[0.28em] lg:text-[0.55rem] text-warmgray/60 md:grid">
          <span>City</span>
          <span>Venue</span>
          <span>Date</span>
          <span>Status</span>
          <span className="text-right">Year</span>
        </div>

        <ul className="border-b border-white/10">
          {rows.map((row, i) => (
            <TourRow
              key={row.key}
              row={row}
              index={i}
              active={active === i}
              reduced={reduced}
              onEnter={handleEnter}
              registerRef={registerRef}
            />
          ))}
        </ul>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.22em] lg:text-[0.6rem] text-warmgray">
            {BASE.label} · {BASE.coords}
          </span>
          <LocalTime />
        </div>
      </div>
    </div>
  );
}
