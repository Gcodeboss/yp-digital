"use client";

/**
 * The consent banner, and the footer control that reopens it.
 *
 * Deliberately small: one line of copy, two buttons of equal weight, anchored
 * to the bottom, never covering the page. A storefront that greets a first-time
 * visitor with a full-screen interstitial loses the sale before the drop is
 * seen. Accept and Decline sit side by side because a Decline hidden behind a
 * "manage preferences" screen is not a real choice.
 *
 * The copy names both products and says recording happens, because Clarity
 * records the session — that is the part a visitor would not otherwise expect,
 * so it is the part that gets said out loud.
 */
import { ANALYTICS_CONFIGURED, useConsent } from "./consent-provider";

export function ConsentBanner() {
  const { askingNow, accept, decline } = useConsent();
  if (!askingNow) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Analytics consent"
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-white/10 bg-void/95 backdrop-blur-sm"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        {/*
          This names every product acceptance would load. A product that loads
          without being named here makes the disclosure untrue and the consent
          invalid, so this sentence changes in the same commit as the loaders —
          never afterwards. See specs/visitor-analytics.
        */}
        <p className="text-xs leading-relaxed text-cream/75">
          We use Google Analytics, Microsoft Clarity and HubSpot to see how the
          site is used. Clarity records browsing sessions as replays, and
          HubSpot links an enquiry to the pages you read. Nothing loads until
          you say yes, and nothing you type is ever recorded.
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={decline}
            className="min-h-11 border border-white/20 px-4 font-mono text-[0.7rem] uppercase tracking-[0.2em] text-cream/80 transition-colors hover:border-white/40 hover:text-cream"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={accept}
            className="min-h-11 bg-amber px-4 font-mono text-[0.7rem] uppercase tracking-[0.2em] text-void transition-opacity hover:opacity-90"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Footer entry point, so a decision is never final. Renders nothing when no
 * analytics are configured — there would be nothing for it to change.
 */
export function ConsentFooterLink() {
  const { reopen, consent, askingNow } = useConsent();
  if (!ANALYTICS_CONFIGURED || askingNow) return null;

  return (
    <button
      type="button"
      onClick={reopen}
      className="font-mono text-[0.7rem] uppercase tracking-wider text-warmgray underline-offset-4 transition-colors hover:text-amber hover:underline"
    >
      {consent === "granted" ? "Analytics: on" : "Analytics: off"} · change
    </button>
  );
}
