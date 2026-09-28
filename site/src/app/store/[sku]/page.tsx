import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, Lock, Package, Truck } from "lucide-react";
import {
  BuyPanel,
  ProductGallery,
  ProductPlate,
  StateLine,
} from "@/components/merch-grid";
import { Section } from "@/components/ui";
import { ProductJsonLd } from "@/components/structured-data";
import {
  MERCH,
  STATE_COPY,
  formatCad,
  getSku,
  requiresSize,
  resolveStock,
  sellable,
} from "@/lib/merch";
import { getClaimedCounts, isSquareConfigured } from "@/lib/square";

/**
 * One page per piece. The route set is fixed by the catalogue, but the render
 * is per request for the same reason /store is: stock state moves when someone
 * else claims the last unit, and a page cached at build time would keep
 * promising a five-day ship long after the run had gone to pre-order.
 */
export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return MERCH.map((sku) => ({ sku: sku.id }));
}

/**
 * Catalogue copy, cleaned for display. `content/merch.json` is frozen and one
 * blurb joins two clauses with a long dash. Rather than print a dash the house
 * voice does not use, the second clause is closed as its own sentence, and a
 * numeric range is spelled out the way STATE_COPY spells it.
 */
function plain(text: string): string {
  return text
    .replace(/(\d)\s*[\u2013\u2014]\s*(\d)/g, "$1 to $2")
    .replace(
      /\s*[\u2013\u2014]\s*(.)/g,
      (_match, next: string) => `. ${next.toUpperCase()}`,
    );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sku: string }>;
}): Promise<Metadata> {
  const { sku: id } = await params;
  const sku = getSku(id);
  if (!sku) return { title: "Piece not found" };

  const title = `${sku.name} · ${sku.colourway}`;
  const description = plain(sku.blurb);
  return {
    title,
    description,
    alternates: { canonical: `/store/${sku.id}` },
    openGraph: {
      title,
      description,
      type: "website",
      images: sku.art ? [{ url: sku.art }] : undefined,
    },
  };
}

function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Truck;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <Icon size={15} className="mt-0.5 shrink-0 text-amber" />
      <div>
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-warmgray">
          {label}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-cream/85">{children}</p>
      </div>
    </div>
  );
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ sku: string }>;
}) {
  const { sku: id } = await params;
  const sku = getSku(id);
  if (!sku) notFound();

  const checkoutEnabled = isSquareConfigured();

  // Same rule as /store. An unconfigured Square account means nothing can have
  // been claimed through the site, so stock is genuinely known and full. Only a
  // failed read leaves it unknown, and that falls back to the promise we can
  // always keep rather than to the one we cannot.
  let claimed: Record<string, number> = {};
  let stockKnown = true;
  if (checkoutEnabled) {
    try {
      claimed = await getClaimedCounts();
    } catch {
      stockKnown = false;
    }
  }
  // Only the resolved state is handed to the client. The sellable, claimed and
  // remaining counts stay on the server: the site cannot see the room at the
  // show, so it must not put a number anywhere a buyer could read one.
  const { state } = resolveStock(
    sku,
    stockKnown ? (claimed[sku.id] ?? 0) : sellable(sku),
  );
  const preorder = state === "pre-order";
  const rest = MERCH.filter((s) => s.id !== sku.id);

  return (
    <>
      {/*
        Availability comes from the SAME resolved state the card renders, so the
        structured data cannot claim InStock while the page says pre-order.
      */}
      <ProductJsonLd sku={sku} state={state} image={sku.art ?? undefined} />
      <Section className="!pb-0 !pt-24 sm:!pt-28">
        <Link
          href="/store"
          className="inline-flex min-h-11 items-center gap-2 font-mono text-[0.62rem] uppercase tracking-[0.22em] text-warmgray transition-colors hover:text-amber"
        >
          <ArrowLeft size={14} /> All five pieces
        </Link>
      </Section>

      <Section className="!pt-5">
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <ProductGallery sku={sku} />
          </div>

          <div className="lg:pt-2">
            <p className="font-mono text-[0.62rem] uppercase tracking-[0.28em] text-amber">
              {sku.type}
            </p>
            <h1 className="mt-3 font-display text-[clamp(2.4rem,9vw,3.8rem)] uppercase leading-[0.9] text-cream">
              {sku.name}
            </h1>
            <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <p className="font-mono text-[0.68rem] uppercase tracking-[0.22em] text-warmgray">
                {sku.colourway}
              </p>
              <p className="font-display text-3xl leading-none text-cream">
                {formatCad(sku.priceCad)}
              </p>
            </div>

            <StateLine state={state} className="mt-5" />

            <p className="mt-5 max-w-prose text-base leading-relaxed text-warmgray">
              {plain(sku.blurb)}
            </p>

            <div className="mt-8">
              <BuyPanel
                sku={sku}
                state={state}
                checkoutEnabled={checkoutEnabled}
              />
            </div>

            {!checkoutEnabled && (
              <p className="mt-4 border border-amber/30 bg-amber/5 px-4 py-3 text-sm leading-relaxed text-cream/80">
                Checkout is not open yet. This is the real run at the real price,
                and the buy button switches on the day payments go live.
              </p>
            )}

            {checkoutEnabled && !stockKnown && (
              <p className="mt-4 border border-amber/30 bg-amber/5 px-4 py-3 text-sm leading-relaxed text-cream/80">
                Availability is being confirmed right now, so this piece is shown
                as made to order. You will not wait longer than the window stated
                on the line you buy.
              </p>
            )}

            {/* The fulfilment promise, spelled out. Pre-order is a way of
                buying, not a failure to stock, so it gets the fuller answer. */}
            <div className="mt-8 border border-cream/10 bg-charcoal p-5 sm:p-6">
              <p className="font-head text-sm font-bold uppercase tracking-[0.16em] text-cream">
                {preorder ? "Pre-order, in plain terms" : "Ready to ship"}
              </p>
              <div className="mt-5 space-y-5">
                {preorder ? (
                  <>
                    <Fact icon={Package} label="What you are buying">
                      The first run of this piece is claimed. Yours is cut in the
                      next batch, from the same pattern and the same artwork.
                    </Fact>
                    <Fact icon={Clock} label="When it ships">
                      {STATE_COPY["pre-order"].promise}, from Toronto. You get
                      tracking the day it leaves.
                    </Fact>
                    <Fact icon={Lock} label="What you pay, and when">
                      The full price today, once, at checkout. Nothing is billed
                      later and nothing is held on your card.
                    </Fact>
                  </>
                ) : (
                  <>
                    <Fact icon={Truck} label="When it ships">
                      {STATE_COPY["in-stock"].promise}, from Toronto, with
                      tracking.
                    </Fact>
                    <Fact icon={Clock} label="If the run goes while you decide">
                      The piece does not disappear. It switches to pre-order at
                      the same price, in the same cart, and is made to order in{" "}
                      4 to 6 weeks.
                    </Fact>
                  </>
                )}
              </div>
            </div>

            {/* The production story. Why there is a run at all, and why the
                site cannot show a number. */}
            <div className="mt-10 border-t border-cream/10 pt-8">
              <p className="font-mono text-[0.62rem] uppercase tracking-[0.28em] text-amber">
                One run, made for this tour
              </p>
              <p className="mt-4 max-w-prose text-sm leading-[1.8] text-warmgray">
                Five pieces, cut once for this tour rather than carried as a
                season. The same garments are sold in person at the shows, so
                what you see here follows orders placed on this site, not what is
                left in the room. When a run is claimed the piece is not retired:
                it goes to pre-order and the next batch is made to order.
              </p>
              <ul className="mt-6 space-y-2 font-mono text-[0.62rem] uppercase leading-[1.7] tracking-[0.14em] text-warmgray">
                <li>
                  {requiresSize(sku)
                    ? "Sizes S to XL, relaxed boxy fit. Size down for a classic cut."
                    : "One size, cut square, finished on all four edges."}
                </li>
                <li>Ships worldwide from Toronto</li>
                <li>Questions on the drop? Reach out through the booking form</li>
              </ul>
            </div>
          </div>
        </div>
      </Section>

      <Section className="border-t border-cream/10">
        <div className="mb-8 flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="font-display text-[clamp(1.6rem,5vw,2.4rem)] uppercase leading-none text-cream">
            The rest of the <span className="text-amber">capsule</span>
          </h2>
          <Link
            href="/store"
            className="inline-flex min-h-11 items-center font-mono text-[0.62rem] uppercase tracking-[0.22em] text-warmgray transition-colors hover:text-amber"
          >
            See all five
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-6">
          {rest.map((other) => (
            <Link
              key={other.id}
              href={`/store/${other.id}`}
              className="block rounded-[2px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber"
            >
              <ProductPlate
                sku={other}
                sizes="(min-width:640px) 22vw, 44vw"
              />
              <p className="mt-3 font-head text-sm font-bold leading-tight text-cream">
                {other.name}
              </p>
              <p className="mt-1 font-mono text-[0.58rem] uppercase tracking-[0.2em] text-warmgray">
                {other.colourway} · {formatCad(other.priceCad)}
              </p>
            </Link>
          ))}
        </div>
      </Section>
    </>
  );
}
