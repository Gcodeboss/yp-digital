/**
 * POST /api/booking: a booking enquiry becomes a HubSpot contact.
 *
 * The contract that predates HubSpot is unchanged and is the important part:
 * a visitor is NEVER told an enquiry was received unless it actually went
 * somewhere. An unconfigured deployment refuses with 503 rather than accepting
 * and discarding.
 *
 * What HubSpot adds is a limit on how strong that promise can be. Its form
 * endpoint returns 200 for a field the form does not have, and 200 for a
 * malformed email, storing neither — so "delivered" here means "HubSpot
 * accepted it for processing", which is the strongest synchronous signal the
 * API offers. That is why the email is validated HERE, before sending: HubSpot
 * will take a bad address and bin it without a word. See lib/hubspot.ts.
 *
 * Spec: openspec/changes/hubspot-form-backend/specs/lead-capture/spec.md
 */
import { NextResponse } from "next/server";

import { captureLead } from "@/lib/leads";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import {
  bookingFormGuid,
  hutkFromRequest,
  isConfigured,
  splitName,
  submitForm,
} from "@/lib/hubspot";

/**
 * The HubSpot contact property holding the enquiry type. It must exist on the
 * booking form under exactly this internal name: if it does not, HubSpot still
 * answers 200 and the value is silently dropped.
 */
const INQUIRY_TYPE_PROPERTY = "inquiry_type";

export async function POST(req: Request) {
  try {
    const limited = rateLimit(req, "booking", LIMITS.booking.limit, LIMITS.booking.windowMs);
    if (!limited.ok) {
      return NextResponse.json(
        { error: "That is a lot of enquiries at once. Please try again shortly." },
        { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
      );
    }

    const data = await req.json();
    const { name, email, type, message, company } = data ?? {};

    /**
     * Honeypot. The form hides a `company` input no person can see, so anything
     * in it is a bot. Answer 200 and deliver nothing: an error would tell the
     * bot how to get past the trap. This is the one case where a success
     * response does not mean delivery, and it is deliberate.
     */
    if (typeof company === "string" && company.trim() !== "") {
      console.warn("[booking] honeypot tripped, dropping submission");
      return NextResponse.json({ ok: true });
    }

    if (!name || !email || !message) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const guid = bookingFormGuid();

    if (!isConfigured(guid)) {
      // Keep local form work frictionless, but never tell a production visitor
      // an enquiry was received when it was only written to a function log.
      if (process.env.NODE_ENV !== "development") {
        return NextResponse.json(
          { error: "Bookings are not connected yet. Please try again later." },
          { status: 503 },
        );
      }
      console.log(`[booking] ${type} from ${name} <${email}>: ${message}`);
      void captureLead({
        receivedAt: new Date().toISOString(),
        kind: "booking",
        name,
        email,
        enquiryType: typeof type === "string" ? type : undefined,
        message,
      });
      return NextResponse.json({ ok: true, developmentOnly: true });
    }

    const { firstName, lastName } = splitName(String(name));

    const delivered = await submitForm(
      guid,
      [
        { name: "firstname", value: firstName },
        { name: "lastname", value: lastName },
        { name: "email", value: String(email) },
        { name: "message", value: String(message) },
        {
          name: INQUIRY_TYPE_PROPERTY,
          value: typeof type === "string" ? type : "",
        },
      ],
      {
        pageUri: "https://yanchanproduced.com/#booking",
        pageName: "Booking enquiry",
        // From the cookie only — see hutkFromRequest.
        hutk: hutkFromRequest(req),
      },
    );

    if (!delivered.ok) {
      return NextResponse.json(
        { error: "We could not send that just now. Please try again in a moment." },
        { status: 502 },
      );
    }

    // Delivered AND captured: HubSpot is the destination, the local store is
    // the development-time net beneath it. Fire-and-forget by contract — on
    // Vercel `data/` cannot be written at all, and that must not fail a
    // submission HubSpot has already accepted.
    void captureLead({
      receivedAt: new Date().toISOString(),
      kind: "booking",
      name,
      email,
      enquiryType: typeof type === "string" ? type : undefined,
      message,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
