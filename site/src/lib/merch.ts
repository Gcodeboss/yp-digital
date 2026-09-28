/**
 * Merch catalogue: the shared contract.
 *
 * Pure and isomorphic: no payment SDK, no `node:` imports, no fs. Safe to import from
 * server components, route handlers and client components alike. The payment rail lives
 * in `@/lib/square`; this file must never import it.
 *
 * The catalogue is IMPORTED, not read from disk. `content/merch.json` is bundled at
 * build time, so it survives Vercel's ephemeral filesystem and the `.vercelignore`
 * rule that strips `data/` from every deploy.
 *
 * Spec: openspec/changes/merch-commerce-v1/specs/merch-catalogue/spec.md
 */
import catalogue from "../../content/merch.json";

export type StockState = "in-stock" | "pre-order";
export type FulfilmentState = "unfulfilled" | "packed" | "shipped";

export type MerchSku = {
  id: string;
  name: string;
  garment: "hoodie" | "longsleeve" | "bandana";
  colourway: string;
  type: string;
  blurb: string;
  priceCad: number;
  unitCostCad: number;
  /** Units manufactured. NOT the number available to sell. */
  produced: number;
  /** Units the company keeps for team use and giveaways. Never sold. */
  absorbed: number;
  /** Empty array means one size, so render no size selector. */
  sizes: string[];
  art: string | null;
  /** Rear view, when the deck provides one. */
  artBack: string | null;
  /**
   * Worn / styled shots, in display order. The plate views sell the artwork;
   * these sell the piece. Optional — a SKU with none simply offers one fewer
   * view; one with several gets a thumbnail strip under the "worn" view.
   */
  artLifestyle?: string[] | null;
};

export const CURRENCY = catalogue.currency as string;
export const MERCH: MerchSku[] = catalogue.skus as MerchSku[];

export function getSku(id: string): MerchSku | undefined {
  return MERCH.find((s) => s.id === id);
}

/**
 * Units actually available to sell. Stock state is ALWAYS computed against this,
 * never against `produced`. 70 of the 270 pieces are company-absorbed, so using
 * the production run would oversell the drop by 26%.
 */
export function sellable(sku: MerchSku): number {
  return Math.max(0, sku.produced - sku.absorbed);
}

export type SkuStock = {
  sellable: number;
  claimed: number;
  remaining: number;
  state: StockState;
};

/** `claimed` is units claimed THROUGH THE SITE plus any manual floor-sale adjustment. */
export function resolveStock(sku: MerchSku, claimed: number): SkuStock {
  const total = sellable(sku);
  const safeClaimed = Math.max(0, Math.floor(claimed || 0));
  return {
    sellable: total,
    claimed: safeClaimed,
    remaining: Math.max(0, total - safeClaimed),
    state: safeClaimed >= total ? "pre-order" : "in-stock",
  };
}

export function requiresSize(sku: MerchSku): boolean {
  return sku.sizes.length > 0;
}

/** Cart/line identity. Size is part of the key; one-size SKUs use `onesize`. */
export function lineKey(skuId: string, size?: string | null): string {
  return `${skuId}:${size && size.length > 0 ? size : "onesize"}`;
}

export function parseLineKey(key: string): { skuId: string; size: string | null } {
  const i = key.lastIndexOf(":");
  if (i < 0) return { skuId: key, size: null };
  const size = key.slice(i + 1);
  return { skuId: key.slice(0, i), size: size === "onesize" ? null : size };
}

export function formatCad(amount: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

/** Copy shown to the buyer for each state. They must know which one they are in BEFORE paying. */
export const STATE_COPY: Record<StockState, { label: string; promise: string }> = {
  "in-stock": { label: "In stock", promise: "Ships within 5 business days" },
  "pre-order": {
    label: "Pre-order",
    promise: "Made to order, ships in 4 to 6 weeks",
  },
};

/* ---------- orders (shape only; `@/lib/square` implements the fetching) ---------- */

export type MerchOrderLine = {
  skuId: string;
  name: string;
  colourway: string;
  size: string | null;
  quantity: number;
  unitPriceCad: number;
  state: StockState;
};

export type MerchOrder = {
  id: string;
  createdAt: string;
  buyerName: string | null;
  buyerEmail: string | null;
  shippingAddress: string | null;
  totalCad: number;
  lines: MerchOrderLine[];
  hasPreOrder: boolean;
  fulfilment: FulfilmentState;
  trackingNumber: string | null;
};
