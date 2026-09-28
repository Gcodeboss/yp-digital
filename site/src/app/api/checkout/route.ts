/**
 * POST /api/checkout: cart in, Square hosted payment link out.
 *
 * The body carries `skuId`, `size` and `quantity` and nothing else. Any price,
 * amount or total a client sends is ignored, and no amount is sent to Square
 * either: line items reference a `catalog_object_id` and Square prices them
 * from its own catalogue, so a tampered cart can ask for a different piece but
 * never for a different price.
 *
 * The return origin is derived from the request, never from the body, so the
 * success URL cannot be pointed at someone else's site.
 *
 * Next 16: route handlers take a Web `Request` and the body is read with the
 * standard Web API. See
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`.
 * There are no dynamic params here, so nothing needs awaiting; the async
 * request APIs this version made mandatory (`cookies`, `headers`, `params`) are
 * not used, and request headers are read off the `Request` object directly.
 *
 * Spec: openspec/changes/merch-square-rail/specs/preorder-checkout/spec.md
 */
import { NextResponse } from "next/server";

import { parseLineKey } from "@/lib/merch";
import { createCheckoutSession, isSquareConfigured } from "@/lib/square";

// The Square SDK and `node:crypto` want the Node runtime.
export const runtime = "nodejs";

type IncomingLine = {
  skuId?: unknown;
  size?: unknown;
  quantity?: unknown;
  /** The cart's own line identity, `skuId:size`, accepted as an alternative. */
  key?: unknown;
  lineKey?: unknown;
};

function asArray(body: unknown): IncomingLine[] {
  if (Array.isArray(body)) return body as IncomingLine[];
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    for (const field of ["lines", "items", "cart"]) {
      if (Array.isArray(record[field])) return record[field] as IncomingLine[];
    }
  }
  return [];
}

/** Read SKU, size and quantity. Everything else in the payload is discarded. */
function readLine(raw: IncomingLine): {
  skuId: string;
  size: string | null;
  quantity: number;
} {
  let skuId = typeof raw?.skuId === "string" ? raw.skuId : "";
  let size = typeof raw?.size === "string" ? raw.size : null;

  if (!skuId) {
    const key = typeof raw?.key === "string" ? raw.key : typeof raw?.lineKey === "string" ? raw.lineKey : "";
    if (key) {
      const parsed = parseLineKey(key);
      skuId = parsed.skuId;
      if (size === null) size = parsed.size;
    }
  }

  const quantity = Number(raw?.quantity ?? 1);
  return { skuId, size, quantity: Number.isFinite(quantity) ? quantity : 0 };
}

/** Where to send the buyer back to. Request-derived, never body-derived. */
function originOf(req: Request): string {
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto");
  if (forwardedHost) {
    return `${forwardedProto || "https"}://${forwardedHost.split(",")[0].trim()}`;
  }
  const origin = req.headers.get("origin");
  if (origin) return origin;
  return new URL(req.url).origin;
}

export async function POST(req: Request) {
  if (!isSquareConfigured()) {
    return NextResponse.json(
      { error: "Checkout is not live yet. Please try again when the store opens." },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Could not read your cart." }, { status: 400 });
  }

  const lines = asArray(body).map(readLine);
  if (lines.length === 0) {
    return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });
  }

  const result = await createCheckoutSession({ lines, origin: originOf(req) });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ url: result.url });
}
