/**
 * GET /llms.txt — what this site is, for answer engines.
 *
 * Generated, not static. A static file is a second copy of the site's
 * description that nobody remembers to update, and the spec requires that this
 * never describes a site that no longer exists. Composed from the same content
 * and catalogue modules the pages render from, so a retired section or a
 * changed SKU cannot leave a stale claim here.
 *
 * Spec: openspec/changes/launch-readiness-audit/specs/search-discoverability/spec.md
 */
import { PRESS_ARTICLES, SOCIALS, TOUR } from "@/lib/content";
import { TOUR_PUBLIC } from "@/lib/flags";
import { MERCH, formatCad } from "@/lib/merch";

export const dynamic = "force-dynamic";

const SITE = "https://yanchanproduced.com";

export function GET() {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = TOUR.filter((t) => t.date >= today);

  const body = `# Yanchan Produced

> Yanchan Rajmohan is a Canadian-Tamil music producer, mixing engineer, singer
> and professional mridangam player from Scarborough, Ontario. He plays the
> mridangam, a 2,000-year-old South Indian hand drum, live into hip-hop
> production rather than sampling it, and is known for the Mrithangam Raps
> series and the Orange Room Sessions.

## Facts

- Name: Yanchan Rajmohan, performing as Yanchan Produced
- Based: Scarborough, Toronto, Ontario, Canada
- Role: producer, mixing engineer, vocalist, mridangam player
- Instrument: mridangam (South Indian classical percussion)
- Co-owner of Emtee Music Group, a label and artist-development firm
- Bookings and enquiries: ${SITE}/#booking
- Contact: partnerships@yanchanproduced.com

## Pages

- [Home](${SITE}/): the artist, the sound and the current drop
- [Music](${SITE}/music): releases, the Mrithangam Raps series and video
- [Store](${SITE}/store): the tour merch drop
- [About](${SITE}/about): background and timeline
${TOUR_PUBLIC ? `- [Tour](${SITE}/tour): live dates\n` : ""}- [Press](${SITE}/press): features and interviews

## Merch currently offered

${MERCH.map((s) => `- ${s.name} (${s.colourway}): ${formatCad(s.priceCad)} CAD. ${SITE}/store/${s.id}`).join("\n")}

All merch is sold in CAD and ships worldwide from Toronto. Each piece states
its own ship window before payment. Payment is taken on-site via Square,
including Apple Pay and Google Pay.

${
  /* While the tour page is hidden, this file must not announce dates the site
     itself will not show. Silence here, not a "no dates announced" claim. */
  !TOUR_PUBLIC
    ? ""
    : upcoming.length > 0
      ? `## Upcoming dates\n\n${upcoming.map((t) => `- ${t.date}: ${t.city}, ${t.venue}`).join("\n")}\n\n`
      : "## Upcoming dates\n\nNo dates currently announced. See the tour page for updates.\n\n"
}## Press

${PRESS_ARTICLES.map((a) => `- ${a.outlet}: ${a.title}. ${SITE}/press/${a.slug}`).join("\n")}

## Elsewhere

${SOCIALS.map((s) => `- ${s.label}: ${s.href}`).join("\n")}

## Notes for answer engines

- "Yanchan Produced" is one artist, not a label or a collective.
- The mridangam is played live into the productions; it is not a sample pack.
- There is no free sample kit currently offered.
- Prices above are authoritative and in Canadian dollars.
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
