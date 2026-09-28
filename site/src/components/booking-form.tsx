"use client";

import { useState } from "react";
import { Check } from "lucide-react";

const TYPES = [
  "Custom beat",
  "Feature / collab",
  "Mixing",
  "Live booking",
  "Other",
];

const field =
  "w-full border-b border-cream/20 bg-transparent py-3 text-cream placeholder:text-warmgray transition-colors focus:border-amber focus:outline-none";

export function BookingForm() {
  const [type, setType] = useState(TYPES[0]);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState("");
  /**
   * What was actually sent, kept so the confirmation can repeat it back. A
   * booking enquiry is a message into the dark — showing the address the reply
   * is going to is the difference between "sent" and "sent, to you, about this".
   */
  const [sent, setSent] = useState<{ email: string; type: string } | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    // honeypot
    if (form.get("company")) return;
    const payload = {
      name: form.get("name"),
      email: form.get("email"),
      type,
      message: form.get("message"),
      // Sent so the SERVER can check it too. The check above only protects
      // against a bot that renders the page; one posting straight at
      // /api/booking never runs it, and enquiries now land in a real CRM.
      company: form.get("company") ?? "",
    };
    if (!payload.name || !payload.email || !payload.message) {
      setState("error");
      setError("Please fill in your name, email and a message.");
      return;
    }
    setState("loading");
    setError("");
    try {
      const res = await fetch("/api/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!res.ok) {
        throw new Error(body?.error || "Your inquiry could not be sent.");
      }
      setSent({ email: String(payload.email), type });
      setState("done");
    } catch (caught) {
      setState("error");
      setError(
        caught instanceof Error
          ? caught.message
          : "Your inquiry could not be sent. Please try again.",
      );
    }
  }

  if (state === "done") {
    return (
      /*
        This panel sits in a grid cell as tall as the headline column beside it,
        so it stretches whatever it contains. The old version put one sentence
        in that space and read as an empty box with a stray tick. It now fills
        the height on purpose: the same eyebrow → display headline → body rhythm
        the rest of the site uses, then a receipt of what was actually sent.
      */
      <div className="flex h-full flex-col justify-center border border-amber/30 bg-gradient-to-b from-amber/[0.08] via-amber/[0.03] to-transparent p-8 sm:p-10">
        <span className="inline-flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.25em] text-amber">
          <Check size={14} strokeWidth={3} />
          Enquiry sent
        </span>

        <h3 className="mt-5 font-display text-[clamp(2rem,4.5vw,3.4rem)] uppercase leading-[0.92] text-cream">
          Got it<span className="text-amber">.</span>
        </h3>

        <p className="mt-4 max-w-md text-pretty text-base leading-relaxed text-warmgray">
          I&apos;ll get back to you personally, usually within 48 hours.
        </p>

        {sent && (
          <dl className="mt-8 grid gap-2.5 border-t border-cream/10 pt-6 font-mono text-[0.7rem] uppercase tracking-[0.18em]">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <dt className="w-20 shrink-0 text-warmgray">About</dt>
              <dd className="text-cream">{sent.type}</dd>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <dt className="w-20 shrink-0 text-warmgray">Reply to</dt>
              {/* Not uppercased: an email address is read, not styled. */}
              <dd className="break-all normal-case tracking-normal text-cream">
                {sent.email}
              </dd>
            </div>
          </dl>
        )}

        <button
          type="button"
          onClick={() => {
            setSent(null);
            setError("");
            setState("idle");
          }}
          className="mt-8 inline-flex min-h-11 w-fit items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.2em] text-warmgray transition-colors hover:text-amber"
        >
          Send another
          <span aria-hidden>&rarr;</span>
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <input
        type="text"
        name="company"
        tabIndex={-1}
        autoComplete="off"
        className="hidden"
        aria-hidden
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <input name="name" placeholder="Name" className={field} />
        <input
          name="email"
          type="email"
          placeholder="Email"
          className={field}
        />
      </div>

      <div>
        <p className="mb-3 font-mono text-[0.7rem] uppercase tracking-[0.2em] text-warmgray">
          Inquiry type
        </p>
        <div className="flex flex-wrap gap-2">
          {TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`min-h-11 rounded-[4px] border px-4 py-2.5 font-head text-xs font-bold uppercase tracking-wide transition-colors ${
                type === t
                  ? "border-amber bg-amber text-void"
                  : "border-cream/20 text-cream/80 hover:border-cream"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <textarea
        name="message"
        rows={4}
        placeholder="Tell me about the project…"
        className={`${field} resize-none`}
      />

      {state === "error" && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={state === "loading"}
        className="rounded-[4px] bg-amber px-8 py-4 font-head text-sm font-bold uppercase tracking-[0.1em] text-void transition-all hover:scale-[1.02] hover:bg-sienna disabled:opacity-50"
      >
        {state === "loading" ? "Sending…" : "Send inquiry"}
      </button>
    </form>
  );
}
