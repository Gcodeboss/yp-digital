/**
 * GET /api/leads: the lead store, for the internal dashboard only.
 *
 * The gate is the same one the dashboard pages use: 404 unless the internal
 * tools are enabled, so the endpoint does not confirm its own existence on a
 * public deploy. Leads are PII — they never render anywhere else.
 */
import { NextResponse } from "next/server";

import { INTERNAL_TOOLS_ENABLED } from "@/lib/internal-only";
import { readLeads } from "@/lib/leads";

export const runtime = "nodejs";

export async function GET() {
  if (!INTERNAL_TOOLS_ENABLED) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ leads: await readLeads(200) });
}
