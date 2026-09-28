/**
 * POST /api/checkout/quote: cart in, server-priced total out.
 *
 * The on-site checkout page needs the exact total before opening an Apple Pay
 * or Google Pay sheet. This endpoint produces it from the same fresh catalogue
 * read the charge uses. It is display-only: `pay` re-prices from scratch and
 * never trusts a number from here.
 *
 * The body carries `skuId`, `size` and `quantity` and nothing else. See
 * /api/checkout for the full pricing-invariant note.
 */
import { NextResponse } from "next/server";

import { parseLineKey } from "@/lib/merch";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { isSquareConfigured, quoteCheckout } from "@/lib/square";

export const runtime = "nodejs";

type IncomingLine = {
  skuId?: unknown;
  size?: unknown;
  quantity?: unknown;
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

function readLine(raw: IncomingLine): {
  skuId: string;
  size: string | null;
  quantity: number;
} {
  let skuId = typeof raw?.skuId === "string" ? raw.skuId : "";
  let size = typeof raw?.size === "string" ? raw.size : null;

  if (!skuId) {
    const key =
      typeof raw?.key === "string" ? raw.key : typeof raw?.lineKey === "string" ? raw.lineKey : "";
    if (key) {
      const parsed = parseLineKey(key);
      skuId = parsed.skuId;
      if (size === null) size = parsed.size;
    }
  }

  const quantity = Number(raw?.quantity ?? 1);
  return { skuId, size, quantity: Number.isFinite(quantity) ? quantity : 0 };
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "quote", LIMITS.quote.limit, LIMITS.quote.windowMs);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many pricing requests. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

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

  const result = await quoteCheckout({ lines });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ quote: result.quote });
}
