"use client";

/**
 * Lead inbox client. Reads the OPS-gated /api/leads and renders the newest
 * submissions first. The API already 404s for anyone without the gate, so a
 * failed fetch here renders the same empty state as "no leads yet" — the
 * screen never confirms or denies its own existence.
 */
import { useEffect, useState } from "react";
import { Chip, EmptyState, Label, Section } from "../yp-chrome";

type Lead = {
  receivedAt: string;
  kind: "booking" | "newsletter";
  email: string;
  name?: string;
  enquiryType?: string;
  message?: string;
  source?: string;
};

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function LeadsClient() {
  const [leads, setLeads] = useState<Lead[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/leads")
      .then((res) => (res.ok ? res.json() : { leads: [] }))
      .then((data) => {
        if (!cancelled) setLeads(Array.isArray(data?.leads) ? data.leads : []);
      })
      .catch(() => {
        if (!cancelled) setLeads([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (leads === null) {
    return (
      <Section title="Leads">
        <Label>Loading</Label>
      </Section>
    );
  }

  if (leads.length === 0) {
    return (
      <Section title="Leads">
        <EmptyState
          title="No leads captured yet"
          body="Accepted booking enquiries and newsletter sign-ups land here. Nothing is staged for the shot — the list is the store."
        />
      </Section>
    );
  }

  const bookings = leads.filter((l) => l.kind === "booking").length;
  const newsletters = leads.length - bookings;

  return (
    <>
      <div className="mb-4 flex gap-6">
        <span className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-dim">
          <span className="text-ink">{leads.length}</span> leads
        </span>
        <span className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-dim">
          <span className="text-ink">{bookings}</span> booking
        </span>
        <span className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-dim">
          <span className="text-ink">{newsletters}</span> newsletter
        </span>
      </div>
      <Section title="Inbox">
        <ul className="divide-y divide-line">
          {leads.map((lead, i) => (
            <li key={`${lead.receivedAt}-${i}`} className="py-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <Chip tone={lead.kind === "booking" ? "amber" : "muted"}>
                  {lead.kind === "booking" ? "Booking" : "Newsletter"}
                </Chip>
                <span className="font-head text-sm font-semibold text-ink">
                  {lead.name || lead.email}
                </span>
                {lead.name && (
                  <span className="font-mono text-[0.7rem] text-ink-dim">{lead.email}</span>
                )}
                <span className="ml-auto font-mono text-[0.65rem] text-ink-dim">
                  {when(lead.receivedAt)}
                </span>
              </div>
              {(lead.enquiryType || lead.source) && (
                <p className="mt-1 font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-dim">
                  {lead.enquiryType ?? lead.source}
                </p>
              )}
              {lead.message && (
                <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-ink/80 line-clamp-3">
                  {lead.message}
                </p>
              )}
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
