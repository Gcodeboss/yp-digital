import type { Metadata } from "next";
import { Clock, PackageCheck } from "lucide-react";
import { CartClearOnConfirmedPayment } from "@/components/cart-drawer";
import { PurchaseTracker } from "@/components/purchase-tracker";
import { Button, Section, SectionHeading } from "@/components/ui";
import { STATE_COPY, formatCad, lineKey } from "@/lib/merch";
import { getOrderById } from "@/lib/square";

// Neutral on purpose. This page renders either a confirmed order or "no paid order
// here", and a static "Order confirmed" title told the tab (and any shared link) that a
// payment succeeded even when the lookup found nothing.
export const metadata: Metadata = {
  title: "Order status",
  description: "Your Yanchan Produced order.",
  robots: { index: false, follow: false },
};

/** Never prerendered: without a live Session lookup this page says nothing. */
export const dynamic = "force-dynamic";

export default async function OrderSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;

  /**
   * Square appends its own identifiers to a payment link's redirect, so the id
   * arrives as `orderId`. `session_id` is read as a fallback so a link minted
   * before the rail changed still resolves instead of showing "no paid order"
   * to somebody who paid.
   */
  const raw = params.orderId ?? params.session_id;
  const orderId = Array.isArray(raw) ? raw[0] : (raw ?? "");

  /**
   * Server-side verification, every time. `getOrderById` returns `null` for a
   * missing id, an id that does not exist, or an order that was never paid, so
   * typing this URL by hand shows no confirmation and clears nothing.
   */
  const order = orderId ? await getOrderById(orderId) : null;

  if (!order) {
    return (
      <Section className="!pt-28 sm:!pt-32">
        <SectionHeading
          eyebrow="Order"
          title={
            <>
              No paid order <span className="text-amber">here</span>
            </>
          }
          intro="We could not match this link to a completed payment. If you were part-way through checkout, nothing has been charged and your cart is exactly as you left it."
        />
        <div className="mt-8 flex flex-wrap gap-3">
          <Button href="/store">Back to the store</Button>
          <Button href="/#booking" variant="ghost">
            Something went wrong? Tell us
          </Button>
        </div>
      </Section>
    );
  }

  // Only the lines Square confirmed as paid leave the cart. Anything else the
  // buyer was carrying stays: a piece added in another tab.
  const paidKeys = Array.from(
    new Set(order.lines.map((l) => lineKey(l.skuId, l.size))),
  );
  const hasInStock = order.lines.some((l) => l.state === "in-stock");

  return (
    <Section className="!pt-28 sm:!pt-32">
      <CartClearOnConfirmedPayment keys={paidKeys} />
      <PurchaseTracker
        orderId={order.id}
        valueCad={order.totalCad}
        items={order.lines.map((l) => ({
          item_id: l.skuId,
          item_name: l.name,
          item_variant: l.size ?? "One size",
          price: l.unitPriceCad,
          quantity: l.quantity,
        }))}
        hasPreOrder={order.hasPreOrder}
      />

      <SectionHeading
        eyebrow={`Order ${order.id.slice(-8).toUpperCase()} · Paid`}
        title={
          <>
            You&apos;re <span className="text-amber">in.</span>
          </>
        }
        intro={
          order.buyerEmail
            ? `A Square receipt is on its way to ${order.buyerEmail}. Here is what each line promised you.`
            : "A Square receipt is on its way. Here is what each line promised you."
        }
      />

      <ul className="mt-10 max-w-2xl divide-y divide-white/10 border border-white/8 bg-charcoal">
        {order.lines.map((line) => {
          const preorder = line.state === "pre-order";
          return (
            <li
              key={`${line.skuId}:${line.size ?? "onesize"}:${line.state}`}
              className="flex flex-wrap gap-4 px-5 py-4"
            >
              <div className="min-w-0 flex-1">
                <p className="font-head font-bold text-cream">
                  {line.name}
                  <span className="text-warmgray"> · {line.colourway}</span>
                </p>
                <p className="mt-0.5 font-mono text-[0.68rem] uppercase tracking-wider text-warmgray">
                  {line.size ? `Size ${line.size}` : "One size"} · Qty{" "}
                  {line.quantity}
                </p>
                {/* Each line repeats its own state and its own window. */}
                <p
                  className={`mt-2 inline-flex items-center gap-1.5 font-mono text-[0.65rem] uppercase tracking-[0.12em] ${
                    preorder ? "text-amber" : "text-warmgray"
                  }`}
                >
                  {preorder ? <Clock size={12} /> : <PackageCheck size={12} />}
                  {STATE_COPY[line.state].label} ·{" "}
                  {STATE_COPY[line.state].promise}
                </p>
              </div>
              <p className="font-head font-bold text-cream">
                {formatCad(line.unitPriceCad * line.quantity)}
              </p>
            </li>
          );
        })}
        <li className="flex items-center justify-between px-5 py-4">
          <span className="font-mono text-xs uppercase tracking-widest text-warmgray">
            Paid
          </span>
          <span className="font-display text-2xl text-cream">
            {formatCad(order.totalCad)}
          </span>
        </li>
      </ul>

      {order.hasPreOrder && (
        <div className="mt-6 max-w-2xl border border-amber/30 bg-amber/5 px-5 py-4 text-sm leading-relaxed text-cream/85">
          <p className="font-head text-xs font-bold uppercase tracking-[0.16em] text-cream">
            What happens next
          </p>
          <p className="mt-3">
            This order includes a pre-order. Those pieces are cut for you now and
            ship in 4 to 6 weeks. You have paid for them in full already, so
            nothing is owed later and nothing is held on your card.
          </p>
          {hasInStock && (
            <p className="mt-3">
              Anything marked in stock leaves within five business days. Each
              part ships as soon as it is ready rather than waiting for the
              slowest line, unless you ask us to send it in one box.
            </p>
          )}
        </div>
      )}

      {order.shippingAddress && (
        <p className="mt-6 max-w-2xl font-mono text-[0.68rem] uppercase leading-[1.7] tracking-[0.12em] text-warmgray">
          Shipping to {order.shippingAddress}
        </p>
      )}

      <div className="mt-8 flex flex-wrap gap-3">
        <Button href="/store" variant="secondary">
          Back to the store
        </Button>
        <Button href="/music" variant="ghost">
          Hear the music
        </Button>
      </div>
    </Section>
  );
}
