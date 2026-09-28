/**
 * POST /api/subscribe: a newsletter sign-up becomes a HubSpot contact.
 *
 * Same contract as the booking route: an address is never reported as
 * subscribed unless HubSpot accepted it, and an unconfigured deployment
 * refuses rather than swallowing the sign-up. The Kit (ConvertKit) path this
 * replaced was never configured in production, so every sign-up since launch
 * has been answered with an honest 503.
 *
 * `source` (footer, hero, store…) is deliberately NOT sent to HubSpot: there is
 * no property for it on the newsletter form, and this endpoint accepts unknown
 * fields with a 200 and discards them, so sending it would be theatre. It stays
 * in the local lead record where it is actually readable.
 *
 * Spec: openspec/changes/hubspot-form-backend/specs/lead-capture/spec.md
 */
import { NextResponse } from "next/server";

import { captureLead } from "@/lib/leads";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import {
  hutkFromRequest,
  isConfigured,
  newsletterFormGuid,
  submitForm,
} from "@/lib/hubspot";

export async function POST(req: Request) {
  try {
    const limited = rateLimit(req, "subscribe", LIMITS.subscribe.limit, LIMITS.subscribe.windowMs);
    if (!limited.ok) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again shortly." },
        { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
      );
    }

    const { email, source } = await req.json();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const guid = newsletterFormGuid();

    if (!isConfigured(guid)) {
      // Local development can exercise the form without a live list. A
      // production visitor must never see success when their address went
      // nowhere.
      if (process.env.NODE_ENV !== "development") {
        return NextResponse.json(
          { error: "Email signup is not connected yet. Please try again later." },
          { status: 503 },
        );
      }
      console.log(`[subscribe] ${email} (source: ${source})`);
      void captureLead({
        receivedAt: new Date().toISOString(),
        kind: "newsletter",
        email,
        source: typeof source === "string" ? source : undefined,
      });
      return NextResponse.json({ ok: true, developmentOnly: true });
    }

    const delivered = await submitForm(
      guid,
      [{ name: "email", value: String(email) }],
      {
        pageUri: "https://yanchanproduced.com",
        pageName: `Newsletter sign-up (${typeof source === "string" ? source : "site"})`,
        // From the cookie only — see hutkFromRequest.
        hutk: hutkFromRequest(req),
      },
    );

    if (!delivered.ok) {
      return NextResponse.json(
        { error: "We could not sign you up just now. Please try again in a moment." },
        { status: 502 },
      );
    }

    void captureLead({
      receivedAt: new Date().toISOString(),
      kind: "newsletter",
      email,
      source: typeof source === "string" ? source : undefined,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
