import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { INTERNAL_TOOLS_ENABLED } from "@/lib/internal-only";
import { Body, Shell, TopBar } from "../yp-chrome";
import { LeadsClient } from "./leads-client";

export const metadata: Metadata = {
  title: "YP Dash · Leads",
  description: "Internal lead inbox: booking enquiries and newsletter sign-ups.",
  robots: { index: false, follow: false },
};

// Internal tool — 404s on the public deploy. See lib/internal-only.ts
export const dynamic = "force-dynamic";

/**
 * The lead inbox. Every accepted booking enquiry and newsletter sign-up is
 * captured by the API routes into the local lead store; this screen is the
 * read side. Like the merch admin it holds PII, so the gate is the first
 * statement and nothing on the public site links here.
 */
export default function LeadsPage() {
  if (!INTERNAL_TOOLS_ENABLED) notFound();

  return (
    <Shell active="Leads">
      <TopBar title="Leads">
        <span className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-dim">
          Booking enquiries and newsletter sign-ups, newest first
        </span>
      </TopBar>
      <Body>
        <LeadsClient />
      </Body>
    </Shell>
  );
}
