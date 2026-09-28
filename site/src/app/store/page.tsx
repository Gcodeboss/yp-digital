import type { Metadata } from "next";
import { Clock, Lock, Package, Truck } from "lucide-react";
import { MerchGrid, type MerchCardItem } from "@/components/merch-grid";
import { Section } from "@/components/ui";
import { MERCH, STATE_COPY, resolveStock, sellable } from "@/lib/merch";
import { getClaimedCounts, isSquareConfigured } from "@/lib/square";

export const metadata: Metadata = {
  title: "Store · The Tour Drop",
  description:
    "Five pieces cut once for the Yanchan Produced tour: a heavyweight hoodie, two long sleeves and two bandanas carrying the mridangam emblem. Every piece states its own ship window before you pay.",
  alternates: { canonical: "/store" },
};

/**
 * Rendered per request (it reads `searchParams`), so a SKU can flip between
 * in-stock and pre-order, or be repriced in Square, without a deploy.
 * `getClaimedCounts` holds its own short-lived cache and falls back to the last
 * good read when Square is unreachable, so this never errors the page.
 */

const PERKS = [
  { icon: Truck, label: "Ships worldwide from Toronto" },
  { icon: Package, label: "One tour run · 270 pieces" },
  { icon: Clock, label: "Every piece states its own ship window" },
];

export default async function StorePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // The checkout link's cancel path points at /store/cancelled, which is
  // the live return path. This `?checkout=cancelled` branch is a fallback for a
  // hand-typed or legacy link, so the "nothing was charged" reassurance exists on
  // both. Corrected 2026-09-14: an earlier comment here had it the other way round.
  const cancelled = (await searchParams).checkout === "cancelled";
  const checkoutEnabled = isSquareConfigured();

  // "Square not configured" is NOT the same as "stock unknown". Nothing can have
  // been claimed through a site that cannot take payment, so claimed is genuinely
  // zero and every piece is in stock. Only a FAILED read leaves stock unknown.
  // Treating the unconfigured case as unknown made all five SKUs read "pre-order,
  // ships in 4 to 6 weeks" while 200 pieces existed, which is a false claim about
  // the product.
  let claimed: Record<string, number> = {};
  let stockKnown = true;
  if (checkoutEnabled) {
    try {
      claimed = await getClaimedCounts();
    } catch {
      stockKnown = false;
    }
  }

  const items: MerchCardItem[] = MERCH.map((sku) => ({
    sku,
    // When the claimed count cannot be read we fall back to pre-order rather
    // than in-stock: the made-to-order window is the promise we can always keep.
    // Only the resolved state crosses to the client, never the counts behind it.
    state: resolveStock(sku, stockKnown ? (claimed[sku.id] ?? 0) : sellable(sku))
      .state,
  }));
  const anyPreorder = items.some((i) => i.state === "pre-order");

  return (
    <>
      {/* The opening is deliberately thin. Five pieces do not need a masthead,
          they need room, so the type block stops early and the plates start. */}
      <Section className="!pb-0 !pt-28 sm:!pt-32">
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.3em] text-amber">
          Tour merch · Scarborough × South India
        </p>
        <h1 className="mt-5 max-w-3xl font-display text-[clamp(2.6rem,11vw,5.5rem)] uppercase leading-[0.88] text-cream">
          The <span className="text-amber">tour drop</span>
        </h1>
        <p className="mt-6 max-w-xl text-base leading-relaxed text-warmgray sm:text-lg">
          Five pieces, cut once for this tour: one heavyweight hoodie, two long
          sleeves and two bandanas, all built around the mridangam emblem. When a
          run is claimed the piece stays buyable as a pre-order, same cart, same
          checkout, a longer wait.
        </p>

        <div className="mt-10 flex flex-col gap-3 border-t border-cream/10 pt-6 sm:flex-row sm:flex-wrap sm:gap-x-10">
          {PERKS.map((p) => (
            <span
              key={p.label}
              className="inline-flex items-center gap-2 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-warmgray"
            >
              <p.icon size={14} className="shrink-0 text-amber" />
              {p.label}
            </span>
          ))}
        </div>
      </Section>

      <Section className="!pt-12 sm:!pt-16">
        {cancelled && (
          <p className="mb-10 border border-cream/12 bg-charcoal px-5 py-4 text-sm leading-relaxed text-cream/85">
            Checkout cancelled, and nothing was charged. Your cart is untouched,
            every piece and every size still in it.
          </p>
        )}

        {!checkoutEnabled && (
          <p className="mb-10 border border-amber/30 bg-amber/5 px-5 py-4 text-sm leading-relaxed text-cream/80">
            Checkout is not open yet. Everything below is the real run at the
            real price, and the buy buttons switch on the day payments go live.
          </p>
        )}

        {checkoutEnabled && !stockKnown && (
          <p className="mb-10 border border-amber/30 bg-amber/5 px-5 py-4 text-sm leading-relaxed text-cream/80">
            Availability is being confirmed right now, so every piece is shown as
            made to order. You will not wait longer than the window on the line
            you buy.
          </p>
        )}

        <MerchGrid items={items} checkoutEnabled={checkoutEnabled} />

        {/* Shown only when something in the drop is actually on pre-order, so it
            reads as an explanation of what you are looking at rather than a
            standing disclaimer. */}
        {anyPreorder && (
          <div className="mt-16 border border-amber/25 bg-amber/5 p-6 sm:mt-20 sm:p-8">
            <p className="font-head text-sm font-bold uppercase tracking-[0.16em] text-cream">
              Some pieces are on pre-order. Here is what that means.
            </p>
            <div className="mt-6 grid gap-6 sm:grid-cols-3">
              <div>
                <Package size={15} className="text-amber" />
                <p className="mt-3 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-warmgray">
                  Why it happens
                </p>
                <p className="mt-2 text-sm leading-relaxed text-cream/85">
                  One tour run, made once. When it is claimed the piece is not
                  retired, it is cut again in the next batch.
                </p>
              </div>
              <div>
                <Clock size={15} className="text-amber" />
                <p className="mt-3 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-warmgray">
                  When it ships
                </p>
                <p className="mt-2 text-sm leading-relaxed text-cream/85">
                  {STATE_COPY["pre-order"].promise}, from Toronto, with tracking
                  the day it leaves.
                </p>
              </div>
              <div>
                <Lock size={15} className="text-amber" />
                <p className="mt-3 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-warmgray">
                  What you pay
                </p>
                <p className="mt-2 text-sm leading-relaxed text-cream/85">
                  The full price today, once, at checkout. Nothing is billed
                  later and nothing is held on your card.
                </p>
              </div>
            </div>
          </div>
        )}
      </Section>

      <Section className="border-t border-cream/10">
        <div className="grid gap-8 md:grid-cols-2">
          {/* Requirement: the counter is site claims only. It cannot see the room. */}
          <p className="max-w-lg font-mono text-[0.65rem] uppercase leading-[1.8] tracking-[0.12em] text-warmgray">
            In stock or pre-order is set by orders placed on this site. The same
            pieces are sold in person at the shows, so this is not a live count
            of what is left in the room.
          </p>
          <p className="max-w-lg font-mono text-[0.65rem] uppercase leading-[1.8] tracking-[0.12em] text-warmgray">
            Apparel runs S through XL in a relaxed, boxy fit, so size down for a
            classic cut. Bandanas are one size. Questions on the drop? Reach out
            through the booking form.
          </p>
        </div>
      </Section>
    </>
  );
}
