import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { INTERNAL_TOOLS_ENABLED } from "@/lib/internal-only";
import { readMerchAdminSnapshot } from "@/lib/merch-admin";
import { MERCH, sellable } from "@/lib/merch";
import { Body, Chip, Label, Shell, TopBar } from "../yp-chrome";
import { MerchClient } from "./merch-client";

export const metadata: Metadata = {
  title: "YP Dash · Merch",
  description: "Internal merch order and stock console.",
  robots: { index: false, follow: false },
};

/**
 * The merch admin.
 *
 * Internal only, and the only screen on this site that renders a buyer's name,
 * email or shipping address, so the gate is the first statement in the
 * component, before any Square call is made. `notFound()` renders the 404 that
 * a public deploy would show for a route that does not exist; there is no
 * "forbidden" page, because a 403 would confirm the tool is here.
 *
 * It is a VIEW over Square. Orders are read at request time and never written
 * to disk: `.vercelignore` strips `data/` from every deploy and Vercel's
 * filesystem is ephemeral, so a local copy would look correct in `next dev` and
 * silently drift from the payment record in production.
 *
 * Nothing links here: not the nav, not `/store`, not the dashboard rail. The
 * URL is the only way in, which is what the spec asks for.
 *
 * Spec: openspec/changes/merch-square-rail/specs/merch-order-admin/spec.md
 */
export const dynamic = "force-dynamic";

export default async function MerchAdminPage() {
  if (!INTERNAL_TOOLS_ENABLED) notFound();

  const snapshot = await readMerchAdminSnapshot();

  const produced = MERCH.reduce((a, s) => a + s.produced, 0);
  const totalSellable = MERCH.reduce((a, s) => a + sellable(s), 0);
  const squareChip = !snapshot.squareConfigured
    ? { tone: "rust" as const, text: "square · not connected" }
    : snapshot.squareError
      ? snapshot.orders.length > 0
        ? { tone: "rust" as const, text: "square · partial read" }
        : { tone: "rust" as const, text: "square · read failed" }
      : { tone: "amber" as const, text: "square · live" };

  return (
    <Shell active="Merch">
      <TopBar title="Merch" actions={<Label>internal only · buyer data never leaves this gate</Label>}>
        <Chip>{MERCH.length} skus</Chip>
        <Chip>
          {totalSellable} sellable of {produced} produced
        </Chip>
        <Chip tone={squareChip.tone}>{squareChip.text}</Chip>
      </TopBar>

      <Body>
        <MerchClient initial={snapshot} />
      </Body>
    </Shell>
  );
}
