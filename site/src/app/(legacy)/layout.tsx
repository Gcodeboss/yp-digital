import type { Metadata, Viewport } from "next";
import { Poppins, Cousine } from "next/font/google";
import "./legacy.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

const cousine = Cousine({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-cousine",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Yanchan Produced — Legacy",
  description:
    "Legacy homepage of Yanchan Produced — producer, mridangam artist, and beat maker bridging South Indian tradition with North American hip-hop.",
};

export const viewport: Viewport = {
  themeColor: "#131b0e",
  width: "device-width",
  initialScale: 1,
};

// NOTE: this is a nested layout, not a root layout — `src/app/layout.tsx` sits
// above it and already renders <html>/<body>. Rendering a second <html>/<body>
// here produced invalid nesting and a hydration mismatch (React #418), which
// made the client throw away the server-rendered legacy page.
export default function LegacyLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={`${poppins.variable} ${cousine.variable} legacy-body`}>
      {children}
    </div>
  );
}
