import { notFound } from "next/navigation";
import { INTERNAL_TOOLS_ENABLED } from "@/lib/internal-only";
import { DashboardClient } from "./dashboard-client";

/**
 * The original prototype console, kept as-is and unlinked.
 *
 * It carries hardcoded copy from before the pipeline existed — "2H42M Kick VOD",
 * "258K audience", "Import UI shell ready" — which reads as live data on a screen
 * that otherwise shows live data. It is preserved here rather than deleted, but
 * /dashboard now serves the real overview.
 */
export const dynamic = "force-dynamic";

export default function LegacyDashboardPage() {
  if (!INTERNAL_TOOLS_ENABLED) notFound();
  return <DashboardClient />;
}
