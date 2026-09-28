/**
 * The ops dashboard reads the brand-deals CRM (contacts, deal values, pipeline
 * stage). It must never be reachable from the public site. It stays available
 * locally, and on any deploy that explicitly opts in with OPS_DASHBOARD=1.
 */
export const INTERNAL_TOOLS_ENABLED =
  process.env.OPS_DASHBOARD === "1" || process.env.NODE_ENV === "development";
