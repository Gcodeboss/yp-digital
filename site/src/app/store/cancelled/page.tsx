import type { Metadata } from "next";
import { OpenCartButton } from "@/components/cart-drawer";
import { Button, Section, SectionHeading } from "@/components/ui";

export const metadata: Metadata = {
  title: "Checkout cancelled",
  description: "Your cart is still here.",
  robots: { index: false, follow: false },
};

export default function CheckoutCancelledPage() {
  return (
    <Section className="!pt-28 sm:!pt-32">
      <SectionHeading
        eyebrow="Checkout"
        title={
          <>
            Nothing was <span className="text-amber">charged</span>
          </>
        }
        intro="You backed out at Square, so no payment was taken. Your cart is untouched: every piece, every size, still exactly where you left it."
      />
      <div className="mt-8 flex flex-wrap gap-3">
        <OpenCartButton>Reopen your cart</OpenCartButton>
        <Button href="/store" variant="ghost">
          Keep browsing the drop
        </Button>
      </div>
      <p className="mt-10 max-w-xl font-mono text-[0.68rem] uppercase leading-[1.7] tracking-[0.12em] text-warmgray">
        Stock state can move between visits. A piece that goes while you were
        away does not disappear, it becomes a pre-order at the same price, and
        every line re-states its own ship window before you pay.
      </p>
    </Section>
  );
}
