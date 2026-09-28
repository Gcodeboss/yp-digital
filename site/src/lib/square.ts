/**
 * Square: catalogue prices, claimed counts, checkout, orders and fulfilment.
 *
 * ┌─ SERVER ONLY ───────────────────────────────────────────────────────────┐
 * │ This module reads `SQUARE_ACCESS_TOKEN`. It must NEVER be imported from  │
 * │ a client component or any module reachable from one. Import it only from │
 * │ route handlers, server components and server actions. The `window` guard │
 * │ below turns a mistaken client import into a loud failure rather than a   │
 * │ leaked secret. (`server-only` is not a dependency of this repo and this  │
 * │ change is not allowed to add one, so the guard stands in for it.)        │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Five rules this file exists to enforce:
 *
 * 1. **The client never sets a price.** A request carries `skuId`, `size` and
 *    `quantity` and nothing else that costs money. Line items reference a
 *    `catalog_object_id` and carry no `base_price_money` at all, so Square
 *    prices every line from its own catalogue. If a catalogue price cannot be
 *    read, checkout fails closed: it never falls back to `content/merch.json`,
 *    which is a seed for the sync, not an authority at the till.
 * 2. **Square's inventory is REMAINING stock. The contract wants CLAIMED.**
 *    `claimed = sellable(sku) - remaining`, summed across that SKU's
 *    variations and floored at zero. Returning remaining here would invert
 *    every stock state on the site: sold-out pieces would read as in stock and
 *    pieces on the shelf would read as pre-order.
 * 3. **Stock state is computed against `sellable(sku)`**, never `produced`. 70
 *    of the 270 pieces are company-absorbed and were never for sale.
 * 4. **Zero inventory is a label change, not an end state.** At or beyond
 *    sellable a SKU flips to pre-order and stays buyable. Square's own
 *    sold-out behaviour is never used as the gate; an Order can be created at
 *    zero inventory and that is the whole pre-order mechanic.
 * 5. **No order is ever written to disk.** The Square `Order` is the record of
 *    both payment and fulfilment. Vercel's filesystem is ephemeral and
 *    `.vercelignore` strips `data/`.
 *
 * Degradation: with no token the store still renders. Read paths return an
 * empty answer instead of throwing, so a site with no Square account shows
 * every SKU as in stock and simply cannot take money. Write paths
 * (`setFulfilment`, `adjustClaimed`) throw instead, because silently
 * "succeeding" would tell an operator their reconciliation landed when nothing
 * was written.
 *
 * SDK: `square` 45.x. Version 40 was a full rewrite, so remembered Square code
 * is wrong; this file follows the installed package's own types. The API
 * version is pinned explicitly through the `Square-Version` header rather than
 * drifting with the SDK default.
 *
 * Specs:
 *   openspec/changes/merch-square-rail/specs/preorder-checkout/spec.md
 *   openspec/changes/merch-square-rail/specs/merch-order-admin/spec.md
 *   openspec/changes/merch-square-rail/specs/square-catalog-sync/spec.md
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { SquareClient, SquareEnvironment, type Square } from "square";

import {
  CURRENCY,
  MERCH,
  STATE_COPY,
  getSku,
  lineKey,
  parseLineKey,
  requiresSize,
  resolveStock,
  sellable,
  type FulfilmentState,
  type MerchOrder,
  type MerchOrderLine,
  type MerchSku,
  type StockState,
} from "@/lib/merch";

if (typeof window !== "undefined") {
  throw new Error(
    "@/lib/square is server-only and was imported into a client bundle."
  );
}

/* ------------------------------------------------------------------ config */

/**
 * Pinned deliberately. Square's API is date-versioned and moving:
 * `InventoryTransfer` was retired at 2026-07-15. The SDK would otherwise send
 * its own default version, which changes when the package majors.
 */
const SQUARE_API_VERSION = "2026-07-15";

/** Read at call time, not module load: env is a runtime value on Vercel. */
function accessToken(): string {
  return (process.env.SQUARE_ACCESS_TOKEN ?? "").trim();
}

function locationId(): string {
  return (process.env.SQUARE_LOCATION_ID ?? "").trim();
}

function isProduction(): boolean {
  return (process.env.SQUARE_ENVIRONMENT ?? "sandbox").trim().toLowerCase() === "production";
}

function webhookSignatureKey(): string {
  return (process.env.SQUARE_WEBHOOK_SIGNATURE_KEY ?? "").trim();
}

/**
 * Square signs `notificationUrl + rawBody`, so verification needs the exact URL
 * registered on the webhook subscription. Behind a proxy the request's own URL
 * can differ from it, so this env var wins when it is set and the route falls
 * back to the forwarded host otherwise.
 */
export function webhookNotificationUrl(): string {
  return (process.env.SQUARE_WEBHOOK_NOTIFICATION_URL ?? "").trim();
}

/** A token alone is not enough: every call is scoped to a location. */
export function isSquareConfigured(): boolean {
  return accessToken().length > 0 && locationId().length > 0;
}

export function isWebhookConfigured(): boolean {
  return isSquareConfigured() && webhookSignatureKey().length > 0;
}

let cachedClient: SquareClient | null = null;
let cachedClientKey = "";

/** `null` when unconfigured, so every read path degrades rather than throwing. */
function client(): SquareClient | null {
  if (!isSquareConfigured()) return null;
  const token = accessToken();
  const key = `${token}:${isProduction() ? "production" : "sandbox"}`;
  if (!cachedClient || cachedClientKey !== key) {
    cachedClient = new SquareClient({
      token,
      environment: isProduction() ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
      // `headers` wins over the SDK's own default, which is how the version
      // gets pinned: the typed `version` option only accepts the version the
      // package was generated against.
      headers: { "Square-Version": SQUARE_API_VERSION },
      maxRetries: 2,
    });
    cachedClientKey = key;
  }
  return cachedClient;
}

/* ------------------------------------------------------------------- utils */

/** Square money is `bigint` cents. The site works in whole dollars. */
function cents(money: Square.Money | null | undefined): number | null {
  const amount = money?.amount;
  if (amount === null || amount === undefined) return null;
  const value = Number(amount);
  return Number.isFinite(value) ? value : null;
}

function toInt(value: string | number | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function detailOf(err: unknown): string {
  if (err && typeof err === "object" && "errors" in err) {
    const errors = (err as { errors?: { detail?: string; code?: string }[] }).errors;
    const first = errors?.[0];
    if (first?.detail) return first.detail;
    if (first?.code) return first.code;
  }
  return err instanceof Error ? err.message : "unknown error";
}

/* --------------------------------------------------------------- catalogue */

/**
 * One Square catalogue variation, resolved to the SKU it belongs to.
 *
 * The join key is the variation's own `sku` field, written by the sync as
 * `<skuId>:<size>` or `<skuId>:onesize`, which is exactly `lineKey()` from the
 * frozen `@/lib/merch`. Square's object ids are never hardcoded anywhere.
 */
type CatalogueVariation = {
  variationId: string;
  skuId: string;
  size: string | null;
  itemName: string;
  variationName: string;
  /** Cents, as Square holds it. `null` means Square has no usable price. */
  unitAmount: number | null;
  currency: string | null;
};

type Catalogue = {
  byLineKey: Map<string, CatalogueVariation>;
  byVariationId: Map<string, CatalogueVariation>;
};

const CATALOGUE_TTL_MS = 30_000;
const INVENTORY_TTL_MS = 15_000;
/** 100 objects a page; five items will never need more than this. */
const MAX_CATALOGUE_PAGES = 10;

let catalogueCache: { at: number; value: Catalogue } | null = null;
let inventoryCache: { at: number; value: Map<string, number> } | null = null;
/** Last successful reads, kept forever: the fallback when Square is unreachable. */
let lastGoodClaimed: Record<string, number> | null = null;

function invalidateCaches(): void {
  catalogueCache = null;
  inventoryCache = null;
}

/**
 * Every ITEM in the account, flattened to its variations and keyed by SKU.
 *
 * Deleted and archived objects are dropped: pulling a SKU in the Square
 * dashboard has to actually pull it from the store, not be quietly resurrected
 * from the repo catalogue.
 *
 * `fresh` skips the cache. The checkout path uses it, because a stale price or
 * claimed count there would mislabel a line or charge the wrong amount.
 */
async function loadCatalogue(fresh = false): Promise<Catalogue> {
  const s = client();
  if (!s) throw new Error("Square is not configured.");

  const now = Date.now();
  if (!fresh && catalogueCache && now - catalogueCache.at < CATALOGUE_TTL_MS) {
    return catalogueCache.value;
  }

  const byLineKey = new Map<string, CatalogueVariation>();
  const byVariationId = new Map<string, CatalogueVariation>();

  let page = await s.catalog.list({ types: "ITEM" });
  for (let i = 0; i < MAX_CATALOGUE_PAGES; i += 1) {
    for (const object of page.data) {
      if (object.type !== "ITEM" || object.isDeleted) continue;
      const item = object.itemData;
      if (!item || item.isArchived) continue;

      for (const variation of item.variations ?? []) {
        if (variation.type !== "ITEM_VARIATION" || variation.isDeleted) continue;
        const data = variation.itemVariationData;
        const sku = (data?.sku ?? "").trim();
        if (!sku) continue;

        const { skuId, size } = parseLineKey(sku);
        if (!skuId) continue;

        const entry: CatalogueVariation = {
          variationId: variation.id,
          skuId,
          size,
          itemName: (item.name ?? "").trim(),
          variationName: (data?.name ?? "").trim(),
          unitAmount: cents(data?.priceMoney),
          currency: data?.priceMoney?.currency ?? null,
        };
        byLineKey.set(lineKey(skuId, size), entry);
        byVariationId.set(variation.id, entry);
      }
    }
    if (!page.hasNextPage()) break;
    page = await page.getNextPage();
  }

  const value: Catalogue = { byLineKey, byVariationId };
  catalogueCache = { at: Date.now(), value };
  return value;
}

/**
 * Units REMAINING per variation, from Square's `IN_STOCK` inventory counts.
 *
 * This is not the claimed count. See `getClaimedCounts` for the conversion and
 * for why getting it backwards would invert the whole store.
 */
async function loadRemaining(
  catalogue: Catalogue,
  fresh = false
): Promise<Map<string, number>> {
  const s = client();
  if (!s) throw new Error("Square is not configured.");

  const now = Date.now();
  if (!fresh && inventoryCache && now - inventoryCache.at < INVENTORY_TTL_MS) {
    return inventoryCache.value;
  }

  const ids = [...catalogue.byVariationId.keys()];
  const remaining = new Map<string, number>();
  if (ids.length === 0) {
    inventoryCache = { at: Date.now(), value: remaining };
    return remaining;
  }

  let page = await s.inventory.batchGetCounts({
    catalogObjectIds: ids,
    locationIds: [locationId()],
    states: ["IN_STOCK"],
  });
  for (let i = 0; i < MAX_CATALOGUE_PAGES; i += 1) {
    for (const count of page.data) {
      const id = count.catalogObjectId;
      if (!id || count.state !== "IN_STOCK") continue;
      const quantity = Math.max(0, Math.floor(Number(count.quantity ?? "0") || 0));
      remaining.set(id, quantity);
    }
    if (!page.hasNextPage()) break;
    page = await page.getNextPage();
  }

  inventoryCache = { at: Date.now(), value: remaining };
  return remaining;
}

/** Every catalogue variation belonging to one SKU, in catalogue size order. */
function variationsFor(catalogue: Catalogue, sku: MerchSku): CatalogueVariation[] {
  const keys = requiresSize(sku)
    ? sku.sizes.map((size) => lineKey(sku.id, size))
    : [lineKey(sku.id, null)];
  return keys
    .map((key) => catalogue.byLineKey.get(key))
    .filter((v): v is CatalogueVariation => Boolean(v));
}

/* ------------------------------------------------------------ claimed counts */

/**
 * Units CLAIMED per SKU id. Absent SKUs mean zero.
 *
 * ┌─ THE CONVERSION ────────────────────────────────────────────────────────┐
 * │ Square's `InventoryCount` is REMAINING stock. This contract wants        │
 * │ CLAIMED, which is its complement:                                        │
 * │                                                                          │
 * │     claimed = max(0, sellable(sku) - sum(remaining across variations))    │
 * │                                                                          │
 * │ Handing back `remaining` would invert every stock state on the site: a    │
 * │ sold-out piece (remaining 0) would read as fully in stock, and a full     │
 * │ shelf would read as pre-order. Do not "simplify" this.                    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Because it is a read of Square's own inventory rather than a counter we
 * increment, a sale taken at the merch table on Square POS against this same
 * catalogue lands here with no manual adjustment. One inventory, two tills.
 *
 * A variation Square has no count for is treated as zero remaining, which
 * reads as claimed. That is the safe direction: it can only ever say pre-order
 * about something that is actually on the shelf, never promise stock that does
 * not exist.
 */
export async function getClaimedCounts(): Promise<Record<string, number>> {
  if (!isSquareConfigured()) return {};

  let catalogue: Catalogue;
  let remaining: Map<string, number>;
  try {
    catalogue = await loadCatalogue();
    remaining = await loadRemaining(catalogue);
  } catch (err) {
    // Never throw into a page render. The last good read is closer to the
    // truth than nothing; with no read at all every SKU shows as in stock and
    // checkout still fails closed, because that path re-reads fresh.
    console.error("[square] claimed count read failed", detailOf(err));
    return lastGoodClaimed ?? {};
  }

  const counts: Record<string, number> = {};
  for (const sku of MERCH) {
    const variations = variationsFor(catalogue, sku);
    if (variations.length === 0) continue; // Not in Square yet: unknown, not zero-stock.
    const left = variations.reduce(
      (total, variation) => total + (remaining.get(variation.variationId) ?? 0),
      0
    );
    counts[sku.id] = Math.max(0, sellable(sku) - left);
  }

  lastGoodClaimed = counts;
  return counts;
}

/* ------------------------------------------------------------------ checkout */

/** Distinct cart lines. 5 SKUs x 4 sizes = 14 possible; 20 leaves headroom. */
const MAX_LINES = 20;
/** Per-line ceiling. The storefront caps at 10; the server is the backstop. */
const MAX_QUANTITY_PER_LINE = 20;

export type CheckoutLineInput = {
  skuId: string;
  size: string | null;
  quantity: number;
};

type PricedLine = {
  sku: MerchSku;
  variation: CatalogueVariation;
  size: string | null;
  quantity: number;
  state: StockState;
};

/**
 * Collapse duplicates and validate everything the client sent. Nothing about
 * money survives this function: only SKU, size and quantity.
 */
function normaliseLines(
  raw: CheckoutLineInput[]
): { lines: CheckoutLineInput[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "Your cart is empty." };
  }

  const merged = new Map<string, CheckoutLineInput>();

  for (const line of raw) {
    const skuId = typeof line?.skuId === "string" ? line.skuId.trim() : "";
    const sku = getSku(skuId);
    if (!sku) return { error: `That product is no longer available (${skuId || "unknown"}).` };

    const rawSize = typeof line?.size === "string" ? line.size.trim() : "";
    let size: string | null = null;

    if (requiresSize(sku)) {
      if (!rawSize) return { error: `Choose a size for the ${sku.name}.` };
      const match = sku.sizes.find(
        (candidate) => candidate.toLowerCase() === rawSize.toLowerCase()
      );
      if (!match) return { error: `${rawSize} is not a size we made for the ${sku.name}.` };
      size = match;
    }
    // Bandanas are one-size: any size sent for one is dropped, not rejected.

    const quantity = Math.trunc(Number(line?.quantity));
    if (!Number.isFinite(quantity) || quantity < 1) {
      return { error: `Quantity for the ${sku.name} must be at least 1.` };
    }

    const key = lineKey(sku.id, size);
    const existing = merged.get(key);
    const total = (existing?.quantity ?? 0) + quantity;
    if (total > MAX_QUANTITY_PER_LINE) {
      return {
        error: `${MAX_QUANTITY_PER_LINE} is the most of one piece we can take in a single order.`,
      };
    }
    merged.set(key, { skuId: sku.id, size, quantity: total });
  }

  if (merged.size > MAX_LINES) {
    return { error: "That is more separate items than one order can carry." };
  }

  return { lines: [...merged.values()] };
}

/**
 * Split one cart line across the in-stock / pre-order boundary.
 *
 * Buying five when three remain sells three as in stock and two as pre-order.
 * Labelling all five "in stock" would be a promise on two pieces that do not
 * exist; refusing the last two would be the thing this drop exists not to do.
 */
function splitByStock(
  sku: MerchSku,
  variation: CatalogueVariation,
  size: string | null,
  quantity: number,
  claimed: number
): PricedLine[] {
  const stock = resolveStock(sku, claimed);
  const base = { sku, variation, size };

  if (stock.state === "in-stock" && quantity > stock.remaining) {
    const inStock = stock.remaining;
    const preOrder = quantity - inStock;
    const out: PricedLine[] = [];
    if (inStock > 0) out.push({ ...base, quantity: inStock, state: "in-stock" });
    if (preOrder > 0) out.push({ ...base, quantity: preOrder, state: "pre-order" });
    return out;
  }

  return [{ ...base, quantity, state: stock.state }];
}

/**
 * The line title the buyer reads on Square's hosted checkout page.
 *
 * VERIFIED AGAINST SANDBOX, 15 Sep: the line item `name` is the only per-line
 * text Square renders to the buyer there. `note` is accepted and stored but
 * shows on the receipt and in the Seller Dashboard, not on the page where the
 * card is entered; `metadata` is private to this application; the payment
 * link's `description` is documented as unused. Square staff state the same:
 * "aside from adding the variations to the name of the line item there isn't
 * the ability to display any additional notes on the page where the customer
 * enters their information".
 *
 * So the stock promise goes in the name. A buyer must never pay for a
 * pre-order believing it ships this week.
 *
 * A custom `name` on a line item that also carries `catalog_object_id` is kept
 * by Square (confirmed in sandbox) while price and inventory still resolve
 * from the catalogue object, so this costs nothing.
 */
function buyerFacingName(line: PricedLine): string {
  const item = line.variation.itemName || `${line.sku.name} ${line.sku.colourway}`.trim();
  const variant = line.size
    ? `Size ${line.size}`
    : line.variation.variationName || "One size";
  const copy = STATE_COPY[line.state];
  const promise = copy.promise.charAt(0).toLowerCase() + copy.promise.slice(1);
  return `${item} (${variant}) - ${copy.label}, ${promise}`.slice(0, 500);
}

function safeOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Build a Square Order from the cart, create a hosted payment link for it, and
 * return the URL to redirect to.
 *
 * Order Checkout, never Quick Pay: Quick Pay carries an ad hoc name and price
 * with no catalogue link, so inventory would not move and the size would be
 * lost. Every line here references a `catalog_object_id`.
 *
 * No `base_price_money` is sent. Square prices each line from the catalogue
 * object, so a tampered cart can ask for a different piece but never for a
 * different price. The price is still read back here first, so that a SKU with
 * no usable price fails closed instead of reaching a checkout page priced from
 * somewhere we did not intend.
 */
async function buildPricedLines(raw: { skuId: string; size: string | null; quantity: number }[]): Promise<{ priced: PricedLine[] } | { error: string }> {
  const s = client();
  if (!s) {
    return { error: "Checkout is not live yet. Join the list and we will tell you when it opens." };
  }

  const normalised = normaliseLines(raw ?? []);
  if ("error" in normalised) return normalised;

  let catalogue: Catalogue;
  let remaining: Map<string, number>;
  try {
    // Fresh, not cached: a stale price or claimed count here would mislabel a
    // line or charge the wrong amount.
    catalogue = await loadCatalogue(true);
    remaining = await loadRemaining(catalogue, true);
  } catch (err) {
    console.error("[square] checkout catalogue read failed", detailOf(err));
    return { error: "We could not reach the payment provider. Try again in a moment." };
  }

  const priced: PricedLine[] = [];
  /**
   * Units this same cart has already spoken for, per SKU. Without it, a cart
   * holding the last hoodie in S and another in L would read the one remaining
   * piece twice and promise both buyers stock that only covers one of them.
   */
  const spokenFor = new Map<string, number>();

  for (const line of normalised.lines) {
    const sku = getSku(line.skuId);
    if (!sku) return { error: "That product is no longer available." };

    const variation = catalogue.byLineKey.get(lineKey(sku.id, line.size));
    if (!variation) {
      // Archived, deleted, or never synced. The repo catalogue is not a
      // fallback: a price we cannot charge is not a price.
      return { error: `The ${sku.name} in ${sku.colourway} is no longer for sale.` };
    }

    if (variation.unitAmount === null || variation.unitAmount <= 0) {
      return { error: `The ${sku.name} is not priced for sale right now.` };
    }
    if ((variation.currency ?? "").toUpperCase() !== CURRENCY.toUpperCase()) {
      return { error: `The ${sku.name} is priced in the wrong currency.` };
    }

    // Claimed for the WHOLE SKU, which is what `resolveStock` expects: stock
    // state is a property of the piece, not of one size of it.
    const left = variationsFor(catalogue, sku).reduce(
      (total, v) => total + (remaining.get(v.variationId) ?? 0),
      0
    );
    const claimed = Math.max(0, sellable(sku) - left) + (spokenFor.get(sku.id) ?? 0);

    priced.push(...splitByStock(sku, variation, line.size, line.quantity, claimed));
    spokenFor.set(sku.id, (spokenFor.get(sku.id) ?? 0) + line.quantity);
  }

  if (priced.length === 0) return { error: "Your cart is empty." };

  return { priced };
}

/** The order line items both checkout paths (hosted link, on-site pay) share. */
function orderLineItems(priced: PricedLine[]): Square.OrderLineItem[] {
  return priced.map((line) => ({
    quantity: String(line.quantity),
    // The catalogue link is the point: it moves the right variation's
    // inventory and keeps the size on the order.
    catalogObjectId: line.variation.variationId,
    name: buyerFacingName(line),
    // Seller-side copy of the same promise: this one rides the receipt
    // and the Seller Dashboard, which is where packing happens.
    note: `${STATE_COPY[line.state].label}: ${STATE_COPY[line.state].promise}`.slice(0, 500),
    // Private to this application. Square rejects an empty value, so the
    // size key is omitted rather than blanked for one-size pieces.
    metadata: {
      sku_id: line.sku.id,
      state: line.state,
      ...(line.size ? { size: line.size } : {}),
    },
  }));
}

/**
 * Build a Square Order from the cart, create a hosted payment link for it, and
 * return the URL to redirect to. Kept as the no-JS / fallback path; the
 * on-site Web Payments SDK flow in `createOrderAndPay` is the primary one.
 *
 * Order Checkout, never Quick Pay: Quick Pay carries an ad hoc name and price
 * with no catalogue link, so inventory would not move and the size would be
 * lost. Every line here references a `catalog_object_id`.
 *
 * No `base_price_money` is sent. Square prices each line from the catalogue
 * object, so a tampered cart can ask for a different piece but never for a
 * different price. The price is still read back here first, so that a SKU with
 * no usable price fails closed instead of reaching a checkout page priced from
 * somewhere we did not intend.
 */
export async function createCheckoutSession(input: {
  lines: { skuId: string; size: string | null; quantity: number }[];
  origin: string;
}): Promise<{ url: string } | { error: string }> {
  const origin = safeOrigin(input?.origin ?? "");
  if (!origin) return { error: "Could not work out where to send you back to." };

  const built = await buildPricedLines(input?.lines ?? []);
  if ("error" in built) return built;
  const { priced } = built;
  const s = client();
  if (!s) {
    return { error: "Checkout is not live yet. Join the list and we will tell you when it opens." };
  }

  const hasPreOrder = priced.some((line) => line.state === "pre-order");

  try {
    const response = await s.checkout.paymentLinks.create({
      idempotencyKey: randomUUID(),
      order: {
        locationId: locationId(),
        referenceId: ORDER_REFERENCE,
        lineItems: orderLineItems(priced),
        metadata: { source: ORDER_SOURCE },
      },
      checkoutOptions: {
        // Physical goods: we need somewhere to send them.
        askForShippingAddress: true,
        allowTipping: false,
        // Square appends `orderId`, `transactionId`, `checkoutId` and
        // `referenceId` to this URL after payment; `/store/success` confirms
        // the order server-side before showing anything or clearing the cart.
        redirectUrl: `${origin}/store/success`,
      },
      paymentNote: hasPreOrder ? "Yanchan merch: includes pre-order" : "Yanchan merch",
    });

    const url = response.paymentLink?.url;
    if (!url) {
      return { error: "Square did not return a checkout link. Try again." };
    }
    return { url };
  } catch (err) {
    console.error("[square] payment link create failed", detailOf(err));
    return { error: "We could not start checkout. Try again in a moment." };
  }
}

/* ------------------------------------------------------- on-site checkout */

/**
 * Buyer contact + shipping, collected by the on-site checkout form (card path)
 * or by the wallet sheet (Apple Pay / Google Pay path). Nothing here is
 * payment data: the card never touches this server, only Square's token does.
 */
export type CheckoutBuyer = {
  name: string;
  email: string;
  addressLine1: string;
  addressLine2?: string | null;
  locality: string;
  region: string;
  postalCode: string;
  /** ISO 3166-1 alpha-2, uppercase. */
  country: string;
};

export type CheckoutQuoteLine = {
  /** `skuId:size`, the cart's own line identity. */
  key: string;
  /** The same buyer-facing name the order line carries. */
  name: string;
  quantity: number;
  unitAmountCents: number;
  state: StockState;
};

export type CheckoutQuote = {
  lines: CheckoutQuoteLine[];
  totalCents: number;
  currency: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readBuyer(raw: unknown): CheckoutBuyer | { error: string } {
  const b = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const buyer: CheckoutBuyer = {
    name: str(b.name),
    email: str(b.email),
    addressLine1: str(b.addressLine1),
    addressLine2: str(b.addressLine2) || null,
    locality: str(b.locality),
    region: str(b.region),
    postalCode: str(b.postalCode),
    country: (str(b.country) || "CA").toUpperCase(),
  };
  if (!buyer.name) return { error: "We need a name for the shipping label." };
  if (!EMAIL_RE.test(buyer.email)) return { error: "That email address does not look right." };
  if (!buyer.addressLine1 || !buyer.locality || !buyer.postalCode) {
    return { error: "The shipping address is missing a line." };
  }
  if (!/^[A-Z]{2}$/.test(buyer.country)) {
    return { error: "The shipping country code must be two letters (CA, US, …)." };
  }
  return buyer;
}

/**
 * Server-priced cart summary for the on-site checkout page. The wallet sheets
 * (Apple Pay, Google Pay) need the total before tokenizing, and this is the
 * only total the page shows: it comes from the same fresh catalogue read as
 * the charge. Display-only — `createOrderAndPay` re-prices from scratch.
 */
export async function quoteCheckout(input: {
  lines: { skuId: string; size: string | null; quantity: number }[];
}): Promise<{ quote: CheckoutQuote } | { error: string }> {
  const built = await buildPricedLines(input?.lines ?? []);
  if ("error" in built) return built;

  let totalCents = 0;
  const lines: CheckoutQuoteLine[] = built.priced.map((line) => {
    const unit = line.variation.unitAmount ?? 0;
    totalCents += unit * line.quantity;
    return {
      key: lineKey(line.sku.id, line.size),
      name: buyerFacingName(line),
      quantity: line.quantity,
      unitAmountCents: unit,
      state: line.state,
    };
  });

  return { quote: { lines, totalCents, currency: CURRENCY } };
}

/** Buyer-safe copy for a declined/failed payment; detail is logged, not sent. */
function paymentErrorOf(err: unknown): string {
  const errors = (err as { errors?: { code?: string }[] })?.errors;
  const code = errors?.[0]?.code ?? "";
  switch (code) {
    case "CARD_DECLINED_VERIFICATION_REQUIRED":
      return "Your bank asked for one more verification step. Try again and complete the verification when prompted.";
    case "INSUFFICIENT_FUNDS":
      return "The card has insufficient funds. Nothing has been charged. Try a different card.";
    case "CARD_EXPIRED":
      return "That card is expired. Nothing has been charged. Try a different card.";
    default:
      return "The payment did not go through. Nothing has been charged. Try again or use a different card.";
  }
}

/**
 * On-site checkout: build the catalogue-priced order, then charge the token
 * Square's Web Payments SDK produced on the buyer's device.
 *
 * The card details never reach this server: `token` is a single-use nonce.
 * The amount is `sum(catalogue unit price × quantity)` — the same number
 * Square computes for the order total, so a mismatch fails at Square, not in
 * our favour.
 *
 * `attemptId` comes from the client and ties one checkout attempt together:
 * the order create and the payment share keys derived from it, so a retry
 * after a lost connection reuses the same order and cannot double-charge.
 */
export async function createOrderAndPay(input: {
  lines: { skuId: string; size: string | null; quantity: number }[];
  token: string;
  verificationToken?: string | null;
  buyer: unknown;
  attemptId: string;
}): Promise<{ orderId: string } | { error: string }> {
  const s = client();
  if (!s) {
    return { error: "Checkout is not live yet. Join the list and we will tell you when it opens." };
  }

  const token = (input?.token ?? "").trim();
  if (!token) return { error: "The card details were not received. Nothing has been charged." };

  const attemptId = (input?.attemptId ?? "").trim();
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(attemptId)) {
    return { error: "Checkout could not be started. Refresh and try again." };
  }

  const buyer = readBuyer(input?.buyer);
  if ("error" in buyer) return buyer;

  const built = await buildPricedLines(input?.lines ?? []);
  if ("error" in built) return built;
  const { priced } = built;

  const totalCents = priced.reduce(
    (sum, line) => sum + (line.variation.unitAmount ?? 0) * line.quantity,
    0
  );
  if (totalCents <= 0) return { error: "Your cart is empty." };

  const hasPreOrder = priced.some((line) => line.state === "pre-order");

  let orderId: string;
  try {
    const response = await s.orders.create({
      idempotencyKey: `yp-order-${attemptId}`,
      order: {
        locationId: locationId(),
        referenceId: ORDER_REFERENCE,
        lineItems: orderLineItems(priced),
        // The address lands on the SHIPMENT fulfilment so it shows where
        // packing happens in the Seller Dashboard, same as a hosted-link sale.
        // `placedAt` is Square-set on create and is rejected if we send it.
        fulfillments: [
          {
            type: "SHIPMENT",
            state: "PROPOSED",
            shipmentDetails: {
              recipient: {
                displayName: buyer.name,
                emailAddress: buyer.email,
              },
            },
          },
        ],
        metadata: { source: ORDER_SOURCE },
      },
    });
    orderId = response.order?.id ?? "";
    if (!orderId) return { error: "Square did not create the order. Nothing has been charged. Try again." };
  } catch (err) {
    console.error("[square] order create failed", detailOf(err));
    return { error: "We could not start checkout. Nothing has been charged. Try again in a moment." };
  }

  try {
    const response = await s.payments.create({
      idempotencyKey: `yp-pay-${attemptId}`,
      sourceId: token,
      orderId,
      amountMoney: { amount: BigInt(totalCents), currency: CURRENCY as Square.Currency },
      autocomplete: true,
      buyerEmailAddress: buyer.email,
      shippingAddress: {
        addressLine1: buyer.addressLine1,
        ...(buyer.addressLine2 ? { addressLine2: buyer.addressLine2 } : {}),
        locality: buyer.locality,
        administrativeDistrictLevel1: buyer.region,
        postalCode: buyer.postalCode,
        country: buyer.country as Square.Country,
      },
      note: hasPreOrder ? "Yanchan merch: includes pre-order" : "Yanchan merch",
      // Square's SCA step: present when the Web SDK ran verifyBuyer.
      ...(input?.verificationToken
        ? { verificationToken: input.verificationToken }
        : {}),
    });

    const status = response.payment?.status ?? "";
    if (status === "COMPLETED" || status === "APPROVED" || status === "PENDING") {
      return { orderId };
    }
    console.error("[square] payment returned status", status, detailOf(response));
    return { error: paymentErrorOf(response) };
  } catch (err) {
    console.error("[square] payment create failed", detailOf(err));
    return { error: paymentErrorOf(err) };
  }
}

/* -------------------------------------------------------------------- orders */

/** Marks orders this site created. Floor sales on Square POS carry their own. */
const ORDER_SOURCE = "yanchan-store";
const ORDER_REFERENCE = "yanchan-store";

const FULFILMENT_STATES: readonly FulfilmentState[] = [
  "unfulfilled",
  "packed",
  "shipped",
];

/**
 * Our three states onto Square's shipment ladder.
 *
 * Square's own ladder is PROPOSED, RESERVED, PREPARED, COMPLETED. Confirmed in
 * sandbox:
 *
 *  - PROPOSED to PREPARED directly is accepted, so RESERVED can be skipped.
 *  - COMPLETED is refused until the order is paid for, which is exactly the
 *    guard we want on "shipped".
 *  - The ladder is ONE WAY. Moving PREPARED back to PROPOSED is refused
 *    ("Fulfillments cannot be moved from state PREPARED to state PROPOSED"),
 *    so an order cannot be un-packed. Square's refusal is surfaced verbatim
 *    rather than swallowed, because the operator needs to know the order is
 *    where it is.
 *  - A tracking number can still be written or cleared without moving state.
 */
const TO_SQUARE_FULFILMENT: Record<FulfilmentState, Square.FulfillmentState> = {
  unfulfilled: "PROPOSED",
  packed: "PREPARED",
  shipped: "COMPLETED",
};

function readFulfilment(state: Square.FulfillmentState | undefined): FulfilmentState {
  switch (state) {
    case "PREPARED":
      return "packed";
    case "COMPLETED":
      return "shipped";
    // PROPOSED, RESERVED, CANCELED and FAILED all mean nothing has shipped.
    default:
      return "unfulfilled";
  }
}

function shipmentOf(order: Square.Order): Square.Fulfillment | null {
  const fulfilments = order.fulfillments ?? [];
  return fulfilments.find((f) => f.type === "SHIPMENT") ?? fulfilments[0] ?? null;
}

function formatAddress(address: Square.Address | null | undefined): string | null {
  if (!address) return null;
  const region = [address.locality, address.administrativeDistrictLevel1, address.postalCode]
    .filter((part) => Boolean(part && part.trim()))
    .join(" ");
  const parts = [
    address.addressLine1,
    address.addressLine2,
    region,
    address.country,
  ].filter((part): part is string => Boolean(part && part.trim()));
  return parts.length > 0 ? parts.join(", ") : null;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * A paid order. Square's `OrderState` is not the test: an order created
 * through the API is `OPEN` from the moment it exists, and a payment link's
 * order sits at `DRAFT` until the card clears. What actually means "paid" is
 * that nothing is owed.
 */
function isPaid(order: Square.Order): boolean {
  if (order.state === "CANCELED" || order.state === "DRAFT") return false;
  const total = cents(order.totalMoney) ?? 0;
  if (total <= 0) return false;
  const due = cents(order.netAmountDueMoney);
  if (due !== null) return due <= 0;
  return (order.tenders ?? []).length > 0;
}

/**
 * Square order to `MerchOrder`.
 *
 * Lines resolve their SKU from our own line metadata first and from the
 * catalogue variation second. The second path is what lets a sale taken at the
 * merch table on Square POS appear here at all: it carries no metadata of
 * ours, but it references the same catalogue object.
 */
function toOrder(order: Square.Order, catalogue: Catalogue | null): MerchOrder {
  const lines: MerchOrderLine[] = [];

  for (const item of order.lineItems ?? []) {
    const metadata = item.metadata ?? {};
    const fromCatalogue = item.catalogObjectId
      ? (catalogue?.byVariationId.get(item.catalogObjectId) ?? null)
      : null;

    const skuId = clean(metadata.sku_id) ?? fromCatalogue?.skuId ?? null;
    if (!skuId) continue;
    const sku = getSku(skuId);
    if (!sku) continue;

    const size = clean(metadata.size) ?? fromCatalogue?.size ?? null;
    const unit = cents(item.basePriceMoney) ?? 0;

    lines.push({
      skuId,
      name: sku.name,
      colourway: sku.colourway,
      size,
      quantity: Math.max(1, toInt(item.quantity)),
      unitPriceCad: unit / 100,
      // A floor sale carries no state of ours. It was bought off the shelf, so
      // in-stock is the honest reading.
      state: metadata.state === "pre-order" ? "pre-order" : "in-stock",
    });
  }

  const shipment = shipmentOf(order);
  const recipient = shipment?.shipmentDetails?.recipient ?? null;

  return {
    id: order.id ?? "",
    createdAt: order.createdAt ?? new Date(0).toISOString(),
    buyerName: clean(recipient?.displayName),
    buyerEmail: clean(recipient?.emailAddress),
    shippingAddress: formatAddress(recipient?.address),
    totalCad: (cents(order.totalMoney) ?? 0) / 100,
    lines,
    hasPreOrder: lines.some((line) => line.state === "pre-order"),
    fulfilment: readFulfilment(shipment?.state),
    trackingNumber: clean(shipment?.shipmentDetails?.trackingNumber),
  };
}

/** Square's page size for SearchOrders. This is the API's page, not the caller's limit. */
const ORDER_PAGE_SIZE = 100;
/** Hard bound on work: 20 x 100 = 2,000 orders scanned, worst case. */
const MAX_ORDER_PAGES = 20;
/** Ceiling on orders held in memory at once. */
const MAX_ORDERS = 1_000;

export type MerchOrderPage = {
  orders: MerchOrder[];
  /**
   * `true` when merch orders may exist beyond the ones returned: the caller
   * asked for fewer than exist, or the page bound was hit, or the read failed
   * part way. A packing list built from a truncated page is missing orders, so
   * this must be surfaced, not swallowed.
   *
   * Slightly pessimistic by design: it can read `true` when the next page would
   * have turned out to hold nothing of ours. Over-warning is the safe direction.
   */
  truncated: boolean;
  /** Square orders examined. Not the number of merch orders found. */
  scanned: number;
  /**
   * Non-null when the Square read failed. An outage and an account with no
   * sales both produce an empty `orders` array; this is the only thing that
   * tells them apart, so never render an empty list as "no orders" without
   * checking it.
   */
  error: string | null;
};

/**
 * Paid merch orders, newest first, read live from Square. There is no local
 * order store and there must never be one.
 *
 * `limit` counts MERCH ORDERS, not Square orders. Unpaid orders, abandoned
 * payment links and anything that resolves to no SKU of ours are skipped, so a
 * single 100-order page can hold far fewer than 100 of ours. We page until the
 * ask is filled or Square runs out.
 */
export async function getOrdersPage(limit = 50): Promise<MerchOrderPage> {
  const s = client();
  if (!s) {
    return { orders: [], truncated: false, scanned: 0, error: "Square is not configured." };
  }

  const want = Math.min(MAX_ORDERS, Math.max(1, Math.trunc(limit) || 50));

  // Needed to resolve POS sales, which carry no metadata of ours. A catalogue
  // outage must not fail the order read, so this degrades to metadata-only.
  let catalogue: Catalogue | null = null;
  try {
    catalogue = await loadCatalogue();
  } catch (err) {
    console.warn("[square] order read has no catalogue to resolve lines with", detailOf(err));
  }

  const orders: MerchOrder[] = [];
  let scanned = 0;
  let pages = 0;
  let cursor: string | undefined;
  // Assume completeness only if we actually reach the end of the list.
  let stoppedBecause: "exhausted" | "limit" | "page-cap" | "error" = "exhausted";

  try {
    outer: while (pages < MAX_ORDER_PAGES) {
      const response = await s.orders.search({
        locationIds: [locationId()],
        limit: ORDER_PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
        query: {
          filter: { stateFilter: { states: ["OPEN", "COMPLETED"] } },
          sort: { sortField: "CREATED_AT", sortOrder: "DESC" },
        },
      });
      pages += 1;
      const batch = response.orders ?? [];
      scanned += batch.length;

      for (let i = 0; i < batch.length; i += 1) {
        const order = batch[i];
        if (!isPaid(order)) continue;
        const mapped = toOrder(order, catalogue);
        if (mapped.lines.length === 0) continue; // Nothing of ours on it.
        orders.push(mapped);

        if (orders.length >= want) {
          // Only claim completeness if this really was the last order there is.
          const moreToCome = i < batch.length - 1 || Boolean(response.cursor);
          stoppedBecause = moreToCome ? "limit" : "exhausted";
          break outer;
        }
      }

      if (!response.cursor) {
        stoppedBecause = "exhausted";
        break;
      }
      cursor = response.cursor;

      if (pages >= MAX_ORDER_PAGES) stoppedBecause = "page-cap";
    }
  } catch (err) {
    console.error("[square] order read failed", detailOf(err));
    return {
      orders,
      truncated: true,
      scanned,
      error: `Could not read orders from Square: ${detailOf(err)}`,
    };
  }

  if (stoppedBecause === "page-cap") {
    console.warn(
      `[square] order scan hit the ${MAX_ORDER_PAGES}-page bound after ${scanned} orders`
    );
  }

  return { orders, truncated: stoppedBecause !== "exhausted", scanned, error: null };
}

/**
 * Paid orders, newest first. Unchanged signature: callers that do not care
 * about partial reads keep working.
 *
 * Prefer `getOrdersPage` anywhere the completeness of the list matters: a
 * packing list, a reorder total or a CSV export cannot tell a truncated list or
 * a failed read from a genuinely empty one through this return type.
 */
export async function getOrders(limit = 50): Promise<MerchOrder[]> {
  const { orders } = await getOrdersPage(limit);
  return orders;
}

/**
 * One order by Square order id, or `null` if it does not exist or was never
 * paid.
 *
 * This is what `/store/success` calls before showing a confirmation or
 * clearing the cart: hitting that URL by hand must not look like a completed
 * purchase. Square appends `orderId` to the redirect URL after payment, which
 * is the id this takes.
 */
export async function getOrderById(orderId: string): Promise<MerchOrder | null> {
  const s = client();
  if (!s || !orderId) return null;
  try {
    const response = await s.orders.get({ orderId });
    const order = response.order;
    if (!order || !isPaid(order)) return null;
    let catalogue: Catalogue | null = null;
    try {
      catalogue = await loadCatalogue();
    } catch {
      catalogue = null;
    }
    const mapped = toOrder(order, catalogue);
    return mapped.lines.length > 0 ? mapped : null;
  } catch (err) {
    console.error("[square] order lookup failed", detailOf(err));
    return null;
  }
}

/**
 * Advance an order's fulfilment, and record a tracking number with it.
 *
 * Written to the order's own `SHIPMENT` fulfilment, so it survives a reload
 * from any machine and shows up in Square's dashboard for whoever is packing.
 *
 * Square uses optimistic concurrency: the update carries the order's current
 * `version` and is rejected if anything changed since the read, so the order
 * is re-read here rather than trusting a version the caller held.
 */
export async function setFulfilment(
  orderId: string,
  state: FulfilmentState,
  trackingNumber?: string | null
): Promise<void> {
  const s = client();
  if (!s) throw new Error("Square is not configured, so fulfilment was not changed.");
  if (!orderId) throw new Error("An order id is required.");
  if (!FULFILMENT_STATES.includes(state)) {
    throw new Error(`Unknown fulfilment state: ${state}`);
  }

  const current = (await s.orders.get({ orderId })).order;
  if (!current) throw new Error(`No Square order ${orderId}.`);

  const shipment = shipmentOf(current);
  if (!shipment?.uid) {
    // An order can reach us without one: a payment link only attaches the
    // shipment once the buyer has been through checkout. Say so plainly rather
    // than inventing a fulfilment with no recipient on it.
    throw new Error(
      `Square order ${orderId} has no shipment fulfilment yet, so there is nothing to advance.`
    );
  }

  const patch: Square.Fulfillment = {
    uid: shipment.uid,
    state: TO_SQUARE_FULFILMENT[state],
  };
  if (trackingNumber !== undefined) {
    // "" clears the number in Square, which is what a null tracking number means.
    patch.shipmentDetails = { trackingNumber: (trackingNumber ?? "").trim().slice(0, 100) };
  }

  try {
    await s.orders.update({
      orderId,
      idempotencyKey: randomUUID(),
      order: {
        locationId: current.locationId,
        version: current.version,
        fulfillments: [patch],
      },
    });
  } catch (err) {
    // Square refuses COMPLETED before the order is paid for, among others. The
    // operator needs the real reason, not a generic failure.
    throw new Error(detailOf(err));
  }
}

/* ------------------------------------------------- manual claimed adjustment */

/** Sanity bound on a single reconciliation. */
const MAX_ADJUSTMENT = 500;

function sanitiseReason(reason: string): string {
  return reason.replace(/[\r\n|;]+/g, " ").trim().slice(0, 100);
}

/**
 * Move a SKU's claimed count by `delta`, recording the reason.
 *
 * Claimed is the complement of Square's inventory, so this writes the
 * complement too: claiming units REMOVES stock, releasing a claim puts it back.
 *
 *   delta > 0  ->  ADJUSTMENT IN_STOCK to SOLD        (a sale Square never saw)
 *   delta < 0  ->  ADJUSTMENT NONE to IN_STOCK        (that sale came back)
 *
 * Confirmed in sandbox: `SOLD` to `IN_STOCK` is refused as an unsupported
 * transition, and `NONE` to `IN_STOCK` is the supported way to put stock back.
 * Both adjustments need `from_location_id` and `to_location_id`, not a single
 * `location_id`.
 *
 * This is how floor sales get reconciled when the merch table is NOT running
 * on Square POS. When it is, nothing needs typing: the same catalogue object
 * moves and the site reads it.
 *
 * Throws when Square is unconfigured: silently "succeeding" would tell an
 * operator their reconciliation landed when nothing was written.
 */
export async function adjustClaimed(
  skuId: string,
  delta: number,
  reason: string
): Promise<void> {
  const s = client();
  if (!s) throw new Error("Square is not configured, so the claimed count was not changed.");

  const sku = getSku(skuId);
  if (!sku) throw new Error(`Unknown SKU: ${skuId}`);

  const step = Math.trunc(delta);
  if (!Number.isFinite(step) || step === 0) {
    throw new Error("Adjustment must be a non-zero whole number.");
  }
  if (Math.abs(step) > MAX_ADJUSTMENT) {
    throw new Error(`An adjustment of ${step} is larger than a whole production run.`);
  }

  const clean = sanitiseReason(reason);
  if (!clean) throw new Error("An adjustment needs a reason.");

  const catalogue = await loadCatalogue(true);
  const variations = variationsFor(catalogue, sku);
  if (variations.length === 0) {
    throw new Error(`${sku.id} is not in the Square catalogue, so there is nothing to adjust.`);
  }
  const remaining = await loadRemaining(catalogue, true);

  const stock = variations.map((variation) => ({
    variation,
    left: remaining.get(variation.variationId) ?? 0,
    move: 0,
  }));
  const totalLeft = stock.reduce((total, row) => total + row.left, 0);

  if (step > 0) {
    // Claiming units takes them off the shelf. Take from the size that has the
    // most left, one unit at a time, so no single size is driven negative.
    if (step > totalLeft) {
      throw new Error(
        `Square shows ${totalLeft} of the ${sku.name} left, so ${step} cannot be claimed.`
      );
    }
    for (let i = 0; i < step; i += 1) {
      const target = stock.reduce((best, row) =>
        row.left - row.move > best.left - best.move ? row : best
      );
      target.move += 1;
    }
  } else {
    // Releasing a claim puts stock back, but never more than the run held:
    // claimed floors at zero, so the counts have to as well.
    const units = -step;
    const headroom = Math.max(0, sellable(sku) - totalLeft);
    if (units > headroom) {
      throw new Error(
        `That would put ${units} of the ${sku.name} back when only ${headroom} were ever claimed.`
      );
    }
    for (let i = 0; i < units; i += 1) {
      const target = stock.reduce((best, row) =>
        row.left + row.move < best.left + best.move ? row : best
      );
      target.move += 1;
    }
  }

  const occurredAt = new Date().toISOString();
  const changes: Square.InventoryChange[] = stock
    .filter((row) => row.move > 0)
    .map((row) => ({
      type: "ADJUSTMENT",
      adjustment: {
        catalogObjectId: row.variation.variationId,
        fromState: step > 0 ? "IN_STOCK" : "NONE",
        toState: step > 0 ? "SOLD" : "IN_STOCK",
        fromLocationId: locationId(),
        toLocationId: locationId(),
        quantity: String(row.move),
        occurredAt,
        // The only field on an adjustment that carries our own text. It shows
        // in Square's inventory change history, which is where anyone asking
        // "why did this move" will look.
        referenceId: clean,
      },
    }));

  if (changes.length === 0) throw new Error("Nothing to adjust.");

  try {
    await s.inventory.batchCreateChanges({ idempotencyKey: randomUUID(), changes });
  } catch (err) {
    throw new Error(detailOf(err));
  }

  invalidateCaches();
}

/* ------------------------------------------------------------------ webhook */

/**
 * The slice of a Square event notification this site reads. Square posts
 * snake_case JSON; the SDK types cover the Webhook Subscriptions API, not the
 * notification body, so this is deliberately minimal and tolerant.
 */
export type SquareWebhookEvent = {
  event_id?: string;
  type?: string;
  merchant_id?: string;
  created_at?: string;
  data?: { type?: string; id?: string };
};

/**
 * Verify a Square event against the RAW request body.
 *
 * The scheme signs more than the body: the signature is
 * `base64(HMAC-SHA256(signatureKey, notificationUrl + rawBody))`, carried in
 * `x-square-hmacsha256-signature`. The notification URL is part of the signed
 * payload, so it must be exactly the URL registered on the subscription.
 *
 * The SDK ships `WebhooksHelper.verifySignature`, which does the same hash but
 * compares with `===`. This compares in constant time, which is what Square's
 * own documentation asks for.
 */
export function verifyWebhookSignature(input: {
  rawBody: string;
  signature: string;
  notificationUrl: string;
}): boolean {
  const key = webhookSignatureKey();
  if (!key || !input.signature || !input.notificationUrl) return false;

  const expected = createHmac("sha256", key)
    .update(input.notificationUrl + input.rawBody)
    .digest();

  let received: Buffer;
  try {
    received = Buffer.from(input.signature, "base64");
  } catch {
    return false;
  }
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}

/**
 * Event ids already handled, newest last. Square retries a delivery it did not
 * get a 2xx for, and can redeliver one it did, so the same event can arrive
 * more than once.
 *
 * In-memory and per-instance on purpose: there is no state to double-apply
 * here. Claimed counts are READ from Square's inventory rather than
 * incremented by this handler, which is what makes the idempotency question
 * small instead of a distributed-lock problem. The set only stops duplicate
 * work and duplicate log lines.
 */
const seenEvents = new Set<string>();
const MAX_SEEN_EVENTS = 500;

export type WebhookResult = "applied" | "duplicate" | "ignored";

/**
 * Act on a verified event.
 *
 * The only state this site keeps is a short-lived read cache, so the work is
 * to drop it: an inventory move, a paid order or a refund all mean the numbers
 * the storefront is holding are stale. Anything that changed money or stock
 * invalidates; everything else is logged and ignored.
 */
export function handleWebhookEvent(event: SquareWebhookEvent): WebhookResult {
  const id = (event?.event_id ?? "").trim();
  if (id) {
    if (seenEvents.has(id)) return "duplicate";
    seenEvents.add(id);
    if (seenEvents.size > MAX_SEEN_EVENTS) {
      const oldest = seenEvents.values().next().value;
      if (oldest !== undefined) seenEvents.delete(oldest);
    }
  }

  const type = (event?.type ?? "").trim();
  if (
    type.startsWith("inventory.") ||
    type.startsWith("order.") ||
    type.startsWith("payment.") ||
    type.startsWith("refund.") ||
    type.startsWith("catalog.")
  ) {
    invalidateCaches();
    return "applied";
  }

  return "ignored";
}
