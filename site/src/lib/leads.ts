/**
 * Lead capture: every accepted booking enquiry and newsletter sign-up is
 * appended to a local, append-only JSONL store so a lead is never lost when
 * webhooks or third-party services are down.
 *
 * ┌─ SERVER ONLY ───────────────────────────────────────────────────────────┐
 * │ node:fs module — never import from a client component.                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Two hard rules, from the lead-capture spec:
 *
 * 1. Capture NEVER changes the visitor-visible outcome. `captureLead` logs
 *    and swallows every failure; routes call it fire-and-forget on their
 *    success path only. A lead store that is missing, unwritable or full
 *    must not turn a submitted enquiry into an error the submitter sees.
 * 2. Lead data stays out of the repo and the logs. The store lives under
 *    `data/` (gitignored, stripped from Vercel by `.vercelignore`), records
 *    are never `console.log`ged, and the read path goes through the
 *    OPS-gated `/api/leads` only.
 *
 * Vercel's filesystem is ephemeral: on a deployed function a capture may not
 * survive the instance. That is accepted and documented — this store is the
 * safety net under the webhook, strictly better than the old log line, and
 * authoritative on local/dev and any persistent deployment.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const LEADS_FILE = path.join(DATA_DIR, "leads.jsonl");

export type LeadKind = "booking" | "newsletter";

export type Lead = {
  /** ISO timestamp of the accepted submission. */
  receivedAt: string;
  kind: LeadKind;
  email: string;
  /** Booking enquiries carry the submitter's name. */
  name?: string;
  /** Booking enquiry type (production, mix, session, …). */
  enquiryType?: string;
  /** The booking message. */
  message?: string;
  /** Newsletter attribution (footer, hero, store, …). */
  source?: string;
};

/**
 * Append one lead. Best-effort by contract: any failure is logged and
 * swallowed so the calling route's response is never affected.
 */
export async function captureLead(lead: Lead): Promise<void> {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await appendFile(LEADS_FILE, `${JSON.stringify(lead)}\n`, "utf8");
  } catch (err) {
    console.error("[leads] capture failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Most recent leads first, capped at `limit`. A missing or unreadable store
 * reads as empty — the dashboard shows "no leads yet", never an error.
 */
export async function readLeads(limit = 200): Promise<Lead[]> {
  let raw: string;
  try {
    raw = await readFile(LEADS_FILE, "utf8");
  } catch {
    return [];
  }
  const leads: Lead[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      leads.push(JSON.parse(trimmed) as Lead);
    } catch {
      // A torn line from a killed write is skipped, not fatal.
    }
  }
  return leads.reverse().slice(0, limit);
}
