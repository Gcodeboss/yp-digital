/**
 * The dashboard runs two themes, selected by a `data-theme` attribute on <html>:
 * "console" (the default) and "legacy" (the original dash, preserved). The token
 * layer for both lives in globals.css — this module is only the runtime around it.
 *
 * Most components need nothing from here. Tailwind v4 compiles `bg-amber` to
 * var(--color-amber), so redefining the token re-skins them with no className
 * churn. The exceptions are the components that paint outside CSS — a <canvas>,
 * and inline `style` props carrying hardcoded hex — which have to read the live
 * token value instead. That is what `themeColor` and `themeColors` are for.
 */

export type ThemeName = "console" | "light" | "legacy";

export const THEMES: readonly ThemeName[] = ["console", "light", "legacy"];

export const DEFAULT_THEME: ThemeName = "console";

export const THEME_STORAGE_KEY = "yp-theme";

export const THEME_LABELS: Record<ThemeName, string> = {
  console: "Console",
  light: "Light",
  legacy: "Legacy",
};

/** A stored value is only trusted once it is one of the names we actually ship. */
function isThemeName(value: unknown): value is ThemeName {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/**
 * The persisted theme, or the default. Every storage read is wrapped: it throws
 * outright in Safari private mode, and there is no `window` at all on the server.
 */
export function getStoredTheme(): ThemeName {
  if (typeof window === "undefined") return DEFAULT_THEME;

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeName(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/**
 * The element the dashboard's theme attribute lives on. The palette is scoped to
 * the dashboard shell rather than <html> so the public marketing site cannot
 * inherit it; see yp-chrome.tsx. Falls back to <html> on any surface that opts
 * in globally instead.
 */
export const THEME_ROOT_ID = "yp-root";

function themeRoot(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById(THEME_ROOT_ID) ?? document.documentElement;
}

/**
 * Sets the attribute the CSS selects on. Deliberately does NOT persist.
 *
 * These were one function and it lost people's choice on every reload. The
 * component syncs the DOM from an effect, and on the first client render that
 * effect runs with the server snapshot (the default) before the store has
 * re-read storage — so a combined apply-and-persist wrote "console" over a
 * stored "legacy" every time the page loaded. Writing storage is now something
 * only an explicit choice does.
 */
export function applyTheme(theme: ThemeName): void {
  if (typeof document === "undefined") return;

  const root = themeRoot();
  if (root) root.dataset.theme = theme;
}

/** Persists an explicit choice. Only ever called from a user action. */
export function storeTheme(theme: ThemeName): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage is blocked. The attribute is set either way, so the theme is right
    // for this session and simply does not survive a reload.
  }
}

const FALLBACK_COLOUR = "#000000";

/**
 * The live value of a CSS custom property, read off <html>.
 *
 * Anything painted through CSS re-themes itself for free. A <canvas> and an
 * inline `style` prop do not — both take a plain string, and a hardcoded hex
 * stays that hex whichever theme is active. Those callers resolve the token
 * through here so their colours follow the theme like everything else.
 *
 * Accepts "--color-amber" or "amber" — the leading dashes are normalised in.
 */
export function themeColor(name: string, fallback: string = FALLBACK_COLOUR): string {
  if (typeof window === "undefined" || typeof document === "undefined") return fallback;

  const property = name.startsWith("--") ? name : `--${name}`;

  try {
    const value = window
      .getComputedStyle(themeRoot() ?? document.documentElement)
      .getPropertyValue(property)
      .trim();
    return value || fallback;
  } catch {
    return fallback;
  }
}

export type ThemePalette = {
  ground: string;
  panel: string;
  raised: string;
  line: string;
  ink: string;
  inkDim: string;
  amber: string;
  gold: string;
  sienna: string;
  mint: string;
};

/**
 * One resolved snapshot of the palette. `getComputedStyle` forces a style
 * recalculation, so a canvas draw loop resolves the whole palette once per
 * render through this rather than one property per colour per frame.
 *
 * Fallbacks are the console values, so a snapshot taken before the stylesheet
 * lands still draws the right picture.
 */
export function themeColors(): ThemePalette {
  return {
    ground: themeColor("--color-ground", "#08070A"),
    panel: themeColor("--color-panel", "#0E0D11"),
    raised: themeColor("--color-raised", "#16141A"),
    line: themeColor("--color-line", "rgba(244,227,198,0.08)"),
    ink: themeColor("--color-ink", "#F4E3C6"),
    inkDim: themeColor("--color-ink-dim", "#8A8A8A"),
    amber: themeColor("--color-amber", "#F58804"),
    gold: themeColor("--color-gold", "#FFDE00"),
    sienna: themeColor("--color-sienna", "#BC4803"),
    mint: themeColor("--color-mint", "#7FD4C1"),
  };
}

/**
 * A colour with its alpha replaced.
 *
 * Existing code builds translucent fills by concatenating hex alpha onto a
 * colour string — `${colour}1a` in the framing editor. That holds only while
 * every colour is a 6-digit hex literal. Tokens are theme-owned now and a theme
 * is free to express one as `rgb()`, `rgba()` or `oklch()`, at which point the
 * concatenation produces a string the browser silently discards. Callers that
 * need a tint go through here instead.
 */
export function withAlpha(color: string, alpha: number): string {
  const a = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;
  const value = color.trim();

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const digits = hex[1];
    const full =
      digits.length === 3
        ? digits
            .split("")
            .map((d) => d + d)
            .join("")
        : digits;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  // Both the legacy `rgb(r, g, b)` and the modern `rgb(r g b / a)` forms: drop
  // any alpha the token already carries, keep the three channels as written.
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (rgb) {
    const channels = rgb[1].split("/")[0].split(/[\s,]+/).filter(Boolean);
    if (channels.length >= 3) {
      return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${a})`;
    }
  }

  // oklch(), color(), a named colour — hand the parsing to the browser.
  return `color-mix(in srgb, ${value} ${Math.round(a * 1000) / 10}%, transparent)`;
}

/**
 * Inline this in a <script> in <head>, before anything paints, so the page never
 * flashes the wrong theme on a hard load. See the Next.js guide "How to prevent
 * flash before hydration": the script runs during HTML parsing, which is earlier
 * than any effect — earlier than React itself.
 *
 * It runs before the bundle exists, so it can close over nothing: the storage
 * key and the theme names are repeated here as literals on purpose. Keep them in
 * step with the constants above. No backticks and no closing script tag, so it
 * is safe to drop into `dangerouslySetInnerHTML` as-is.
 */
export const THEME_INIT_SCRIPT: string =
  "(function(){var e=document.documentElement;e.dataset.theme='console';try{var t=localStorage.getItem('yp-theme');if(t==='console'||t==='light'||t==='legacy')e.dataset.theme=t}catch(r){}})();";
