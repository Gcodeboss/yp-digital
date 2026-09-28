"use client";

import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Clock, Lock, Minus, PackageCheck, Plus, ShoppingBag, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { STATE_COPY, formatCad } from "@/lib/merch";
import { MerchThumb } from "./merch-grid";
import { MAX_LINE_QUANTITY, useStore, type CartLine } from "./store-provider";
import { Button } from "./ui";

function MerchLine({ line }: { line: CartLine }) {
  const { remove, setQuantity, setCartOpen } = useStore();
  const quantity = line.quantity ?? 1;
  const state = line.state ?? "in-stock";
  const preorder = state === "pre-order";
  const promise = line.promise ?? STATE_COPY[state].promise;
  const href = line.skuId ? `/store/${line.skuId}` : null;

  // The garment shots are plated on their own dark wash, so the thumbnail keeps
  // the same ground. A line added before the photography landed carries an empty
  // `art` and falls back to the size badge it always had.
  const thumb = <MerchThumb art={line.art} size={line.size} />;

  return (
    <li className="border border-white/8 bg-charcoal p-3">
      <div className="flex items-start gap-3">
        {href ? (
          <Link href={href} onClick={() => setCartOpen(false)}>
            {thumb}
          </Link>
        ) : (
          thumb
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate font-head font-bold text-cream">
            {href ? (
              <Link href={href} onClick={() => setCartOpen(false)}>
                {line.title}
              </Link>
            ) : (
              line.title
            )}
            {line.colourway && (
              <span className="text-warmgray"> · {line.colourway}</span>
            )}
          </p>
          <p className="font-mono text-[0.7rem] uppercase tracking-wider text-warmgray">
            {line.size ? `Size ${line.size}` : "One size"}
          </p>
        </div>

        <span className="font-head font-bold text-cream">
          {formatCad(line.price)}
        </span>
        <button
          type="button"
          onClick={() => remove(line.key)}
          aria-label={`Remove ${line.title}`}
          className="text-warmgray hover:text-amber"
        >
          <X size={16} />
        </button>
      </div>

      {/* Each line states its own state and its own window, so a mixed cart
          shows one of each, side by side. */}
      <p
        className={`mt-3 inline-flex items-start gap-1.5 font-mono text-[0.65rem] uppercase leading-[1.5] tracking-[0.12em] ${
          preorder ? "text-amber" : "text-warmgray"
        }`}
      >
        {preorder ? (
          <Clock size={12} className="mt-px shrink-0" />
        ) : (
          <PackageCheck size={12} className="mt-px shrink-0" />
        )}
        <span>
          {STATE_COPY[state].label} · {promise}
        </span>
      </p>
      {preorder && (
        <p className="mt-1 text-[0.72rem] leading-relaxed text-warmgray">
          Made to order once the run is claimed. Paid in full today.
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setQuantity(line.key, quantity - 1)}
          aria-label="Decrease quantity"
          className="flex h-8 w-8 items-center justify-center border border-white/15 text-cream/80 transition-colors hover:border-cream/60 hover:text-cream"
        >
          <Minus size={13} />
        </button>
        <span
          aria-live="polite"
          className="min-w-8 text-center font-head text-sm font-bold text-cream"
        >
          {quantity}
        </span>
        <button
          type="button"
          onClick={() => setQuantity(line.key, quantity + 1)}
          disabled={quantity >= MAX_LINE_QUANTITY}
          aria-label="Increase quantity"
          className="flex h-8 w-8 items-center justify-center border border-white/15 text-cream/80 transition-colors hover:border-cream/60 hover:text-cream disabled:pointer-events-none disabled:opacity-30"
        >
          <Plus size={13} />
        </button>
        {line.unitPrice !== undefined && quantity > 1 && (
          <span className="ml-1 font-mono text-[0.65rem] uppercase tracking-wider text-warmgray">
            {formatCad(line.unitPrice)} each
          </span>
        )}
      </div>
    </li>
  );
}

function DigitalLine({ line }: { line: CartLine }) {
  const { remove } = useStore();
  return (
    <li className="flex items-center gap-3 border border-white/8 bg-charcoal p-3">
      <Image
        src={line.art}
        alt=""
        width={56}
        height={56}
        className="h-14 w-14 object-cover"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-head font-bold text-cream">{line.title}</p>
        <p className="font-mono text-[0.7rem] uppercase tracking-wider text-amber">
          {line.license}
        </p>
      </div>
      <span className="font-head font-bold text-cream">${line.price}</span>
      <button
        type="button"
        onClick={() => remove(line.key)}
        aria-label="Remove"
        className="text-warmgray hover:text-amber"
      >
        <X size={16} />
      </button>
    </li>
  );
}

export function CartDrawer() {
  const { cartOpen, setCartOpen, lines } = useStore();

  const merchLines = lines.filter((l) => l.kind === "merch");
  // Non-merch lines are not part of the merch Checkout Session, because
  // that route resolves prices from the merch catalogue only. They stay in the
  // cart rather than being silently dropped into a charge that never covers them.
  const heldLines = lines.filter((l) => l.kind !== "merch");
  const payable = merchLines.reduce((sum, l) => sum + l.price, 0);
  const hasPreorder = merchLines.some((l) => l.state === "pre-order");
  const hasInStock = merchLines.some((l) => (l.state ?? "in-stock") === "in-stock");

  return (
    <AnimatePresence>
      {cartOpen && (
        <motion.div
          className="fixed inset-0 z-[60]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setCartOpen(false)}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-white/10 bg-coal"
          >
            <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <span className="flex items-center gap-2 font-head text-sm font-bold uppercase tracking-[0.2em] text-cream">
                <ShoppingBag size={16} className="text-amber" /> Your Cart
              </span>
              <button
                onClick={() => setCartOpen(false)}
                aria-label="Close cart"
                className="text-warmgray hover:text-cream"
              >
                <X size={20} />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {lines.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <p className="font-display text-2xl uppercase text-cream">
                    Cart is empty
                  </p>
                  <p className="mt-2 text-sm text-warmgray">
                    The tour drop is five pieces deep. Start there.
                  </p>
                  <div className="mt-6 flex gap-3">
                    <Button
                      href="/store"
                      variant="secondary"
                      onClick={() => setCartOpen(false)}
                    >
                      Shop the drop
                    </Button>
                    <Button
                      href="/music"
                      variant="ghost"
                      onClick={() => setCartOpen(false)}
                    >
                      Hear the music
                    </Button>
                  </div>
                </div>
              ) : (
                <ul className="space-y-3">
                  {lines.map((l) =>
                    l.kind === "merch" ? (
                      <MerchLine key={l.key} line={l} />
                    ) : (
                      <DigitalLine key={l.key} line={l} />
                    ),
                  )}
                </ul>
              )}
            </div>

            {lines.length > 0 && (
              <footer className="border-t border-white/10 px-5 py-5">
                {hasPreorder && (
                  <p className="mb-4 border border-amber/30 bg-amber/5 px-3 py-2.5 font-mono text-[0.65rem] uppercase leading-[1.6] tracking-[0.1em] text-cream/80">
                    {hasInStock
                      ? "This cart mixes pieces that ship now with pre-orders. Each line ships on its own window, shown above, and you pay for all of it today."
                      : "Made to order. Every piece here is cut once the run is claimed and ships in 4 to 6 weeks. You pay in full today."}
                  </p>
                )}

                {heldLines.length > 0 && (
                  <p className="mb-4 border border-white/12 px-3 py-2.5 font-mono text-[0.65rem] uppercase leading-[1.6] tracking-[0.1em] text-warmgray">
                    {heldLines.length === 1 ? "One item" : `${heldLines.length} items`}{" "}
                    in your cart {heldLines.length === 1 ? "is" : "are"} not part of
                    this payment and {heldLines.length === 1 ? "was" : "were"} not
                    charged.
                  </p>
                )}

                <div className="mb-4 flex items-center justify-between">
                  <span className="font-mono text-xs uppercase tracking-widest text-warmgray">
                    {heldLines.length > 0 ? "Merch total" : "Total"}
                  </span>
                  <span className="font-display text-3xl text-cream">
                    {formatCad(payable)}
                  </span>
                </div>

                <Button
                  href="/store/checkout"
                  onClick={() => setCartOpen(false)}
                  disabled={merchLines.length === 0}
                  className="w-full"
                >
                  {merchLines.length === 0
                    ? "Nothing here to check out yet"
                    : "Secure checkout"}
                </Button>

                <p className="mt-3 flex items-center justify-center gap-1.5 text-center font-mono text-[0.65rem] uppercase tracking-wider text-warmgray">
                  <Lock size={11} /> Square-secured · card details never touch
                  this site
                </p>
                <p className="mt-2 text-center text-[0.72rem] leading-relaxed text-warmgray">
                  U.S. and other international orders may incur customs duties,
                  taxes, or carrier fees. Those charges are not included in the
                  total above and are due on delivery.
                </p>
              </footer>
            )}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Rendered ONLY by `/store/success`, and only after that page has confirmed a
 * paid order server-side. `keys` are the line keys Square actually charged
 * for, so `yp_cart` loses exactly those lines and nothing else. An abandoned or
 * cancelled checkout never renders this, so the cart survives the round trip
 * intact.
 */
export function CartClearOnConfirmedPayment({ keys }: { keys: string[] }) {
  const { remove } = useStore();
  const cleared = useRef(false);
  useEffect(() => {
    if (cleared.current) return;
    cleared.current = true;
    for (const key of keys) remove(key);
  }, [keys, remove]);
  return null;
}

/** Reopens the drawer from a page. Used by `/store/cancelled`. */
export function OpenCartButton({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const { setCartOpen } = useStore();
  return (
    <Button onClick={() => setCartOpen(true)} className={className}>
      {children}
    </Button>
  );
}
