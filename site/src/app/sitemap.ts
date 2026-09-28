import type { MetadataRoute } from "next";
import { PRESS_ARTICLES } from "@/lib/content";
import { TOUR_PUBLIC } from "@/lib/flags";
import { MERCH } from "@/lib/merch";

const BASE = "https://yanchanproduced.com";

/**
 * Every indexable page, and nothing else.
 *
 * Product pages are generated from the catalogue rather than listed by hand, so
 * adding a SKU adds its page here with no second edit to remember. The audit
 * found five product pages and `/free-kit` missing precisely because the list
 * was hand-maintained; `/free-kit` has since been retired.
 *
 * Dashboard, API and legacy routes are absent by construction — they are also
 * disallowed in robots.txt, and they 404 in production.
 *
 * Spec: openspec/changes/launch-readiness-audit/specs/search-discoverability/spec.md
 */
export default function sitemap(): MetadataRoute.Sitemap {
  // /tour is absent while TOUR_PUBLIC is false: it redirects, and a sitemap
  // must never advertise a URL that does not serve a page.
  const sections = [
    "",
    "/music",
    "/store",
    "/about",
    ...(TOUR_PUBLIC ? ["/tour"] : []),
    "/press",
  ];

  const pages: MetadataRoute.Sitemap = sections.map((r) => ({
    url: `${BASE}${r}`,
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: r === "" ? 1 : 0.7,
  }));

  const products: MetadataRoute.Sitemap = MERCH.map((sku) => ({
    url: `${BASE}/store/${sku.id}`,
    lastModified: new Date(),
    changeFrequency: "weekly",
    // Above the press archive: these are the pages the drop depends on.
    priority: 0.8,
  }));

  const articles: MetadataRoute.Sitemap = PRESS_ARTICLES.map((a) => ({
    url: `${BASE}/press/${a.slug}`,
    lastModified: new Date(a.date),
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [...pages, ...products, ...articles];
}
