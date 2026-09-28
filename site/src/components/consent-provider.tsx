"use client";

/**
 * The one place that decides whether analytics may run.
 *
 * Every loader and every event helper reads this and nothing else. The
 * alternative — each caller checking `localStorage` for itself — gives three
 * places that can disagree, and makes "change your mind from the footer"
 * impossible without a full reload.
 *
 * The decision is an external store, not React state, so it is read through
 * `useSyncExternalStore`. That buys three things at once:
 *
 *   - No hydration mismatch. The server snapshot is always `unknown`, and
 *     React swaps to the real value after hydration without us reaching for a
 *     setState inside an effect.
 *   - Cross-tab agreement. The `storage` event means accepting in one tab
 *     stops the banner in the others, instead of leaving two tabs disagreeing
 *     about whether the visitor was asked.
 *   - `hydrated` rides along in the snapshot, so a visitor who already
 *     declined never sees the banner flash before the stored answer is read.
 *
 * Spec: openspec/changes/analytics-ga4-clarity-consent/specs/visitor-analytics/spec.md
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type ConsentState = "unknown" | "granted" | "denied";

const STORAGE_KEY = "yp_analytics_consent";

/**
 * Configured ids. Read at module scope because `NEXT_PUBLIC_` values are
 * substituted at build time — there is no runtime lookup to do, and an
 * unconfigured deploy must be able to prove it asks for nothing.
 */
export const GA_ID = (process.env.NEXT_PUBLIC_GA_ID ?? "").trim();
export const CLARITY_ID = (process.env.NEXT_PUBLIC_CLARITY_ID ?? "").trim();
/**
 * Public twin of the server-side `HUBSPOT_PORTAL_ID`. Same value, and neither
 * is a secret — it rides in the tracking script URL on every page. They are
 * kept as separate names so the form-delivery routes carry on reading a server
 * variable and cannot be broken by a change to how public config is handled.
 */
export const HUBSPOT_PORTAL_ID = (
  process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID ?? ""
).trim();

/** Nothing to consent to means no banner, and no gate to evaluate. */
export const ANALYTICS_CONFIGURED =
  GA_ID !== "" || CLARITY_ID !== "" || HUBSPOT_PORTAL_ID !== "";

/* ------------------------------------------------------------ the store */

type Snapshot = { consent: ConsentState; hydrated: boolean };

/** Server and first-hydration render. Nothing loads in this state. */
const SERVER_SNAPSHOT: Snapshot = { consent: "unknown", hydrated: false };

/**
 * `getSnapshot` must return a referentially stable value while nothing has
 * changed, or React re-renders forever. Hence the cache.
 */
let cached: Snapshot = SERVER_SNAPSHOT;
const listeners = new Set<() => void>();

function readStored(): ConsentState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === "granted" || raw === "denied" ? raw : "unknown";
  } catch {
    // Private mode, blocked storage, or a browser that throws on access.
    // Unknown is the safe reading: ask again, load nothing meanwhile.
    return "unknown";
  }
}

function getSnapshot(): Snapshot {
  const consent = readStored();
  if (cached.hydrated && cached.consent === consent) return cached;
  cached = { consent, hydrated: true };
  return cached;
}

function getServerSnapshot(): Snapshot {
  return SERVER_SNAPSHOT;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab answered the same question. Without this the banner would
  // stay up here, and a second "accept" would be recorded.
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function store(next: ConsentState): void {
  try {
    if (next === "unknown") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // A decision we cannot persist still has to hold for this page view, so
    // push it into the cache by hand before telling React to re-read.
    cached = { consent: next, hydrated: true };
  }
  for (const listener of listeners) listener();
}

/* --------------------------------------------------------- the context */

type ConsentContextValue = {
  consent: ConsentState;
  /** True only when a banner should be on screen right now. */
  askingNow: boolean;
  accept: () => void;
  decline: () => void;
  /** Reopens the question from the footer, whatever was decided before. */
  reopen: () => void;
};

const ConsentContext = createContext<ConsentContextValue>({
  consent: "unknown",
  askingNow: false,
  accept: () => {},
  decline: () => {},
  reopen: () => {},
});

export function useConsent(): ConsentContextValue {
  return useContext(ConsentContext);
}

export function ConsentProvider({ children }: { children: ReactNode }) {
  const { consent, hydrated } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  /** Set when the footer control reopens a question already answered. */
  const [reopened, setReopened] = useState(false);

  const accept = useCallback(() => {
    store("granted");
    setReopened(false);
  }, []);

  const decline = useCallback(() => {
    store("denied");
    setReopened(false);
  }, []);

  const reopen = useCallback(() => setReopened(true), []);

  const value = useMemo<ConsentContextValue>(
    () => ({
      consent,
      askingNow:
        ANALYTICS_CONFIGURED && hydrated && (consent === "unknown" || reopened),
      accept,
      decline,
      reopen,
    }),
    [consent, hydrated, reopened, accept, decline, reopen],
  );

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}
