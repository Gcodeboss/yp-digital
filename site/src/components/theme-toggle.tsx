"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  applyTheme,
  storeTheme,
  DEFAULT_THEME,
  getStoredTheme,
  THEME_LABELS,
  THEMES,
  type ThemeName,
} from "@/lib/theme";

/**
 * localStorage is an external store, so the toggle reads it as one rather than
 * copying it into state. `useSyncExternalStore` takes a server snapshot, which
 * is what keeps this hydration-safe: the server and the hydrating client render
 * DEFAULT_THEME identically, then React re-reads the real value once hydration
 * is done. Nothing mismatches, so nothing needs suppressHydrationWarning — and
 * unlike a lazy `useState` initialiser, the first client render cannot disagree
 * with the HTML the server sent.
 *
 * The `storage` event covers other tabs; browsers do not fire it in the tab that
 * wrote the value, so a local change announces itself.
 */
const THEME_EVENT = "yp-theme-change";

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(THEME_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(THEME_EVENT, onStoreChange);
  };
}

function getServerSnapshot(): ThemeName {
  return DEFAULT_THEME;
}

/**
 * The theme switch for the dashboard toolbar. Sized to sit beside the other
 * toolbar controls, so it borrows the segmented control's geometry from
 * yp-chrome rather than inventing its own.
 *
 * Every colour here resolves through a brand token, never a literal — a control
 * that exists to swap the palette cannot be the one thing the palette misses.
 */
export default function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, getStoredTheme, getServerSnapshot);

  // Pushes the resolved theme at the DOM, which is the external system this
  // component owns. On a hard load THEME_INIT_SCRIPT has already set the
  // attribute during HTML parsing and this is a no-op; it is what keeps the
  // theme correct on any route that has not inlined that script.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function choose(next: ThemeName) {
    storeTheme(next);
    applyTheme(next);
    window.dispatchEvent(new Event(THEME_EVENT));
  }

  return (
    <div
      role="group"
      aria-label="Theme"
      className={`flex shrink-0 overflow-hidden rounded-md border border-amber/25 bg-void ${className}`}
    >
      {THEMES.map((name) => (
        <button
          key={name}
          type="button"
          onClick={() => choose(name)}
          aria-pressed={theme === name}
          className={`px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.14em] transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-amber ${
            theme === name
              ? "bg-amber/15 text-amber"
              : "bg-transparent text-warmgray hover:bg-charcoal hover:text-cream"
          }`}
        >
          {THEME_LABELS[name]}
        </button>
      ))}
    </div>
  );
}
