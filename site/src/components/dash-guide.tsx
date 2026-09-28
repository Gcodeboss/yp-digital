"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * The how-to-drive-this panel.
 *
 * The dash is a pipeline, not a set of pages, and nothing on screen says so —
 * a stream has to be archived before it can be clipped, framed before it is
 * captioned, and approved before it can leave. Someone opening Timeline first
 * finds an empty editor and no explanation. This states the order once, in
 * order, and gets out of the way.
 *
 * It opens itself on a first visit and never again unless asked for, so it is
 * an onboarding aid rather than a thing to dismiss every morning. The content
 * is deliberately specific: what each screen is FOR, what "done" looks like on
 * it, and the two or three facts that are not guessable from the interface.
 */

const STORAGE_KEY = "yp-guide-seen";

type Step = {
  href: string;
  label: string;
  purpose: string;
  done: string;
  note?: string;
};

/** Ordered because the work is ordered. */
const STEPS: Step[] = [
  {
    href: "/dashboard/streams",
    label: "Streams",
    purpose:
      "The archive. Every stream Kick still holds, and every one already pulled to this machine.",
    done: "The stream you want reads ready rather than not prepared.",
    note: "Kick deletes a non-verified channel's VODs after about 30 days. Anything at risk is worth pulling before it is clipped — a lost VOD cannot be re-cut later.",
  },
  {
    href: "/dashboard/timeline",
    label: "Timeline",
    purpose:
      "Where moments become clips. Five lanes share one time axis: the ruler, the audio waveform, the music map, the transcript, and the clips themselves.",
    done: "The clips lane holds the moments you want, each with an in and an out.",
    note: "Scrub to a moment, press Mark in, then New clip. Gold in the music map means a sustained vocal; grey means instrumental.",
  },
  {
    href: "/dashboard/framing",
    label: "Framing",
    purpose:
      "Where the two panes get their crop — webcam on top, Ableton underneath. Framing is measured per clip and can be overridden and locked.",
    done: "Every clip is framed, and anything you set by hand is locked so a re-render cannot move it.",
    note: "Fix framing before rendering, not after. Each clip costs 25-40 seconds to compose, so a wrong crop found late costs the whole batch again.",
  },
  {
    href: "/dashboard/captions",
    label: "Captions",
    purpose:
      "The transcript, and the burned captions that read from it. Correct a line here and the render follows.",
    done: "The lines over each clip say what was actually said.",
  },
  {
    href: "/dashboard/review",
    label: "Review",
    purpose:
      "The gate. Approve, send back for edit, or reject — then build the export pack for whoever posts.",
    done: "Approved clips are in an export pack.",
    note: "Nothing posts from here, by design. The pack is a handoff to a person.",
  },
  {
    href: "/dashboard",
    label: "Ops",
    purpose: "Brand deals, tasks, and the weekly picture away from the clipping work.",
    done: "—",
  },
];

/** Things the interface cannot tell you about itself. */
const FACTS = [
  {
    k: "What the score means",
    v: "It measures how strongly music is playing and how much sustained vocal is in it — not how well a clip will perform. It ranks moments inside one stream. Two streams' scores are not comparable.",
  },
  {
    k: "What the colours mean",
    v: "Amber is now — the playhead and whatever is selected. Gold is singing. Warm grey is beat. Sienna wants attention. Mint means a machine check passed. Anything else is deliberately colourless.",
  },
  {
    k: "Timeline keys",
    v: "space plays · ← → move a second · shift ← → move ten · , and . step a frame · i and o set in and out · [ and ] zoom",
  },
];

export default function DashGuide() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // First visit only. A guide that reappears every morning becomes a thing to
  // dismiss rather than a thing to read.
  useEffect(() => {
    try {
      if (!window.localStorage.getItem(STORAGE_KEY)) setOpen(true);
    } catch {
      // Storage blocked — skip the auto-open rather than showing it every load.
    }
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Not fatal: it simply opens again next time.
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="How to use this dashboard"
        className="pointer-events-auto flex h-[26px] w-[26px] items-center justify-center rounded-md border border-line-strong bg-panel font-mono text-[11px] text-ink-dim transition-colors hover:border-amber/50 hover:text-amber"
      >
        ?
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="How to use the YP Dash"
      className="pointer-events-auto fixed inset-0 z-[60] flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Close guide"
        onClick={close}
        className="absolute inset-0 cursor-default bg-black/70"
      />

      <div className="relative flex max-h-[86vh] w-full max-w-[860px] flex-col overflow-hidden rounded-md border border-line-strong bg-panel">
        <header className="flex shrink-0 items-baseline gap-3 border-b border-line px-5 py-3">
          <span className="font-head text-[14px] font-black uppercase tracking-tight text-ink">
            How this works
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-dim">
            stream → clip → frame → caption → approve
          </span>
          <button
            type="button"
            onClick={close}
            className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-ink-dim transition-colors hover:text-amber"
          >
            close ESC
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <ol className="flex flex-col">
            {STEPS.map((s, i) => {
              const here =
                s.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(s.href);
              return (
                <li
                  key={s.href}
                  className={`grid grid-cols-[22px_minmax(0,1fr)] gap-x-3 border-b border-line py-3 last:border-b-0 ${
                    here ? "bg-amber/[0.06]" : ""
                  }`}
                >
                  <span
                    className={`pt-[2px] font-mono text-[11px] tabular-nums ${
                      here ? "text-amber" : "text-ink-faint"
                    }`}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span
                        className={`font-head text-[11px] font-semibold uppercase tracking-[0.14em] ${
                          here ? "text-amber" : "text-ink"
                        }`}
                      >
                        {s.label}
                      </span>
                      {here && (
                        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-amber">
                          you are here
                        </span>
                      )}
                    </div>
                    <p className="font-editorial mt-1 text-[15px] text-ink">{s.purpose}</p>
                    <p className="mt-1 text-[12px] text-ink-dim">
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
                        done when{" "}
                      </span>
                      {s.done}
                    </p>
                    {s.note && (
                      <p className="mt-1.5 border-l border-sienna/60 pl-2.5 text-[12px] text-ink-dim">
                        {s.note}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="mt-5 border-t border-line-strong pt-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-dim">
              worth knowing
            </span>
            <dl className="mt-2 flex flex-col gap-2.5">
              {FACTS.map((f) => (
                <div key={f.k} className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)] gap-x-3">
                  <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
                    {f.k}
                  </dt>
                  <dd className="text-[12px] text-ink-dim">{f.v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <footer className="shrink-0 border-t border-line px-5 py-2.5">
          <span className="text-[11px] text-ink-dim">
            Reopen this any time with the{" "}
            <span className="font-mono text-ink">?</span> button, bottom right.
          </span>
        </footer>
      </div>
    </div>
  );
}
