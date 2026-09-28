import type { Metadata, Viewport } from "next";
import {
  Anton,
  Archivo,
  Instrument_Sans,
  Instrument_Serif,
  Inter,
  JetBrains_Mono,
} from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { StoreProvider } from "@/components/store-provider";
import { MiniPlayer } from "@/components/mini-player";
import { CartDrawer } from "@/components/cart-drawer";
import { StickyCta } from "@/components/sticky-cta";
import { LegacyLayoutGuard } from "@/components/legacy-layout-guard";
import { ConsentProvider } from "@/components/consent-provider";
import { ConsentBanner } from "@/components/consent-banner";
import { AnalyticsScripts } from "@/components/analytics-scripts";
import { SiteJsonLd } from "@/components/structured-data";
import { SOCIALS } from "@/lib/content";

const display = Anton({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});
const head = Archivo({
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
  variable: "--font-head",
  display: "swap",
});
const body = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});
/**
 * The dashboard's two additions. DESIGN.md pairs the display face with
 * Liberation Sans, and the site substituted Inter — both are deliberately
 * neutral grotesques, which is why the interface reads as flat next to Anton.
 * These give the tool a voice without touching the marketing site: globals.css
 * only re-points them inside a dashboard theme.
 *
 * Instrument Sans carries the UI — same job as Inter, more character at the
 * small sizes this interface actually uses. Instrument Serif is its companion
 * face and carries human-written copy only: hooks, captions, quotes. Keeping
 * the serif off the chrome is the point — voice belongs on the words a person
 * wrote, not on the furniture around them.
 */
const ui = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ui",
  display: "swap",
});
const editorial = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-editorial",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

const SITE_URL = "https://yanchanproduced.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default:
      "Yanchan Produced · Producer · Mridangam · Scarborough to the World",
    template: "%s · Yanchan Produced",
  },
  description:
    "Canadian-Tamil producer, mixing engineer, singer, and professional Mridangam player. Bridging South Indian tradition with North American hip-hop. Music, merch, and bookings.",
  keywords: [
    "Yanchan",
    "Yanchan Produced",
    "Tamil producer",
    "Mridangam",
    "Tamil hip-hop",
    "Scarborough",
    "Carnatic hip-hop",
  ],
  openGraph: {
    type: "website",
    url: SITE_URL,
    title: "Yanchan Produced",
    description:
      "Bridging South Indian tradition with North American hip-hop. Music, merch & bookings.",
    images: [{ url: "/assets/hero-artist.jpg", width: 1920, height: 1040 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Yanchan Produced",
    description: "Bridging South Indian tradition with North American hip-hop.",
    images: ["/assets/hero-artist.jpg"],
  },
  /*
    NO blanket canonical here. It used to be `canonical: SITE_URL`, which Next
    applied to every route that did not override it — so /about, /press, /tour,
    /store, /music and /free-kit all told Google they were duplicates of the
    homepage. Each route now declares its own. `metadataBase` above is what
    makes those relative paths resolve.
  */
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${head.variable} ${body.variable} ${ui.variable} ${editorial.variable} ${mono.variable}`}
    >
      <body className="grain min-h-dvh bg-void text-cream">
        {/* Who this site is about. Every page carries it. */}
        <SiteJsonLd socials={SOCIALS.map((s) => s.href)} />
        <ConsentProvider>
          <StoreProvider>
            <LegacyLayoutGuard>
              <SiteHeader />
            </LegacyLayoutGuard>
            <main className="relative z-[2]">{children}</main>
            <LegacyLayoutGuard>
              <SiteFooter />
              <StickyCta />
              <CartDrawer />
              <MiniPlayer />
            </LegacyLayoutGuard>
          </StoreProvider>
          {/* Nothing loads until the visitor accepts. See consent-provider. */}
          <AnalyticsScripts />
          <ConsentBanner />
        </ConsentProvider>
        {/*
          Web Vitals only. Speed Insights sets no cookie and carries no visitor
          identifier, so it sits outside the consent gate — there is nothing to
          consent to. Visitor analytics (GA4 + Clarity) live behind
          ConsentProvider above and load only once a visitor has accepted.
        */}
        <SpeedInsights />
      </body>
    </html>
  );
}
