import type { MerchSku, StockState } from "@/lib/merch";

/**
 * JSON-LD, built from the same values the pages render.
 *
 * The rule the spec sets is that structured data must never state something
 * different from what a visitor sees — a mismatch is both a search penalty and
 * a lie to the buyer. The only durable way to honour that is a single source,
 * so everything here takes the already-resolved catalogue entry and stock state
 * rather than a hand-kept copy that drifts the first time a price changes.
 *
 * Server components only: these render a script tag into the page, no client
 * JavaScript involved.
 *
 * Spec: openspec/changes/launch-readiness-audit/specs/search-discoverability/spec.md
 */

const SITE = "https://yanchanproduced.com";

function Ld({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // The payload is built from our own content, never from user input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

/**
 * Who the site is about. Rendered once, site-wide, so every page carries the
 * entity an answer engine needs in order to say anything grounded about
 * "Yanchan Produced" rather than inferring it from prose.
 */
export function SiteJsonLd({ socials }: { socials: string[] }) {
  return (
    <Ld
      data={{
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "WebSite",
            "@id": `${SITE}/#website`,
            url: SITE,
            name: "Yanchan Produced",
            publisher: { "@id": `${SITE}/#person` },
          },
          {
            "@type": ["Person", "MusicGroup"],
            "@id": `${SITE}/#person`,
            name: "Yanchan Produced",
            alternateName: "Yanchan Rajmohan",
            url: SITE,
            jobTitle: "Music producer, mixing engineer and mridangam player",
            description:
              "Canadian-Tamil producer, mixing engineer, singer and professional mridangam player from Scarborough, Ontario, bridging South Indian classical percussion and North American hip-hop.",
            genre: ["Hip-hop", "Carnatic", "South Asian fusion"],
            instrument: "Mridangam",
            nationality: { "@type": "Country", name: "Canada" },
            homeLocation: {
              "@type": "Place",
              address: {
                "@type": "PostalAddress",
                addressLocality: "Scarborough",
                addressRegion: "ON",
                addressCountry: "CA",
              },
            },
            sameAs: socials,
          },
        ],
      }}
    />
  );
}

/**
 * A product, with the availability the card actually shows. A pre-order SKU
 * reports PreOrder: claiming InStock because it is buyable would be exactly the
 * mismatch the spec forbids.
 */
export function ProductJsonLd({
  sku,
  state,
  image,
}: {
  sku: MerchSku;
  state: StockState;
  image?: string;
}) {
  return (
    <Ld
      data={{
        "@context": "https://schema.org",
        "@type": "Product",
        name: `${sku.name} · ${sku.colourway}`,
        description: sku.blurb,
        sku: sku.id,
        brand: { "@type": "Brand", name: "Yanchan Produced" },
        ...(image ? { image: `${SITE}${image}` } : {}),
        offers: {
          "@type": "Offer",
          url: `${SITE}/store/${sku.id}`,
          priceCurrency: "CAD",
          price: sku.priceCad,
          availability:
            state === "pre-order"
              ? "https://schema.org/PreOrder"
              : "https://schema.org/InStock",
          seller: { "@id": `${SITE}/#person` },
        },
      }}
    />
  );
}

/** A tour date. Only future, confirmed dates should be passed in. */
export function EventJsonLd({
  events,
}: {
  events: { date: string; city: string; venue: string; url?: string }[];
}) {
  if (events.length === 0) return null;
  return (
    <Ld
      data={{
        "@context": "https://schema.org",
        "@graph": events.map((e) => ({
          "@type": "MusicEvent",
          name: `Yanchan Produced · ${e.city}`,
          startDate: e.date,
          eventStatus: "https://schema.org/EventScheduled",
          eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
          location: {
            "@type": "Place",
            name: e.venue,
            address: { "@type": "PostalAddress", addressLocality: e.city },
          },
          performer: { "@id": `${SITE}/#person` },
          ...(e.url ? { url: e.url } : {}),
        })),
      }}
    />
  );
}

/** A press piece. `outlet` is the publisher, not us. */
export function ArticleJsonLd({
  title,
  deck,
  slug,
  outlet,
  date,
  image,
}: {
  title: string;
  deck: string;
  slug: string;
  outlet: string;
  date: string;
  image?: string;
}) {
  return (
    <Ld
      data={{
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        headline: title,
        description: deck,
        datePublished: date,
        url: `${SITE}/press/${slug}`,
        mainEntityOfPage: `${SITE}/press/${slug}`,
        publisher: { "@type": "Organization", name: outlet },
        about: { "@id": `${SITE}/#person` },
        ...(image ? { image: `${SITE}${image}` } : {}),
      }}
    />
  );
}
