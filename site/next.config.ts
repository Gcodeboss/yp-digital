import type { NextConfig } from "next";

/**
 * Content-Security-Policy, REPORT-ONLY on purpose.
 *
 * This site loads Square's Web Payments SDK, an Apple Pay sheet in a
 * cross-origin iframe, GA4, Clarity, HubSpot, Vercel Speed Insights, Google
 * Fonts and YouTube embeds. A hand-written enforcing policy against that list
 * will break checkout, and breaking checkout to improve a header grade is a bad
 * trade on a site taking money. Report-only collects the real violation set
 * first; it gets promoted to enforcing once that data exists.
 *
 * Frame protection is the exception and enforces immediately below — it is the
 * finding with a direct path to buyer harm and it has no such blast radius.
 *
 * Spec: openspec/changes/launch-readiness-audit/specs/site-security/spec.md
 */
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  // Square's SDK and the analytics vendors are all script origins.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://web.squarecdn.com https://sandbox.web.squarecdn.com https://js.squareup.com https://www.googletagmanager.com https://www.clarity.ms https://js.hs-scripts.com https://js.hs-analytics.net https://js.hsadspixel.net https://js.usemessages.com https://va.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://i.ytimg.com https://i.scdn.co https://items-images-production.s3.us-west-2.amazonaws.com https://*.clarity.ms https://track.hubspot.com https://forms.hsforms.com",
  "connect-src 'self' https://connect.squareup.com https://pci-connect.squareup.com https://*.clarity.ms https://www.google-analytics.com https://*.google-analytics.com https://*.hubapi.com https://*.hsforms.com https://api.hsforms.com https://vitals.vercel-insights.com",
  // Square's payment fields and Apple Pay render in iframes; so do YouTube embeds.
  "frame-src 'self' https://web.squarecdn.com https://sandbox.web.squarecdn.com https://js.squareup.com https://www.youtube.com https://www.youtube-nocookie.com",
  // Nobody may frame us. This one also enforces via X-Frame-Options below.
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const SECURITY_HEADERS = [
  // Enforcing from day one: the checkout must not be framable by anyone.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    // Deny what the site does not use. `payment` stays ALLOWED for Apple Pay
    // and Google Pay on the checkout — removing it would kill the wallets.
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(self \"https://web.squarecdn.com\" \"https://js.squareup.com\")",
  },
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
];

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // YouTube thumbnails for the video gallery on /music
      new URL("https://i.ytimg.com/vi/**"),
      // Spotify cover art for the discography
      new URL("https://i.scdn.co/image/**"),
    ],
  },

  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },

  async redirects() {
    return [
      {
        // The free kit is not running. The page is gone, but the URL was live
        // and indexable, so it points at the thing that IS selling rather than
        // becoming a 404.
        source: "/free-kit",
        destination: "/store",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
