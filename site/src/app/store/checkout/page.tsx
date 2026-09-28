import type { Metadata } from "next";
import { CheckoutPanel } from "@/components/checkout-panel";

export const metadata: Metadata = {
  title: "Checkout",
  description: "Secure checkout for Yanchan Produced tour merch.",
  robots: { index: false, follow: false },
};

/** Never prerendered: the panel prices the cart against Square live. */
export const dynamic = "force-dynamic";

export default function CheckoutPage() {
  return (
    <main className="min-h-screen pt-16 sm:pt-20">
      <CheckoutPanel />
    </main>
  );
}
