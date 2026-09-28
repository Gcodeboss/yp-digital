/**
 * A per-IP fixed-window limiter for the endpoints that cost something.
 *
 * WHAT THIS IS NOT, stated plainly because the limitation matters more than the
 * feature: this counter lives in module scope on a serverless function. It is
 * **per instance and resets on cold start**, so it will not stop a distributed
 * flood, and a determined attacker spreading across instances walks through it.
 *
 * What it does stop is the case that actually happens to a site this size: one
 * script hammering one endpoint until the CRM is full of junk or Square is full
 * of abandoned orders. That is worth having, and it is strictly better than the
 * zero that was here before.
 *
 * The honest alternative is Upstash or Vercel KV — a paid dependency and
 * another account, for a site taking a handful of enquiries a day. The upgrade
 * trigger is written down rather than left to judgement: **the first time spam
 * actually lands in HubSpot, move to a shared store.**
 *
 * Spec: openspec/changes/launch-readiness-audit/specs/site-security/spec.md
 */

type Window = { count: number; resetAt: number };

const buckets = new Map<string, Window>();

/** Stops the map growing without bound on a long-lived instance. */
const MAX_TRACKED = 5_000;

/**
 * The client's address. Vercel sets `x-forwarded-for`; the left-most entry is
 * the original client. Falls back to a single shared bucket when there is no
 * address at all, which is the conservative direction: unknown callers share a
 * limit rather than each getting their own.
 */
function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const first = fwd.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip") || "unknown";
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * Consume one unit against `name` for this caller.
 *
 * `limit` requests per `windowMs`. Returns a result rather than throwing, so a
 * route decides its own response.
 */
export function rateLimit(
  req: Request,
  name: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const key = `${name}:${clientKey(req)}`;

  if (buckets.size > MAX_TRACKED) {
    // Cheapest possible eviction: drop everything already expired, and if that
    // frees nothing, drop the whole map. Both are safe — losing state here can
    // only ever be more permissive, never less, and the next request rebuilds it.
    for (const [k, w] of buckets) if (w.resetAt <= now) buckets.delete(k);
    if (buckets.size > MAX_TRACKED) buckets.clear();
  }

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }

  if (existing.count >= limit) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return { ok: true };
}

/**
 * Limits, chosen so a person correcting a typo and resubmitting is never
 * touched, while a script is. A booking enquiry is a considered act; five in
 * ten minutes is already generous.
 */
export const LIMITS = {
  booking: { limit: 5, windowMs: 10 * 60_000 },
  subscribe: { limit: 5, windowMs: 10 * 60_000 },
  /** Pricing is read-only and the checkout page re-quotes on every cart edit. */
  quote: { limit: 60, windowMs: 10 * 60_000 },
  /** Payment attempts: enough for a declined card and a retry, not a card-testing run. */
  pay: { limit: 10, windowMs: 10 * 60_000 },
} as const;
