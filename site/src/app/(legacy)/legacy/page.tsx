import { LegacyHeader } from "./sections/header";
import { HeroSection } from "./sections/hero";
import { AsSeenOnSection } from "./sections/as-seen-on";
import { AboutSection } from "./sections/about";
import { LatestReleaseSection } from "./sections/latest-release";
import { LatestVideosSection } from "./sections/latest-videos";
import { PressSection } from "./sections/press";
import { BookingSection } from "./sections/booking";
import { NewsletterSection } from "./sections/newsletter";
import { LegacyFooter } from "./sections/footer";

export default function LegacyPage() {
  return (
    <>
      <LegacyHeader />
      <HeroSection />
      <AsSeenOnSection />
      <AboutSection />
      <LatestReleaseSection />
      <LatestVideosSection />
      <PressSection />
      <BookingSection />
      <NewsletterSection />
      <LegacyFooter />
    </>
  );
}
