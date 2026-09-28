"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from "react";
import type { StockState } from "@/lib/merch";
import { RELEASES } from "@/lib/content";
import { YouTubeEngine, youtubeVideoId } from "./youtube-player";

/**
 * One cart, three kinds of product: beats, royalty-free sample packs and tour
 * merch. The original six fields are what the beat and pack flows write and are
 * left exactly as they were. Every field below `art` is OPTIONAL and is only
 * ever set by the merch flow, so a pack line hydrated from an older `yp_cart`
 * still satisfies the type and still renders through the same path it always did.
 *
 * `price` is the LINE subtotal (unit price x quantity). Keeping that invariant is
 * what lets the provider's `total` stay a plain sum over `price`. Packs, which
 * never set `quantity`, are unaffected.
 */
export type CartLine = {
  key: string; // beatId:licenseId. Merch uses lineKey(skuId, size)
  beatId: string;
  title: string;
  license: string;
  price: number;
  art: string;

  /* ---- merch-only, all optional ---- */
  /** Present on tour-merch lines. Absent on beats and sample packs. */
  kind?: "merch";
  /** Catalogue SKU id from `content/merch.json`. */
  skuId?: string;
  /** `null` for one-size pieces (bandanas). */
  size?: string | null;
  quantity?: number;
  /** Unit price, so quantity edits can recompute `price` without a lookup. */
  unitPrice?: number;
  /** Stock state at the moment the line was added. Shown again in the drawer. */
  state?: StockState;
  /** Fulfilment promise for that state, e.g. "Ships within 5 business days". */
  promise?: string;
  /** Shown in place of a size on one-size pieces. */
  colourway?: string;
};

/**
 * The four original fields are unchanged: roughly ten components read `now`,
 * and the two below are additive and optional.
 */
export type NowPlaying = {
  id: string;
  title: string;
  subtitle: string;
  art: string;
  /**
   * What the player actually plays. Accepts a bare YouTube video id or a full
   * YouTube URL. Absent means there is nothing to play in the page, and the
   * player degrades to `link` rather than offering a control that does nothing.
   */
  youtubeId?: string;
  /** Where to send a listener when the track cannot play in the page. */
  link?: string;
} | null;

/** Real playback position, sourced from the player rather than a timer. */
export type Playhead = {
  /** Seconds elapsed. */
  position: number;
  /** Seconds total, 0 until the player reports it. */
  duration: number;
  /** Set when the player refused the track. Cleared on the next play. */
  error: string | null;
};

const IDLE: Playhead = { position: 0, duration: 0, error: null };

/**
 * A separate context on purpose. The playhead ticks four times a second and
 * only the mini player cares, so it must not churn the cart context that the
 * rest of the site reads.
 */
const PlayheadContext = createContext<Playhead>(IDLE);

export function usePlayhead(): Playhead {
  return useContext(PlayheadContext);
}

/**
 * Bridge to the catalogue for releases that carry a YouTube link but no
 * `youtubeId` yet. Anything the caller passes wins over this.
 */
function catalogueFallback(id: string): { source?: string; link?: string } {
  const release = RELEASES.find((r) => r.id === id);
  if (!release) return {};
  return {
    source: release.youtube,
    link: release.spotify ?? release.youtube ?? release.apple,
  };
}

/** Flat per-line cap. Deliberately not tied to remaining stock: the site cannot
 *  see the room at the show, so a stock-derived cap would leak a number we
 *  cannot stand behind. */
export const MAX_LINE_QUANTITY = 10;

function clampQty(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_LINE_QUANTITY, Math.max(1, Math.floor(n)));
}

function priced(line: CartLine, quantity: number): CartLine {
  const unit = line.unitPrice ?? line.price;
  return { ...line, quantity, price: unit * quantity };
}

type State = { lines: CartLine[] };
type Action =
  | { type: "add"; line: CartLine }
  | { type: "remove"; key: string }
  | { type: "setQuantity"; key: string; quantity: number }
  | { type: "clear" }
  | { type: "hydrate"; lines: CartLine[] };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "add": {
      const existing = state.lines.find((l) => l.key === action.line.key);
      if (existing) {
        // Beats and packs keep the original behaviour: a duplicate key is a
        // no-op. Only quantity-bearing (merch) lines accumulate.
        if (existing.quantity === undefined || action.line.quantity === undefined)
          return state;
        const quantity = clampQty(existing.quantity + (action.line.quantity || 1));
        return {
          lines: state.lines.map((l) =>
            l.key === action.line.key ? priced(l, quantity) : l,
          ),
        };
      }
      return { lines: [...state.lines, action.line] };
    }
    case "remove":
      return { lines: state.lines.filter((l) => l.key !== action.key) };
    case "setQuantity": {
      if (action.quantity < 1)
        return { lines: state.lines.filter((l) => l.key !== action.key) };
      return {
        lines: state.lines.map((l) =>
          l.key === action.key && l.quantity !== undefined
            ? priced(l, clampQty(action.quantity))
            : l,
        ),
      };
    }
    case "clear":
      return { lines: [] };
    case "hydrate":
      return { lines: action.lines };
    default:
      return state;
  }
}

type Ctx = {
  lines: CartLine[];
  count: number;
  total: number;
  add: (line: CartLine) => void;
  remove: (key: string) => void;
  /** Merch only. Lines without a `quantity` ignore it, and 0 removes the line. */
  setQuantity: (key: string, quantity: number) => void;
  clear: () => void;
  cartOpen: boolean;
  setCartOpen: (v: boolean) => void;
  now: NowPlaying;
  playing: boolean;
  /**
   * Starts a track. Returns false when there is no playable source, so a caller
   * can hide its own control instead of rendering a dead button.
   */
  play: (n: NonNullable<NowPlaying>) => boolean;
  toggle: () => void;
  stop: () => void;
};

/** True when `play` would actually produce audio for this track. */
export function isPlayable(n: NonNullable<NowPlaying>): boolean {
  return Boolean(
    youtubeVideoId(n.youtubeId) ?? youtubeVideoId(catalogueFallback(n.id).source),
  );
}

const StoreContext = createContext<Ctx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { lines: [] });
  const [cartOpen, setCartOpen] = useState(false);
  const [now, setNow] = useState<NowPlaying>(null);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState<Playhead>(IDLE);
  /**
   * The IFrame API script is third-party weight, so it is not fetched until the
   * first real play. Once mounted the engine stays, which keeps a track change
   * from tearing down and rebuilding the iframe.
   */
  const [engineMounted, setEngineMounted] = useState(false);

  // persist cart
  useEffect(() => {
    try {
      const raw = localStorage.getItem("yp_cart");
      if (raw) dispatch({ type: "hydrate", lines: JSON.parse(raw) });
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("yp_cart", JSON.stringify(state.lines));
    } catch {}
  }, [state.lines]);

  /* ---------------- player callbacks ----------------
   * Every one of these is driven by the player's own events or by reading the
   * player back. Nothing here runs on a timer that assumes a track length. */

  const handleProgress = useCallback((position: number, duration: number) => {
    setPlayhead((prev) => ({
      position,
      duration: duration > 0 ? duration : prev.duration,
      error: prev.error,
    }));
  }, []);

  const handlePlayingChange = useCallback((next: boolean) => {
    setPlaying(next);
  }, []);

  const handleEnded = useCallback(() => {
    // The track finished on its own. Reflect that instead of leaving the UI
    // mid-play with a bar stuck at the end.
    setPlaying(false);
    setPlayhead((prev) => ({ ...prev, position: 0 }));
  }, []);

  const handleError = useCallback((message: string) => {
    setPlaying(false);
    setPlayhead((prev) => ({ ...prev, error: message }));
  }, []);

  const value = useMemo<Ctx>(() => {
    const total = state.lines.reduce((s, l) => s + l.price, 0);
    return {
      lines: state.lines,
      count: state.lines.length,
      total,
      add: (line) => {
        dispatch({ type: "add", line });
        setCartOpen(true);
      },
      remove: (key) => dispatch({ type: "remove", key }),
      setQuantity: (key, quantity) =>
        dispatch({ type: "setQuantity", key, quantity }),
      clear: () => dispatch({ type: "clear" }),
      cartOpen,
      setCartOpen,
      now,
      playing,
      play: (n) => {
        const fallback = catalogueFallback(n.id);
        const source =
          youtubeVideoId(n.youtubeId) ?? youtubeVideoId(fallback.source);
        const link = n.link ?? fallback.link;

        setPlayhead(IDLE);

        if (!source) {
          // Degrade honestly. With somewhere to send the listener the player
          // opens showing that link; with nothing at all it refuses, so no
          // control is ever offered that cannot do anything.
          if (!link) return false;
          setNow({ ...n, youtubeId: undefined, link });
          setPlaying(false);
          return false;
        }

        setEngineMounted(true);
        setNow({ ...n, youtubeId: source, link });
        setPlaying(true);
        return true;
      },
      toggle: () => {
        if (!now?.youtubeId) return;
        setPlaying((p) => !p);
      },
      stop: () => {
        setPlaying(false);
        setNow(null);
        setPlayhead(IDLE);
      },
    };
  }, [state.lines, cartOpen, now, playing]);

  return (
    <StoreContext.Provider value={value}>
      <PlayheadContext.Provider value={playhead}>
        {children}
      </PlayheadContext.Provider>
      {engineMounted && (
        <YouTubeEngine
          videoId={now?.youtubeId ?? null}
          playing={playing}
          onPlayingChange={handlePlayingChange}
          onEnded={handleEnded}
          onProgress={handleProgress}
          onError={handleError}
        />
      )}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
