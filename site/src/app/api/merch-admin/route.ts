import { NextResponse } from "next/server";
import { INTERNAL_TOOLS_ENABLED } from "@/lib/internal-only";
import { readMerchAdminSnapshot } from "@/lib/merch-admin";
import { getSku, sellable, type FulfilmentState, type MerchOrder } from "@/lib/merch";
import {
  adjustClaimed,
  getClaimedCounts,
  isSquareConfigured,
  setFulfilment,
} from "@/lib/square";

/**
 * The merch admin's API. Internal only, and a *view over Square*: it holds no
 * copy of the order list.
 *
 * Two rules shape this file:
 *
 *  1. **Nothing is written to disk.** The ops-dashboard route beside this one
 *     reads and writes `data/ops-dashboard.json`; that is a local-only pattern.
 *     `.vercelignore` strips `data/` from every deploy and Vercel's filesystem
 *     is ephemeral, so a cached order list would look fine in `next dev` and
 *     silently drift from the payment record in production. Orders are read
 *     from Square on every request; fulfilment moves on the order's own
 *     Shipment fulfilment and claimed counts are Square inventory, which is
 *     what makes both survive a reload from any machine.
 *
 *  2. **The gate is checked before anything else.** Every handler returns a
 *     bare 404, not a 403, when the internal opt-in is absent, so a public
 *     deploy cannot even confirm the route exists. This route is the only thing
 *     on the site that returns buyer names, emails and shipping addresses.
 *
 * Spec: openspec/changes/merch-square-rail/specs/merch-order-admin/spec.md
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A hand edit with no explanation is rejected by the spec, so a reason is required. */
const MIN_REASON_LENGTH = 3;

/** A floor-sale reconciliation is tens of units. Four figures is a typo. */
const MAX_ADJUSTMENT = 999;

const NO_STORE = { "Cache-Control": "no-store" } as const;

const FULFILMENT_STATES: FulfilmentState[] = ["unfulfilled", "packed", "shipped"];

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

/* ----------------------------- CSV ----------------------------- */

const CSV_COLUMNS = [
  "order",
  "placed",
  "sku",
  "product",
  "colourway",
  "size",
  "quantity",
  "unit price cad",
  "line total cad",
  "stock state",
  "fulfilment",
  "tracking",
  "buyer",
  "email",
  "shipping address",
];

/**
 * One cell, quoted unconditionally.
 *
 * Newlines are flattened rather than quoted through: a shipping address is the
 * point of this export and a multi-line cell breaks every naive label-printing
 * importer that will ever be pointed at it.
 *
 * The leading-punctuation guard is not decoration. Excel and Sheets evaluate a
 * cell that opens with `=`, `+`, `-` or `@`, and every string in this file
 * comes from a buyer-supplied name or address field.
 */
function csvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const flat = raw.replace(/\s*\r?\n\s*/g, ", ").trim();
  const safe = /^[=+\-@]/.test(flat) ? `'${flat}` : flat;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * One row per LINE ITEM, not per order. An order for a hoodie and two bandanas
 * is three rows, because three things get picked, packed and labelled.
 */
function toCsv(orders: MerchOrder[], preOrdersOnly: boolean): string {
  const rows = [CSV_COLUMNS.map(csvCell).join(",")];

  for (const order of orders) {
    const lines = preOrdersOnly ? order.lines.filter((l) => l.state === "pre-order") : order.lines;
    for (const line of lines) {
      rows.push(
        [
          csvCell(order.id),
          csvCell(order.createdAt.slice(0, 10)),
          csvCell(line.skuId),
          csvCell(line.name),
          csvCell(line.colourway),
          csvCell(line.size ?? "one size"),
          csvCell(line.quantity),
          csvCell(line.unitPriceCad.toFixed(2)),
          csvCell((line.unitPriceCad * line.quantity).toFixed(2)),
          csvCell(line.state),
          csvCell(order.fulfilment),
          csvCell(order.trackingNumber),
          csvCell(order.buyerName),
          csvCell(order.buyerEmail),
          csvCell(order.shippingAddress),
        ].join(",")
      );
    }
  }

  // A BOM, so Excel opens accented names as UTF-8 instead of mojibake.
  return `﻿${rows.join("\r\n")}\r\n`;
}

/* ---------------------------- handlers ---------------------------- */

/**
 * `?format=csv` returns the file itself with a `Content-Disposition`, rather
 * than JSON for the browser to assemble into a blob link. Script-initiated
 * downloads are blocked in some of the contexts this console runs in; a plain
 * link to a route that sets the header is the one path that always works, and
 * it is what `/api/yp/export/download` already does.
 */
export async function GET(req: Request) {
  if (!INTERNAL_TOOLS_ENABLED) return new NextResponse(null, { status: 404 });

  const { searchParams } = new URL(req.url);
  const snapshot = await readMerchAdminSnapshot();

  if (searchParams.get("format") === "csv") {
    const preOrdersOnly = searchParams.get("scope") === "preorder";
    const stamp = snapshot.readAt.slice(0, 10);
    const name = preOrdersOnly ? `merch-preorder-lines-${stamp}` : `merch-order-lines-${stamp}`;
    return new NextResponse(toCsv(snapshot.orders, preOrdersOnly), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}.csv"`,
        ...NO_STORE,
      },
    });
  }

  return NextResponse.json(snapshot, { headers: NO_STORE });
}

/**
 * Both writes go through Square and both answer with a fresh snapshot, so the
 * screen shows the state that was actually stored rather than the state the
 * client hoped for. A claimed adjustment that tips a SKU past its sellable run
 * comes back as `pre-order` in that same response.
 */
export async function POST(req: Request) {
  if (!INTERNAL_TOOLS_ENABLED) return new NextResponse(null, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return bad("Body must be JSON.");
  }
  if (!body || typeof body !== "object") return bad("Body must be a JSON object.");

  const payload = body as Record<string, unknown>;
  const action = payload.action;

  if (!isSquareConfigured()) {
    return bad(
      "Square is not connected, so there is nowhere to write this. Set SQUARE_ACCESS_TOKEN first.",
      409
    );
  }

  if (action === "fulfilment") {
    const orderId = typeof payload.orderId === "string" ? payload.orderId.trim() : "";
    const state = payload.state;
    if (!orderId) return bad("An order reference is required.");
    if (typeof state !== "string" || !FULFILMENT_STATES.includes(state as FulfilmentState)) {
      return bad(`Fulfilment state must be one of ${FULFILMENT_STATES.join(", ")}.`);
    }

    // An absent key leaves the stored number alone; an explicit empty string or
    // null clears it. `undefined` and `null` mean different things to
    // `setFulfilment`, so passing null for a key that was never sent would
    // erase a tracking number on every state change that did not carry one.
    const sent = Object.prototype.hasOwnProperty.call(payload, "trackingNumber");
    const raw = payload.trackingNumber;
    const tracking = typeof raw === "string" ? raw.trim() : null;

    try {
      await setFulfilment(
        orderId,
        state as FulfilmentState,
        sent ? (tracking ? tracking : null) : undefined
      );
    } catch (error) {
      return bad(`Square refused the fulfilment write: ${message(error)}`, 502);
    }

    return NextResponse.json(await readMerchAdminSnapshot(), { headers: NO_STORE });
  }

  if (action === "claimed") {
    const skuId = typeof payload.skuId === "string" ? payload.skuId.trim() : "";
    const sku = getSku(skuId);
    if (!sku) return bad(`Unknown SKU: ${skuId || "(none)"}.`);

    const delta = typeof payload.delta === "number" ? payload.delta : Number.NaN;
    if (!Number.isInteger(delta) || delta === 0) {
      return bad("The adjustment must be a whole number of units, and not zero.");
    }
    if (Math.abs(delta) > MAX_ADJUSTMENT) {
      return bad(`An adjustment of ${delta} units is larger than any run. Check the number.`);
    }

    // The spec rejects an unexplained edit: a claimed count that moved without a
    // stated reason is indistinguishable from a mistake a week later.
    const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
    if (reason.length < MIN_REASON_LENGTH) {
      return bad(
        "Every claimed adjustment needs a reason. Say where the units went, e.g. “40 sold on the floor, 18 Sep show”."
      );
    }

    let current = 0;
    try {
      current = Math.max(0, Math.floor((await getClaimedCounts())[sku.id] ?? 0));
    } catch (error) {
      return bad(`Could not read the current claimed count from Square: ${message(error)}`, 502);
    }
    if (current + delta < 0) {
      return bad(
        `${sku.id} has ${current} claimed; ${delta} would take it below zero. Adjust by at most -${current}.`
      );
    }

    try {
      await adjustClaimed(sku.id, delta, reason);
    } catch (error) {
      return bad(`Square refused the claimed adjustment: ${message(error)}`, 502);
    }

    const snapshot = await readMerchAdminSnapshot();
    const claimed = Math.max(0, Math.floor(snapshot.claimed[sku.id] ?? current + delta));
    return NextResponse.json(
      {
        ...snapshot,
        // Stated back so the operator sees the consequence, not just the number:
        // passing the sellable run is what flips the card to pre-order.
        note:
          claimed >= sellable(sku)
            ? `${sku.id} is now at ${claimed} of ${sellable(sku)} sellable, so it reads as pre-order on the store.`
            : `${sku.id} is now at ${claimed} of ${sellable(sku)} sellable.`,
      },
      { headers: NO_STORE }
    );
  }

  return bad(`Unknown action. Expected "fulfilment" or "claimed", got ${JSON.stringify(action)}.`);
}
