/**
 * POST /api/square/webhook: Square tells us something moved.
 *
 * RAW BODY. Square signs more than the body: the signature is
 * `base64(HMAC-SHA256(signatureKey, notificationUrl + rawBody))` in the
 * `x-square-hmacsha256-signature` header, so both the exact bytes Square sent
 * AND the exact URL registered on the subscription are part of what is hashed.
 * The body must not be parsed before it is verified. In a Next 16 route handler
 * the request is a Web `Request` and the bundled docs read a webhook body with
 * `await request.text()`:
 *   node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md
 * There is no `bodyParser` to disable as there was in a Pages Router API route.
 *
 * What this handler does NOT do is maintain a claimed counter. Claimed counts
 * are read from Square's own inventory, so there is no number here to
 * double-increment; the handler drops the read caches so the storefront stops
 * showing a stale count. Idempotency is still enforced on the event id, so a
 * redelivery does no work twice.
 *
 * `SQUARE_WEBHOOK_SIGNATURE_KEY` is provisioned on the production deploy
 * (Keychain account `yanchan-produced`, Vercel production env, Square
 * subscription `yanchan-produced-store`). Without it this route no-ops safely
 * and answers 200, exactly as the rest of the rail degrades when Square is
 * unconfigured.
 *
 * Spec: openspec/changes/merch-square-rail/specs/preorder-checkout/spec.md
 */
import { NextResponse } from "next/server";

import {
  handleWebhookEvent,
  isWebhookConfigured,
  verifyWebhookSignature,
  webhookNotificationUrl,
  type SquareWebhookEvent,
} from "@/lib/square";

// Signature verification uses `node:crypto`.
export const runtime = "nodejs";

/**
 * The URL Square signed with. It must match the notification URL on the
 * subscription exactly, which behind a proxy is not always what the request
 * reports, so an explicit `SQUARE_WEBHOOK_NOTIFICATION_URL` wins when set.
 */
function notificationUrlFor(req: Request): string {
  const configured = webhookNotificationUrl();
  if (configured) return configured;

  const url = new URL(req.url);
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto");
  if (forwardedHost) {
    return `${forwardedProto || "https"}://${forwardedHost.split(",")[0].trim()}${url.pathname}`;
  }
  return `${url.origin}${url.pathname}`;
}

export async function POST(req: Request) {
  if (!isWebhookConfigured()) {
    // No signature key on this deploy. Answer 200 so Square does not retry
    // forever against an environment that was never meant to receive events.
    return NextResponse.json({ received: true, ignored: "not configured" });
  }

  const signature = req.headers.get("x-square-hmacsha256-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 403 });
  }

  // Raw, unparsed body. See the note above.
  const rawBody = await req.text();

  const verified = verifyWebhookSignature({
    rawBody,
    signature,
    notificationUrl: notificationUrlFor(req),
  });
  if (!verified) {
    console.error("[square:webhook] signature verification failed");
    // 403 is what Square's own documentation asks for on a bad signature.
    return NextResponse.json({ error: "Invalid signature." }, { status: 403 });
  }

  let event: SquareWebhookEvent;
  try {
    event = JSON.parse(rawBody) as SquareWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Could not read the event." }, { status: 400 });
  }

  try {
    const result = handleWebhookEvent(event);
    console.log(`[square:webhook] ${event.type ?? "unknown"} ${event.event_id ?? ""} ${result}`);
  } catch (err) {
    // 500 so Square retries. Nothing has been written, so a retry is safe.
    console.error("[square:webhook] handling failed", err);
    return NextResponse.json({ error: "Webhook handler failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
