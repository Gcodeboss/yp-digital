"use client";

import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";

export function NewsletterForm({
  source = "site",
  cta = "Get the kit",
  placeholder = "your@email.com",
}: {
  source?: string;
  cta?: string;
  placeholder?: string;
}) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">(
    "idle",
  );
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setState("error");
      setMsg("Enter a valid email.");
      return;
    }
    setState("loading");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source }),
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!res.ok) {
        throw new Error(body?.error || "Email signup could not be completed.");
      }
      setState("done");
    } catch (error) {
      setState("error");
      setMsg(
        error instanceof Error
          ? error.message
          : "Something went wrong. Try again.",
      );
    }
  }

  if (state === "done") {
    return (
      <div className="flex items-center gap-3 border border-amber/40 bg-amber/10 px-5 py-4 text-cream">
        <Check className="text-amber" size={20} />
        <p className="text-sm">
          You&apos;re in. Check your inbox for the free Mridangam kit + early
          drops.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="w-full max-w-md">
      <div className="flex items-stretch border-b border-cream/25 transition-colors focus-within:border-amber">
        <input
          type="email"
          inputMode="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state === "error") setState("idle");
          }}
          placeholder={placeholder}
          aria-label="Email address"
          className="flex-1 bg-transparent py-3 text-base text-cream placeholder:text-warmgray focus:outline-none"
        />
        <button
          type="submit"
          disabled={state === "loading"}
          className="flex items-center gap-2 px-2 font-head text-xs font-bold uppercase tracking-[0.15em] text-amber transition-colors hover:text-gold disabled:opacity-50"
        >
          {state === "loading" ? "…" : cta}
          <ArrowRight size={16} />
        </button>
      </div>
      {state === "error" && <p className="mt-2 text-xs text-red-400">{msg}</p>}
    </form>
  );
}
