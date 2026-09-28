/**
 * HubSpot form submission — the delivery path for both site forms.
 *
 * Endpoint:
 *   POST submissions/v3/integration/submit/{portalId}/{formGuid}
 *
 * No authentication. HubSpot does the contact create-or-update, the dedupe by
 * email and the form-submission timeline entry; we only have to hand it clean
 * fields.
 *
 * WHAT A 200 FROM THIS ENDPOINT DOES NOT MEAN
 *
 * It does not mean "stored". Probed against the live booking form, this
 * endpoint returned 200 for a field name that does not exist on the form, and
 * 200 for `email: "not-an-email"` — and created no contact for either. It only
 * errors when the required `email` key is missing outright. HubSpot accepts for
 * processing and discards downstream, silently.
 *
 * Three consequences run through everything below:
 *
 *   1. There is no loud failure when a field is missing from the form. If the
 *      Message field is ever removed in HubSpot, booking messages vanish and
 *      every response stays 200. Nothing here can detect that; it is a standing
 *      hazard recorded in the README.
 *   2. The caller MUST validate the email before calling. Both routes already
 *      do. HubSpot will take a malformed address and bin it without complaint.
 *   3. "Verified" means reading the contact in HubSpot, never a status code.
 *
 * Spec: openspec/changes/hubspot-form-backend/specs/lead-capture/spec.md
 */

/** Bound on the call. A serverless function must not hang on a third party. */
const TIMEOUT_MS = 8_000;

export type HubSpotField = { name: string; value: string };

export type SubmitResult =
  | { ok: true }
  | { ok: false; reason: "not-configured" | "rejected" | "unreachable" };

function portalId(): string {
  return (process.env.HUBSPOT_PORTAL_ID ?? "").trim();
}

/** True when this deployment has been given the ids it needs. */
export function isConfigured(formGuid: string): boolean {
  return portalId() !== "" && formGuid.trim() !== "";
}

export function bookingFormGuid(): string {
  return (process.env.HUBSPOT_BOOKING_FORM_GUID ?? "").trim();
}

export function newsletterFormGuid(): string {
  return (process.env.HUBSPOT_NEWSLETTER_FORM_GUID ?? "").trim();
}

/**
 * The HubSpot tracking cookie, read from the request. Returns "" when the
 * visitor is not tracked — which is the normal case for anyone who declined
 * analytics, and must never block a submission.
 *
 * Deliberately takes the Request rather than a value, so there is no overload
 * that could be handed something from a request body.
 */
export function hutkFromRequest(req: Request): string {
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)hubspotutk=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

/**
 * One name box becomes two properties. Split ONCE, at the first space:
 * "Maria del Carmen Santos" gives "Maria" + "del Carmen Santos". A single word
 * is a first name with no last name, and is still a valid submission.
 *
 * Splitting on the LAST space instead would mangle compound surnames more often
 * than it would help.
 */
export function splitName(full: string): { firstName: string; lastName: string } {
  const trimmed = full.trim().replace(/\s+/g, " ");
  const at = trimmed.indexOf(" ");
  if (at === -1) return { firstName: trimmed, lastName: "" };
  return { firstName: trimmed.slice(0, at), lastName: trimmed.slice(at + 1) };
}

/**
 * Deliver one submission. Never throws: a caller's response should be decided
 * by the returned result, not by a try/catch around this.
 *
 * Empty values are dropped rather than sent — an empty `lastname` would
 * otherwise overwrite a real surname on an existing HubSpot contact.
 */
export async function submitForm(
  formGuid: string,
  fields: HubSpotField[],
  context?: { pageUri?: string; pageName?: string; hutk?: string },
): Promise<SubmitResult> {
  if (!isConfigured(formGuid)) return { ok: false, reason: "not-configured" };

  /**
   * `hutk` is the HubSpot tracking cookie. Supplying it joins this submission
   * to the browsing session that produced it, which is the whole point of
   * running the tracker. It is omitted entirely rather than sent empty: an
   * empty string is a value HubSpot would try to resolve and fail on.
   *
   * It must only ever reach here from a request COOKIE, never from a request
   * body — a caller-chosen token would let anyone staple their enquiry onto
   * someone else's session.
   */
  const hutk = (context?.hutk ?? "").trim();

  const payload = {
    fields: fields
      .map((f) => ({ name: f.name, value: (f.value ?? "").trim() }))
      .filter((f) => f.value !== ""),
    context: {
      pageUri: context?.pageUri ?? "https://yanchanproduced.com",
      pageName: context?.pageName ?? "Yanchan Produced",
      ...(hutk ? { hutk } : {}),
    },
  };

  try {
    const res = await fetch(
      `https://api.hsforms.com/submissions/v3/integration/submit/${portalId()}/${formGuid}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );

    if (!res.ok) {
      // HubSpot names the offending field in its error body. Log it: without
      // this a rejection is an opaque status in a function log.
      const detail = await res.text().catch(() => "");
      console.error(`[hubspot] ${res.status} submitting ${formGuid}: ${detail.slice(0, 500)}`);
      return { ok: false, reason: "rejected" };
    }
    return { ok: true };
  } catch (err) {
    // Timeout, DNS, TLS, offline.
    console.error(
      `[hubspot] unreachable submitting ${formGuid}:`,
      err instanceof Error ? err.message : err,
    );
    return { ok: false, reason: "unreachable" };
  }
}
