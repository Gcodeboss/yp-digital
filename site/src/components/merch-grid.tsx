"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, Clock, PackageCheck, X, ZoomIn } from "lucide-react";
import {
  STATE_COPY,
  formatCad,
  lineKey,
  requiresSize,
  type MerchSku,
  type StockState,
} from "@/lib/merch";
import { trackAddToCart, trackViewItemList } from "@/lib/analytics";
import { useStore } from "./store-provider";

/**
 * The merch client surface. Everything the buyer can touch lives here so the
 * storefront grid and the product page at /store/[sku] share one set of
 * behaviours: one plate, one state line, one add-to-cart. The page files stay
 * server components and render these.
 */

/**
 * A card carries the resolved STATE, never the `SkuStock` it came from. The
 * counts inside that object (sellable, claimed, remaining) are exactly the
 * number the spec says the site may not put in front of a buyer, and a prop
 * handed to a client component is serialised into the page whether or not it
 * is ever drawn. The state is the only part of it the buyer is owed.
 */
export type MerchCardItem = { sku: MerchSku; state: StockState };
export type PlateView = "front" | "back" | "worn";

/* ------------------------------------------------------------------ plates */

/**
 * Every shot in `content/merch.json` is delivered 4:5 on the same backdrop: a
 * vertical wash from #232323 down to #0d0d0d. The plate repeats that wash
 * exactly, so the frame and the photograph are one surface and a piece with no
 * shot yet sits on the identical ground as one that has two.
 *
 * Literal hex rather than the `charcoal` / `coal` utilities on purpose: those
 * tokens are re-pointed by the console and light themes in globals.css, and a
 * re-tinted plate would draw a visible rectangle around every garment.
 */
const PLATE = "linear-gradient(180deg, #232323 0%, #0d0d0d 100%)";
/** Ink that reads on that plate. */
const PLATE_INK = "#f4e3c6";
/** Ink that reads on the amber tag. */
const TAG_INK = "#141414";

/** Ink values for a colourway string, read left to right off the catalogue. */
const COLOURWAY_INK: Record<string, string> = {
  black: "#101010",
  white: "#ffffff",
  grey: "#6d6d6d",
  gray: "#6d6d6d",
  "burnt orange": "#bc4803",
  orange: "#bc4803",
};

function colourwayInks(colourway: string): string[] {
  const inks = colourway
    .split("/")
    .map((part) => COLOURWAY_INK[part.trim().toLowerCase()])
    .filter((ink): ink is string => Boolean(ink));
  return inks.length > 0 ? inks : [PLATE_INK];
}

const WORDMARK: Record<MerchSku["garment"], string[]> = {
  hoodie: ["Hoodie"],
  longsleeve: ["Long", "Sleeve"],
  bandana: ["Bandana"],
};

/**
 * The fallback for a piece with no shot. Every SKU in the catalogue has a front
 * view today, and the bandanas simply have no rear view, but `art` is nullable
 * in the frozen contract so the grid has to hold its shape without one. Rather
 * than a broken frame, the piece gets a specimen tile on the identical plate:
 * garment set in the display face, the colourway named, and the actual ink laid
 * down as chips. Same size, same ground, same weight in the row.
 */
function SpecimenTile({ sku }: { sku: MerchSku }) {
  const inks = colourwayInks(sku.colourway);
  return (
    <div className="absolute inset-0 flex flex-col justify-between p-[9%]">
      <span
        className="font-mono text-[0.55rem] uppercase tracking-[0.3em]"
        style={{ color: `${PLATE_INK}59` }}
      >
        {sku.type}
      </span>

      <span className="font-display text-[clamp(2rem,6.5vw,3.2rem)] uppercase leading-[0.84]">
        {WORDMARK[sku.garment].map((word, i) => (
          <span key={word} className="block" style={{ color: PLATE_INK }}>
            {i === WORDMARK[sku.garment].length - 1 ? (
              <>
                {word}
                <span className="text-amber">.</span>
              </>
            ) : (
              word
            )}
          </span>
        ))}
      </span>

      <span className="flex items-center gap-2.5">
        <span className="flex gap-1">
          {inks.map((ink) => (
            <span
              key={ink}
              className="h-3.5 w-3.5 rounded-[1px]"
              style={{ background: ink, boxShadow: `inset 0 0 0 1px ${PLATE_INK}26` }}
            />
          ))}
        </span>
        <span
          className="font-mono text-[0.6rem] uppercase tracking-[0.22em]"
          style={{ color: `${PLATE_INK}99` }}
        >
          {sku.colourway}
        </span>
      </span>
    </div>
  );
}

/** The lifestyle shot for a view, or null when the view has no photograph. */
export function plateSrc(sku: MerchSku, view: PlateView, wornIndex = 0): string | null {
  if (view === "back") return sku.artBack;
  if (view === "worn") return sku.artLifestyle?.[wornIndex] ?? null;
  return sku.art;
}

export function ProductPlate({
  sku,
  view = "front",
  wornIndex = 0,
  sizes,
  priority = false,
  state,
}: {
  sku: MerchSku;
  view?: PlateView;
  /** Which of `artLifestyle` to show when `view` is "worn". */
  wornIndex?: number;
  sizes: string;
  priority?: boolean;
  /** Pass only where the tag is wanted. Pre-order is tagged, in stock is not. */
  state?: StockState;
}) {
  const src = plateSrc(sku, view, wornIndex);

  return (
    <div
      className="relative aspect-[4/5] overflow-hidden border border-cream/10 transition-colors duration-300 group-hover:border-cream/25"
      style={{ background: PLATE }}
    >
      {src ? (
        /*
          `art`/`artBack` arrive plated and already framed: 4:5, garment
          centred, its own margin baked in. The plate is the same 4:5 and
          repeats the same wash, so `cover` crops nothing at any width and the
          photograph meets the frame edge with no seam.

          `artLifestyle` is a different shape entirely — a full-body model
          shot, not pre-cropped to 4:5 — so `cover` on that view would cut off
          the model's head and feet to fill the frame. It gets `contain`
          instead: the plate's own gradient wash shows as the letterbox, which
          reads as intentional margin rather than a seam, since the photo's
          background is styled to match it.

          `group-hover:scale-[1.03]` only ever fires through the `.group`
          ancestor the card's Link carries (see `MerchCard`), so it is inert
          wherever this plate renders with no such ancestor (`ProductGallery`,
          the PDP hero). Touch devices get no *persistent* hover, so nothing
          here is required to use the card — tap still works exactly as before.
        */
        <Image
          src={src}
          alt={`${sku.name}, ${sku.colourway}, ${view} view`}
          fill
          priority={priority}
          sizes={sizes}
          className={`object-center transition-transform duration-500 ease-out group-hover:scale-[1.03] ${
            view === "worn" ? "object-contain" : "object-cover"
          }`}
        />
      ) : (
        <SpecimenTile sku={sku} />
      )}

      {/* Pre-order is the only state that gets a tag. In stock is the norm and
          says so in the line under the piece, where it does not shout. */}
      {state === "pre-order" && (
        <span
          className="absolute left-0 top-0 px-2.5 py-1.5 font-mono text-[0.55rem] font-bold uppercase tracking-[0.2em]"
          style={{ background: "#f58804", color: TAG_INK }}
        >
          {STATE_COPY["pre-order"].label}
        </span>
      )}
    </div>
  );
}

/**
 * The line-identity thumbnail shared by the cart drawer and the checkout
 * order summary: the garment shot when there is one, the same size-badge
 * fallback when there isn't. One implementation, so a line without artwork
 * reads identically wherever it's shown rather than two fallbacks drifting
 * apart.
 */
export function MerchThumb({
  art,
  size,
  className = "h-16 w-[3.2rem]",
}: {
  art?: string;
  size?: string | null;
  className?: string;
}) {
  return art ? (
    <span
      className={`relative block shrink-0 overflow-hidden border border-white/12 bg-void ${className}`}
    >
      <Image src={art} alt="" fill sizes="52px" className="object-cover object-center" />
    </span>
  ) : (
    <span
      className={`flex shrink-0 items-center justify-center border border-white/12 bg-void font-head text-xs font-bold uppercase tracking-wider text-cream/80 ${className}`}
    >
      {size ?? "1 SZ"}
    </span>
  );
}

/* ------------------------------------------------------------- state copy */

/** Label and window for a state, in the one shape used on every surface. */
export function StateLine({
  state,
  className = "",
}: {
  state: StockState;
  className?: string;
}) {
  const preorder = state === "pre-order";
  const copy = STATE_COPY[state];
  return (
    <p
      className={`inline-flex items-start gap-1.5 font-mono text-[0.65rem] uppercase leading-[1.5] tracking-[0.12em] ${
        preorder ? "text-amber" : "text-warmgray"
      } ${className}`}
    >
      {preorder ? (
        <Clock size={12} className="mt-px shrink-0" />
      ) : (
        <PackageCheck size={12} className="mt-px shrink-0" />
      )}
      <span>
        {copy.label} · {copy.promise}
      </span>
    </p>
  );
}

/**
 * The single sentence that keeps pre-order from reading as a shortage. Kept
 * module-local on purpose: this file is a client module, so a plain value
 * exported from it is a client reference on the server and cannot be read by
 * the product page. The page carries its own copy of the long form.
 */
const PREORDER_SHORT =
  "Paid today, cut for you, shipped the moment the batch is finished.";

/* ------------------------------------------------------------ add to cart */

function useAddToCart(sku: MerchSku, state: StockState) {
  const { add } = useStore();
  const [size, setSize] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const needsSize = requiresSize(sku);

  function choose(next: string) {
    setSize(next);
    setError(false);
  }

  function addToCart() {
    if (needsSize && !size) {
      setError(true);
      return;
    }
    const chosen = needsSize ? size : null;
    add({
      key: lineKey(sku.id, chosen),
      beatId: sku.id,
      title: sku.name,
      license: chosen ? `${sku.type} · ${chosen}` : `${sku.type} · One size`,
      price: sku.priceCad,
      // Front view when the deck has one. Empty string keeps the original
      // contract for the pieces that are not photographed.
      art: sku.art ?? "",
      kind: "merch",
      skuId: sku.id,
      size: chosen,
      quantity: 1,
      unitPrice: sku.priceCad,
      state,
      promise: STATE_COPY[state].promise,
      colourway: sku.colourway,
    });
    // After the cart, never before: a size-validation bail-out above is not an
    // add and must not be counted as one.
    trackAddToCart({
      skuId: sku.id,
      name: sku.name,
      size: chosen,
      priceCad: sku.priceCad,
      state,
    });
  }

  return { size, choose, error, needsSize, addToCart };
}

const SIZE_CHIP =
  "flex min-h-11 min-w-11 flex-1 items-center justify-center rounded-[2px] border px-2 font-head text-xs font-bold uppercase tracking-[0.1em] transition-colors";

function SizeRow({
  sku,
  size,
  choose,
}: {
  sku: MerchSku;
  size: string | null;
  choose: (s: string) => void;
}) {
  return (
    <div className="flex gap-1.5" role="group" aria-label="Choose a size">
      {sku.sizes.map((s) => {
        const active = s === size;
        return (
          <button
            key={s}
            type="button"
            onClick={() => choose(s)}
            aria-pressed={active}
            className={`${SIZE_CHIP} ${
              active
                ? "border-amber bg-amber text-void"
                : "border-cream/20 text-cream/80 active:border-cream"
            }`}
          >
            {s}
          </button>
        );
      })}
    </div>
  );
}

function buyLabel(
  checkoutEnabled: boolean,
  state: StockState,
  size: string | null,
): string {
  if (!checkoutEnabled) return "Checkout opens soon";
  const piece = size ? ` ${size}` : "";
  return state === "pre-order" ? `Pre-order${piece}` : `Add${piece} to cart`;
}

/* ------------------------------------------------------------------- card */

function MerchCard({
  item,
  checkoutEnabled,
  priority,
}: {
  item: MerchCardItem;
  checkoutEnabled: boolean;
  priority: boolean;
}) {
  const { sku, state } = item;
  const { size, choose, error, needsSize, addToCart } = useAddToCart(sku, state);
  const preorder = state === "pre-order";

  return (
    <article className="flex flex-col">
      <Link
        href={`/store/${sku.id}`}
        className="group block rounded-[2px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber"
      >
        <ProductPlate
          sku={sku}
          sizes="(min-width:1280px) 420px, (min-width:1024px) 32vw, (min-width:640px) 46vw, 90vw"
          priority={priority}
          state={state}
        />

        <div className="mt-5 flex items-baseline justify-between gap-4">
          <h3 className="font-head text-base font-bold leading-tight text-cream transition-colors duration-300 group-hover:text-amber">
            {sku.name}
          </h3>
          <span className="shrink-0 font-display text-xl leading-none text-cream">
            {formatCad(sku.priceCad)}
          </span>
        </div>
        <p className="mt-1 font-mono text-[0.62rem] uppercase tracking-[0.22em] text-warmgray">
          {sku.colourway}
        </p>
      </Link>

      <StateLine state={state} className="mt-3" />
      {preorder && (
        <p className="mt-1.5 text-[0.78rem] leading-relaxed text-warmgray">
          {PREORDER_SHORT}
        </p>
      )}

      <div className="mt-5">
        {needsSize ? (
          <SizeRow sku={sku} size={size} choose={choose} />
        ) : (
          <p className="flex min-h-11 items-center justify-center rounded-[2px] border border-cream/12 px-3 font-mono text-[0.62rem] uppercase tracking-[0.2em] text-cream/70">
            One size · {sku.colourway}
          </p>
        )}

        <button
          type="button"
          onClick={addToCart}
          disabled={!checkoutEnabled}
          className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-[2px] bg-amber px-4 font-head text-xs font-bold uppercase tracking-[0.14em] text-void disabled:pointer-events-none disabled:opacity-40"
        >
          {size ? <Check size={14} /> : null}
          {buyLabel(checkoutEnabled, state, size)}
        </button>

        {error && (
          <p
            role="alert"
            className="mt-2 text-center font-mono text-[0.62rem] uppercase tracking-[0.12em] text-amber"
          >
            Pick a size first
          </p>
        )}
      </div>
    </article>
  );
}

/**
 * Five pieces, not a catalogue. One column on a phone; from 640px up, a
 * six-track grid gives the two photographed pieces half a row each and sets
 * the remaining three underneath, three up. That ratio carries down into
 * tablet width rather than falling back to a plain, un-composed 2-up grid —
 * one composition, one breakpoint jump. At exactly 5 items the split (3+3,
 * then 2+2+2) fills both rows exactly, so nothing reflows into an orphan and
 * nothing needs a hover to be usable.
 */
export function MerchGrid({
  items,
  checkoutEnabled = true,
}: {
  items: MerchCardItem[];
  checkoutEnabled?: boolean;
}) {
  /**
   * The storefront was seen. Keyed on the SKU set rather than firing on every
   * render, so a re-render from a cart change is not a second view. GA4 needs
   * this stage or its funnel starts at add-to-cart and the drop-off that
   * matters most — looked, did not add — is invisible.
   */
  const listKey = items.map((i) => i.sku.id).join(",");
  useEffect(() => {
    if (items.length === 0) return;
    trackViewItemList(
      items.map((i) => ({
        skuId: i.sku.id,
        name: i.sku.name,
        priceCad: i.sku.priceCad,
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey]);

  if (items.length === 0) {
    return (
      <p className="border border-cream/10 bg-charcoal p-8 text-center font-mono text-[0.7rem] uppercase tracking-[0.2em] text-warmgray">
        The drop is not open yet.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-14 sm:grid-cols-6 sm:gap-y-16 lg:gap-x-8">
      {items.map((item, i) => (
        <div key={item.sku.id} className={i < 2 ? "sm:col-span-3" : "sm:col-span-2"}>
          <MerchCard
            item={item}
            checkoutEnabled={checkoutEnabled}
            priority={i < 2}
          />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------- product page: gallery */

/**
 * Front and back on one plate. The toggle only appears where the deck gives a
 * rear view, and it is a pair of real buttons rather than a hover or a swipe.
 * On a hover-capable desktop, the plate also opens an enlarged view of
 * whichever view is currently selected — a real dialog, not a navigation, so
 * dismissing it leaves the selected view and scroll position untouched.
 */
export function ProductGallery({ sku }: { sku: MerchSku }) {
  const [view, setView] = useState<PlateView>("front");
  const [wornIndex, setWornIndex] = useState(0);
  const [canHover, setCanHover] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);

  useEffect(() => {
    const check = () =>
      setCanHover(
        window.matchMedia("(hover: hover) and (pointer: fine)").matches,
      );
    check();
  }, []);

  useEffect(() => {
    if (!zoomOpen) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoomOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [zoomOpen]);

  /* Only the views this piece actually has. A bandana has one plate and a
     styled shot; a hoodie has all three. The toggle is skipped entirely at
     one view, so nothing renders a row of a single dead button. */
  const shots = sku.artLifestyle ?? [];
  const views: PlateView[] = [
    "front",
    ...(sku.artBack ? (["back"] as const) : []),
    ...(shots.length > 0 ? (["worn"] as const) : []),
  ];
  const active = views.includes(view) ? view : "front";
  const activeSrc = plateSrc(sku, active, wornIndex);

  return (
    <div>
      <div className="relative">
        <ProductPlate
          sku={sku}
          view={active}
          wornIndex={wornIndex}
          sizes="(min-width:1024px) 600px, 92vw"
          priority
        />
        {canHover && activeSrc && (
          <button
            type="button"
            onClick={() => setZoomOpen(true)}
            aria-label="View larger image"
            className="absolute bottom-3 right-3 flex h-11 w-11 items-center justify-center rounded-full bg-void/70 text-cream backdrop-blur transition-colors hover:bg-void/90 hover:text-amber"
          >
            <ZoomIn size={18} />
          </button>
        )}
      </div>

      {zoomOpen && activeSrc && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${sku.name}, enlarged`}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-6 sm:p-12"
          onClick={() => setZoomOpen(false)}
        >
          <button
            type="button"
            onClick={() => setZoomOpen(false)}
            aria-label="Close enlarged image"
            className="absolute right-5 top-5 flex h-11 w-11 items-center justify-center text-cream hover:text-amber"
          >
            <X size={24} />
          </button>
          <div
            className="relative h-full w-full max-w-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src={activeSrc}
              alt={`${sku.name}, ${sku.colourway}, ${active} view, enlarged`}
              fill
              sizes="90vw"
              className="object-contain"
            />
          </div>
        </div>
      )}

      {views.length > 1 && (
        <div className="mt-3 flex gap-2">
          {views.map((v) => {
            const on = v === active;
            return (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={on}
                className={`flex min-h-11 flex-1 items-center justify-center rounded-[2px] border font-mono text-[0.62rem] uppercase tracking-[0.2em] transition-colors ${
                  on ? "border-amber text-amber" : "border-cream/15 text-warmgray"
                }`}
              >
                {v}
              </button>
            );
          })}
        </div>
      )}

      {/* Several worn shots (two models, front and back) share the one "worn"
          view, picked from a thumbnail strip rather than a wider toggle row
          that would not fit six labels on a phone. */}
      {active === "worn" && shots.length > 1 && (
        <div
          role="group"
          aria-label="Choose a worn shot"
          className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6"
        >
          {shots.map((src, i) => {
            const on = i === wornIndex;
            return (
              <button
                key={src}
                type="button"
                onClick={() => setWornIndex(i)}
                aria-pressed={on}
                aria-label={`Worn shot ${i + 1} of ${shots.length}`}
                className={`relative aspect-[4/5] min-h-11 overflow-hidden rounded-[2px] border transition-colors ${
                  on ? "border-amber" : "border-cream/15 hover:border-cream/40"
                }`}
                style={{ background: PLATE }}
              >
                <Image
                  src={src}
                  alt=""
                  fill
                  sizes="(min-width:640px) 96px, 22vw"
                  className="object-contain"
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------- product page: buy */

/**
 * The same add-to-cart the card runs, at the size a product page deserves. One
 * cart, one line key, one payload, whichever surface the buyer used.
 *
 * Also owns the mobile sticky buy bar: one `useAddToCart` instance backs both
 * the in-page controls and the bar, so a size chosen in one is the size the
 * other sees, and the bar's validation is literally the same `addToCart` call
 * the in-page button makes — not a second implementation that could drift.
 */
export function BuyPanel({
  sku,
  state,
  checkoutEnabled,
}: {
  sku: MerchSku;
  state: StockState;
  checkoutEnabled: boolean;
}) {
  const { size, choose, error, needsSize, addToCart } = useAddToCart(sku, state);
  const { cartOpen } = useStore();
  const panelRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  /* Scroll-position check, same idiom as `site-header.tsx` / `sticky-cta.tsx`
     rather than a new IntersectionObserver pattern. The bar shows once the
     panel has scrolled fully above the viewport, and hides again near the
     end of the page so it never sits over the footer/related-pieces links. */
  useEffect(() => {
    function onScroll() {
      const panel = panelRef.current;
      if (!panel) return;
      const pastPanel = panel.getBoundingClientRect().bottom < 0;
      const nearBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 32;
      setStuck(pastPanel && !nearBottom);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  function buySticky() {
    if (needsSize && !size) {
      addToCart(); // same validation path as the in-page button: sets `error`
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    addToCart();
  }

  return (
    <div ref={panelRef}>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <span className="font-mono text-[0.62rem] uppercase tracking-[0.22em] text-warmgray">
          {needsSize ? "Size" : "One size"}
        </span>
        {needsSize && (
          <span className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-warmgray">
            Relaxed, boxy fit
          </span>
        )}
      </div>

      {needsSize ? (
        <SizeRow sku={sku} size={size} choose={choose} />
      ) : (
        /* Bandanas are cut one size, so the colourway stands where a size
           selector would be rather than leaving an empty slot. */
        <p className="flex min-h-12 items-center justify-center rounded-[2px] border border-cream/12 px-4 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-cream/75">
          {sku.colourway}
        </p>
      )}

      <button
        type="button"
        onClick={addToCart}
        disabled={!checkoutEnabled}
        className="mt-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-[2px] bg-amber px-5 font-head text-sm font-bold uppercase tracking-[0.14em] text-void disabled:pointer-events-none disabled:opacity-40"
      >
        {size ? <Check size={16} /> : null}
        {buyLabel(checkoutEnabled, state, size)} ·{" "}
        {formatCad(sku.priceCad)}
      </button>

      {error && (
        <p
          role="alert"
          className="mt-2 text-center font-mono text-[0.65rem] uppercase tracking-[0.12em] text-amber"
        >
          Pick a size first
        </p>
      )}

      {/* Mobile-only: never renders at the desktop breakpoint, cart-drawer
          open, or once the buyer nears the footer. */}
      {stuck && !cartOpen && checkoutEnabled && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-coal/95 px-4 pt-3 backdrop-blur lg:hidden"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <div className="mx-auto flex max-w-lg items-center gap-3">
            <span className="shrink-0 font-display text-xl leading-none text-cream">
              {formatCad(sku.priceCad)}
            </span>
            <button
              type="button"
              onClick={buySticky}
              className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-[2px] bg-amber px-4 font-head text-xs font-bold uppercase tracking-[0.14em] text-void"
            >
              {size ? <Check size={14} /> : null}
              {buyLabel(checkoutEnabled, state, size)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
