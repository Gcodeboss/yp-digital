"use client";

/**
 * Injects Google Analytics 4 and Microsoft Clarity — and only once the visitor
 * has accepted.
 *
 * Neither tag is on the page before consent. Google's documented Consent Mode
 * pattern loads gtag on every visit and pings cookielessly while denied; that
 * is still a request made by someone who was never asked, so the tag waits
 * instead. The denied-then-granted consent sequence is still pushed on load so
 * the tag never sits in an ambiguous state between load and config.
 *
 * Clarity has no equivalent of Consent Mode, so "not injected" is the only
 * honest way to guarantee it is not recording.
 *
 * Design: openspec/changes/analytics-ga4-clarity-consent/design.md
 */
import Script from "next/script";

import { CLARITY_ID, GA_ID, HUBSPOT_PORTAL_ID, useConsent } from "./consent-provider";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function AnalyticsScripts() {
  const { consent } = useConsent();
  if (consent !== "granted") return null;

  return (
    <>
      {GA_ID !== "" && (
        <>
          <Script
            id="ga4-src"
            src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
            strategy="afterInteractive"
          />
          <Script id="ga4-init" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              window.gtag = gtag;
              gtag('consent', 'default', {
                ad_storage: 'denied',
                ad_user_data: 'denied',
                ad_personalization: 'denied',
                analytics_storage: 'denied'
              });
              gtag('consent', 'update', { analytics_storage: 'granted' });
              gtag('js', new Date());
              gtag('config', '${GA_ID}');
            `}
          </Script>
        </>
      )}

      {CLARITY_ID !== "" && (
        /*
         * Masking is NOT configured here, and that is deliberate.
         * `clarity("set", k, v)` writes a CUSTOM TAG — a line such as
         * `clarity('set','mask','true')` reads like it protects the checkout
         * and in fact does nothing at all. Masking is a project-level setting
         * in the Clarity dashboard, held at "Mask all", backed by
         * `data-clarity-mask` on the checkout form so the guarantee also
         * travels with the code rather than living only in a vendor console.
         *
         * `clarity("consent")` is the one call that belongs here: it records
         * that the visitor agreed, which is only ever true at this point
         * because this component does not render otherwise.
         */
        <Script id="clarity-init" strategy="afterInteractive">
          {`
            (function(c,l,a,r,i,t,y){
              c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
              t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
              y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
            })(window, document, "clarity", "script", "${CLARITY_ID}");
            window.clarity('consent');
          `}
        </Script>
      )}

      {HUBSPOT_PORTAL_ID !== "" && (
        /*
         * HubSpot's tracker, injected on acceptance and not before — the same
         * rule as Clarity, for the same reason: it has no denied-state that
         * reliably prevents collection, and absent cannot track.
         *
         * It sets the `hubspotutk` cookie, which the form routes read
         * server-side and pass to HubSpot as `context.hutk`. That is what joins
         * a booking enquiry to the pages the visitor actually read.
         */
        <Script
          id="hubspot-tracking"
          src={`https://js.hs-scripts.com/${HUBSPOT_PORTAL_ID}.js`}
          strategy="afterInteractive"
          async
          defer
        />
      )}
    </>
  );
}
