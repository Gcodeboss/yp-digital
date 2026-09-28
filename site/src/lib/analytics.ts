/**
 * Commerce funnel events, sent to Google Analytics 4.
 *
 * Four stages and nothing else, because four is what answers the only question
 * the drop has: of the people who look, how many add, how many reach payment,
 * and how many pay. Square records what was bought; it cannot record what was
 * nearly bought.
 *
 * Event names and shape are GA4's own ecommerce spec — `view_item_list`,
 * `add_to_cart`, `begin_checkout`, `purchase`, each with an `items` array,
 * `currency` and `value`. That is not decoration: GA4's built-in funnel
 * exploration and monetisation reports key off these exact names, and custom
 * names would leave the revenue reports empty and every funnel hand-built.
 *
 * Rules that keep the numbers honest:
 *
 * - NO PERSONALLY IDENTIFYING DATA, ever. No email, no name, no address, no
 *   Square customer id. Events carry SKUs, sizes, counts, CAD amounts and the
 *   Square order id. The buyer lives in Square, which is the system of record;
 *   a second, weaker copy of that PII inside Google buys nothing.
 * - Fire-and-forget. Every send is wrapped, so an analytics outage, a blocker
 *   or a refused consent can never stop somebody buying a hoodie.
 * - Amounts are CAD dollars, matching `priceCad` in the catalogue and
 *   `totalCad` on an order, so a number in GA4 can be read against a number in
 *   Square with no conversion step.
 *
 * Nothing here checks consent. It does not need to: `gtag` only exists on
 * `window` once `AnalyticsScripts` has injected it, which only happens after
 * the visitor accepts. Before that every call below is a no-op by construction
 * rather than by a flag someone could forget to check.
 *
 * Spec: openspec/changes/analytics-ga4-clarity-consent/specs/visitor-analytics/spec.md
 */

const CURRENCY = "CAD";

/** One line of a GA4 ecommerce `items` array. */
type GaItem = {
  item_id: string;
  item_name: string;
  item_variant?: string;
  price: number;
  quantity: number;
};

/**
 * The single exit point. `window.gtag` is absent until consent has loaded the
 * tag, so "not consented" and "blocked by an extension" are the same branch
 * and neither is an error.
 */
function send(event: string, params: Record<string, unknown>): void {
  try {
    if (typeof window === "undefined" || typeof window.gtag !== "function") return;
    window.gtag("event", event, params);
  } catch {
    // Never let measurement reach the buyer.
  }
}

/** The storefront was seen. Fired once per mount of the merch grid. */
export function trackViewItemList(items: { skuId: string; name: string; priceCad: number }[]): void {
  send("view_item_list", {
    item_list_id: "merch",
    item_list_name: "Tour merch",
    currency: CURRENCY,
    items: items.map<GaItem>((i) => ({
      item_id: i.skuId,
      item_name: i.name,
      price: i.priceCad,
      quantity: 1,
    })),
  });
}

/** A piece the cart accepted. Never fired on the size-validation bail-out. */
export function trackAddToCart(input: {
  skuId: string;
  name: string;
  size: string | null;
  priceCad: number;
  state: string;
}): void {
  send("add_to_cart", {
    currency: CURRENCY,
    value: input.priceCad,
    // "in-stock" vs "pre-order" — a pre-order cart behaves differently, and
    // that split is the whole reason the drop has two states.
    stock_state: input.state,
    items: [
      {
        item_id: input.skuId,
        item_name: input.name,
        item_variant: input.size ?? "One size",
        price: input.priceCad,
        quantity: 1,
      } satisfies GaItem,
    ],
  });
}

/**
 * The buyer reached the payment step with a priced cart. Fired once the server
 * quote lands, not on the button: before the quote there is no total worth
 * reporting, and a browser-computed one would not match Square.
 */
export function trackBeginCheckout(input: {
  valueCad: number;
  items: GaItem[];
}): void {
  send("begin_checkout", {
    currency: CURRENCY,
    value: input.valueCad,
    items: input.items,
  });
}

/**
 * A payment Square confirmed. Fired from the confirmation page, which renders
 * nothing until a server-side lookup proves the order was paid — so this event
 * cannot be forged by typing a URL.
 *
 * De-duplicated on the order id through `sessionStorage`: a refresh of the
 * confirmation page must not invent a second sale.
 */
export function trackPurchase(input: {
  orderId: string;
  valueCad: number;
  items: GaItem[];
  hasPreOrder: boolean;
}): void {
  const key = `yp_purchase_tracked:${input.orderId}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch {
    // Blocked storage: send it rather than lose the sale entirely. A rare
    // double count is a better failure than a silent zero.
  }
  send("purchase", {
    transaction_id: input.orderId,
    currency: CURRENCY,
    value: input.valueCad,
    has_pre_order: input.hasPreOrder,
    items: input.items,
  });
}

export type { GaItem };
