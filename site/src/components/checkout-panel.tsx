"use client";

/**
 * On-site checkout: Square Web Payments SDK embedded in the site, so the buyer
 * never leaves the page. Apple Pay and Google Pay tokenize in the wallet
 * sheet; the card path uses Square's secure card fields plus verifyBuyer
 * (SCA). Either way only a single-use token reaches `/api/checkout/pay`,
 * and the server prices the order from Square's catalogue — this component
 * sends ids, sizes and quantities and nothing that costs money.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Lock,
  PackageCheck,
  ShieldCheck,
  ShoppingBag,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { trackBeginCheckout } from "@/lib/analytics";
import { STATE_COPY, formatCad } from "@/lib/merch";
import { MerchThumb } from "./merch-grid";
import { useStore } from "./store-provider";
import { Button } from "./ui";

/* Square's JS is loaded from the CDN at runtime; no SDK package is added. */
type SquareGlobal = {
  payments: (appId: string, locationId: string) => SquarePayments;
};

type SquarePayments = {
  paymentRequest: (request: Record<string, unknown>) => SquarePaymentRequest;
  applePay: (request: SquarePaymentRequest) => Promise<ApplePayMethod>;
  googlePay: (request: SquarePaymentRequest) => Promise<GooglePayMethod>;
  card: () => Promise<SquareCard>;
  verifyBuyer: (
    token: string,
    details: Record<string, unknown>
  ) => Promise<{ token?: string }>;
};

type SquarePaymentRequest = { update?: (r: Record<string, unknown>) => Promise<void> };
type ApplePayMethod = { tokenize: () => Promise<SquareTokenizeResult> };
type GooglePayMethod = {
  attach: (id: string) => Promise<void>;
  tokenize: () => Promise<SquareTokenizeResult>;
};
type SquareCard = {
  attach: (id: string) => Promise<void>;
  tokenize: () => Promise<SquareTokenizeResult>;
};
type SquareTokenizeResult = {
  status: string;
  token?: string;
  errors?: { message?: string }[];
  // Wallet sheets return the contact the buyer approved in the sheet.
  shippingContact?: WalletContact;
  billingContact?: WalletContact;
};
type WalletContact = {
  givenName?: string;
  familyName?: string;
  email?: string;
  phone?: string;
  addressLines?: string[];
  locality?: string;
  administrativeDistrict?: string;
  postalCode?: string;
  countryCode?: string;
};

declare global {
  interface Window {
    Square?: SquareGlobal;
  }
}

type QuoteLine = {
  key: string;
  name: string;
  quantity: number;
  unitAmountCents: number;
  state: "in-stock" | "pre-order";
};

type Quote = {
  lines: QuoteLine[];
  totalCents: number;
  currency: string;
};

let squarePromise: Promise<SquareGlobal> | null = null;

function loadSquare(): Promise<SquareGlobal> {
  if (typeof window !== "undefined" && window.Square) {
    return Promise.resolve(window.Square);
  }
  if (!squarePromise) {
    squarePromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://web.squarecdn.com/v1/square.js";
      script.onload = () => {
        if (window.Square) resolve(window.Square);
        else reject(new Error("Square loaded without an SDK handle."));
      };
      script.onerror = () => {
        squarePromise = null;
        reject(new Error("Square's payment SDK could not be loaded."));
      };
      document.head.appendChild(script);
    });
  }
  return squarePromise;
}

function cad(totalCents: number): string {
  return formatCad(totalCents / 100);
}

const APP_ID = process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID ?? "";
const LOCATION_ID = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID ?? "";

/** Cart → Checkout → Confirmation, so this step never reads as an unbounded form. */
const STEPS = ["Cart", "Checkout", "Confirmation"];
const CURRENT_STEP = 1;

function CheckoutSteps() {
  return (
    <ol
      aria-label="Checkout progress"
      className="flex items-center gap-2 font-mono text-[0.6rem] uppercase tracking-[0.16em]"
    >
      {STEPS.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          <span
            className={`flex items-center gap-1.5 ${
              i === CURRENT_STEP
                ? "text-cream"
                : i < CURRENT_STEP
                  ? "text-mint"
                  : "text-warmgray"
            }`}
          >
            {i < CURRENT_STEP ? (
              <Check size={12} className="shrink-0 text-mint" />
            ) : (
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[0.55rem] ${
                  i === CURRENT_STEP
                    ? "border-amber text-amber"
                    : "border-white/20 text-warmgray"
                }`}
              >
                {i + 1}
              </span>
            )}
            {label}
          </span>
          {i < STEPS.length - 1 && (
            <span aria-hidden className="h-px w-4 bg-white/15" />
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * The credibility marker, visible without scrolling on any width. Replaces
 * relying on the small `Lock · Payments by Square` line at the very bottom of
 * the page as the only signal this is a real, secured checkout. `mint` is
 * reserved for this trust meaning specifically — see `globals.css` — so it
 * never gets confused with `amber`'s pre-order/attention meaning.
 */
function TrustHeader() {
  return (
    <div className="mt-4 flex items-center gap-2.5 border border-mint/25 bg-mint/5 px-4 py-3">
      <ShieldCheck size={18} className="shrink-0 text-mint" />
      <p className="font-mono text-[0.64rem] uppercase leading-relaxed tracking-[0.12em] text-cream/90">
        Secure checkout, encrypted by Square. Your card details never touch
        this site.
      </p>
    </div>
  );
}

export function CheckoutPanel() {
  const router = useRouter();
  const { lines } = useStore();

  const merchLines = lines.filter((l) => l.kind === "merch" && l.skuId);
  const heldLines = lines.filter((l) => !(l.kind === "merch" && l.skuId));
  const hasPreorder = merchLines.some((l) => l.state === "pre-order");
  const hasInStock = merchLines.some((l) => (l.state ?? "in-stock") === "in-stock");

  const [quote, setQuote] = useState<Quote | null>(null);
  const [stage, setStage] = useState<"loading" | "ready" | "sdk-error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [appleReady, setAppleReady] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);

  // Buyer details. The card path fills all of these; the wallet paths take
  // name + address from the wallet sheet and the email from this form.
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [locality, setLocality] = useState("");
  const [region, setRegion] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("CA");

  /* Collapsed by default below the desktop breakpoint so the payment form is
     reachable without first scrolling every line item; `lg:` overrides force
     it open on desktop regardless of this flag (see the render below). */
  const [summaryExpanded, setSummaryExpanded] = useState(false);

  const attemptRef = useRef<string | null>(null);
  /**
   * Reaching checkout is one funnel step, however many times the quote is
   * re-fetched. The quote effect re-runs on every cart edit, so without this
   * a buyer changing a size on this page would look like several checkouts.
   */
  const beganCheckoutRef = useRef(false);
  function attemptId(): string {
    if (!attemptRef.current) {
      attemptRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `yp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    return attemptRef.current;
  }

  const paymentsRef = useRef<SquarePayments | null>(null);
  const cardRef = useRef<SquareCard | null>(null);
  const applePayRef = useRef<ApplePayMethod | null>(null);
  const googlePayRef = useRef<GooglePayMethod | null>(null);

  const cartPayload = () =>
    merchLines.map((l) => ({
      skuId: l.skuId as string,
      size: l.size ?? null,
      quantity: l.quantity ?? 1,
    }));

  /* Quote: the only total this page ever shows. */
  useEffect(() => {
    if (merchLines.length === 0) return;
    let cancelled = false;
    fetch("/api/checkout/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: cartPayload() }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !data?.quote) {
          setError(data?.error ?? "Could not price your cart. Try again in a moment.");
          setStage("ready");
          return;
        }
        setQuote(data.quote);
        setStage("ready");
        if (!beganCheckoutRef.current) {
          beganCheckoutRef.current = true;
          trackBeginCheckout({
            valueCad: data.quote.totalCents / 100,
            items: data.quote.lines.map(
              (l: {
                key: string;
                name: string;
                quantity: number;
                unitAmountCents: number;
              }) => ({
                // The quote key is `sku:size`; the SKU is what GA4 joins on.
                item_id: l.key.split(":")[0],
                item_name: l.name,
                item_variant: l.key.split(":")[1] ?? "One size",
                price: l.unitAmountCents / 100,
                quantity: l.quantity,
              }),
            ),
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not reach checkout. Try again in a moment.");
          setStage("ready");
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchLines.map((l) => `${l.key}:${l.quantity}`).join("|")]);

  /* Square SDK: payments + card + wallets. Wallet buttons hide themselves on
     devices/browsers that cannot pay with them. */
  useEffect(() => {
    if (stage === "loading" || !quote) return;
    let cancelled = false;
    (async () => {
      try {
        const square = await loadSquare();
        if (cancelled) return;
        const payments = square.payments(APP_ID, LOCATION_ID);
        paymentsRef.current = payments;

        const total = () => (quote ? (quote.totalCents / 100).toFixed(2) : "0.00");
        const request = payments.paymentRequest({
          countryCode: "CA",
          currencyCode: "CAD",
          total: { amount: total(), label: "Yanchan Produced" },
          requestShippingContact: true,
        });

        const card = await payments.card();
        await card.attach("#yp-card-container");
        if (cancelled) return;
        cardRef.current = card;

        try {
          const applePay = await payments.applePay(request);
          if (!cancelled) {
            applePayRef.current = applePay;
            setAppleReady(true);
          }
        } catch {
          /* Apple Pay unavailable (non-Safari, no wallet): button stays hidden. */
        }

        try {
          const googlePay = await payments.googlePay(request);
          await googlePay.attach("#yp-google-pay");
          if (!cancelled) {
            googlePayRef.current = googlePay;
            setGoogleReady(true);
          }
        } catch {
          /* Google Pay unavailable: button stays hidden. */
        }
      } catch {
        if (!cancelled) setStage("sdk-error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stage, quote]);

  async function postPayment(
    token: string,
    verificationToken: string | undefined,
    buyerOverride?: Partial<{
      name: string;
      addressLine1: string;
      addressLine2: string;
      locality: string;
      region: string;
      postalCode: string;
      country: string;
    }>
  ): Promise<void> {
    const buyer = {
      email,
      name: buyerOverride?.name ?? name,
      addressLine1: buyerOverride?.addressLine1 ?? addressLine1,
      addressLine2: buyerOverride?.addressLine2 ?? addressLine2,
      locality: buyerOverride?.locality ?? locality,
      region: buyerOverride?.region ?? region,
      postalCode: buyerOverride?.postalCode ?? postalCode,
      country: buyerOverride?.country ?? country,
    };

    const res = await fetch("/api/checkout/pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: cartPayload(),
        token,
        verificationToken: verificationToken ?? null,
        buyer,
        attemptId: attemptId(),
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.orderId) {
      setError(
        data?.error ??
          "The payment did not go through. Nothing has been charged. Try again."
      );
      setPaying(null);
      return;
    }
    router.push(`/store/success?orderId=${encodeURIComponent(data.orderId)}`);
  }

  /** Apple requires tokenize() to run synchronously inside the click. */
  function payWithApplePay() {
    if (!applePayRef.current || paying) return;
    if (!email.trim()) {
      setError("Enter your email first so the receipt can reach you.");
      return;
    }
    setError(null);
    setPaying("apple");
    void (async () => {
      try {
        const result = await applePayRef.current!.tokenize();
        if (result.status !== "Ok" || !result.token) {
          setError("Apple Pay was cancelled. Nothing has been charged.");
          setPaying(null);
          return;
        }
        const c = result.shippingContact;
        await postPayment(result.token, undefined, c ? walletContactToBuyer(c) : undefined);
      } catch {
        setError("Apple Pay did not complete. Nothing has been charged. Try again.");
        setPaying(null);
      }
    })();
  }

  function payWithGooglePay() {
    if (!googlePayRef.current || paying) return;
    if (!email.trim()) {
      setError("Enter your email first so the receipt can reach you.");
      return;
    }
    setError(null);
    setPaying("google");
    void (async () => {
      try {
        const result = await googlePayRef.current!.tokenize();
        if (result.status !== "Ok" || !result.token) {
          setError("Google Pay was cancelled. Nothing has been charged.");
          setPaying(null);
          return;
        }
        const c = result.shippingContact;
        await postPayment(result.token, undefined, c ? walletContactToBuyer(c) : undefined);
      } catch {
        setError("Google Pay did not complete. Nothing has been charged. Try again.");
        setPaying(null);
      }
    })();
  }

  function walletContactToBuyer(c: WalletContact) {
    return {
      name: [c.givenName, c.familyName].filter(Boolean).join(" "),
      addressLine1: c.addressLines?.[0] ?? "",
      addressLine2: c.addressLines?.[1] ?? "",
      locality: c.locality ?? "",
      region: c.administrativeDistrict ?? "",
      postalCode: c.postalCode ?? "",
      country: (c.countryCode ?? "CA").toUpperCase(),
    };
  }

  async function payWithCard() {
    if (!cardRef.current || paying) return;
    setError(null);
    setPaying("card");
    try {
      const result = await cardRef.current.tokenize();
      if (result.status !== "Ok" || !result.token) {
        const first = result.errors?.[0]?.message;
        setError(first ?? "The card details were not accepted. Nothing has been charged.");
        setPaying(null);
        return;
      }

      // Strong Customer Authentication: Square's documented production path.
      // The wallet methods carry their own SCA inside the sheet.
      const payments = paymentsRef.current;
      let verificationToken: string | undefined;
      try {
        if (!payments) throw new Error("payments unavailable");
        const verification = await payments.verifyBuyer(result.token, {
          amount: quote ? (quote.totalCents / 100).toFixed(2) : "0.00",
          currencyCode: "CAD",
          intent: "CHARGE",
          billingContact: {
            givenName: name.split(" ")[0] ?? name,
            familyName: name.split(" ").slice(1).join(" ") || undefined,
            email,
            countryCode: country,
            city: locality,
            addressLines: [addressLine1, addressLine2].filter(Boolean),
            postalCode,
            region,
          },
        });
        verificationToken = verification?.token;
      } catch {
        /* verifyBuyer is best-effort: the charge succeeds or fails on its own. */
      }

      await postPayment(result.token, verificationToken);
    } catch {
      setError("The card payment did not go through. Nothing has been charged. Try again.");
      setPaying(null);
    }
  }

  /* -------------------------------------------------------------- render */

  if (merchLines.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-5 py-24 text-center">
        <p className="font-display text-3xl uppercase text-cream">Nothing to check out</p>
        <p className="mt-3 text-sm text-warmgray">
          Your cart has no merch in it. The tour drop is five pieces deep.
        </p>
        <div className="mt-8">
          <Button href="/store">Shop the drop</Button>
        </div>
      </div>
    );
  }

  const cartByKey = new Map(merchLines.map((l) => [l.key, l]));
  const itemCount = quote
    ? quote.lines.reduce((n, l) => n + l.quantity, 0)
    : merchLines.reduce((n, l) => n + (l.quantity ?? 1), 0);

  return (
    <div className="mx-auto max-w-5xl px-5 py-10 sm:py-14">
      <CheckoutSteps />
      <TrustHeader />

      <div className="mt-8 grid gap-10 sm:mt-10 lg:grid-cols-[1fr_1.1fr]">
        {/* Order summary */}
        <div>
          <p className="flex items-center gap-2 border-b border-white/10 pb-2.5 font-head text-sm font-bold uppercase tracking-[0.2em] text-cream">
            <ShoppingBag size={16} className="text-amber" /> Your order
          </p>

          {/* Collapsed by default below `lg`: total + count + expand control.
              Always visible — the toggle it opens is the only thing that's
              collapsible, never the total or a pre-order/held-items notice. */}
          {!summaryExpanded && (
            <button
              type="button"
              onClick={() => setSummaryExpanded(true)}
              className="mt-4 flex min-h-11 w-full items-center justify-between border border-white/10 bg-charcoal px-3.5 py-2.5 lg:hidden"
            >
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-cream/85">
                {itemCount} {itemCount === 1 ? "item" : "items"} ·{" "}
                <span className="text-cream">{quote ? cad(quote.totalCents) : "-"}</span>
              </span>
              <span className="flex items-center gap-1 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-amber">
                Show details <ChevronDown size={14} />
              </span>
            </button>
          )}

          <ul
            className={
              summaryExpanded ? "mt-5 space-y-3" : "mt-5 hidden space-y-3 lg:block"
            }
          >
            {(quote?.lines ?? []).map((l) => {
              const cartLine = cartByKey.get(l.key);
              return (
                <li key={l.key} className="flex gap-3 border border-white/8 bg-charcoal p-3">
                  <MerchThumb art={cartLine?.art} size={cartLine?.size ?? null} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-head text-sm font-bold leading-snug text-cream">
                        {l.name}
                        {l.quantity > 1 && (
                          <span className="text-warmgray"> × {l.quantity}</span>
                        )}
                      </p>
                      <p className="shrink-0 font-head text-sm font-bold text-cream">
                        {cad(l.unitAmountCents * l.quantity)}
                      </p>
                    </div>
                    {(cartLine?.colourway || cartLine?.size) && (
                      <p className="mt-0.5 font-mono text-[0.58rem] uppercase tracking-[0.16em] text-warmgray">
                        {[cartLine?.colourway, cartLine?.size].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    <p
                      className={`mt-1.5 inline-flex items-center gap-1.5 font-mono text-[0.65rem] uppercase tracking-[0.12em] ${
                        l.state === "pre-order" ? "text-amber" : "text-warmgray"
                      }`}
                    >
                      {l.state === "pre-order" ? (
                        <Clock size={12} className="shrink-0" />
                      ) : (
                        <PackageCheck size={12} className="shrink-0" />
                      )}
                      {STATE_COPY[l.state].label} · {STATE_COPY[l.state].promise}
                    </p>
                  </div>
                </li>
              );
            })}
            {!quote && stage === "loading" && (
              <li className="border border-white/8 bg-charcoal p-3 font-mono text-[0.7rem] uppercase tracking-wider text-warmgray">
                Pricing your cart from the catalogue…
              </li>
            )}
          </ul>

          {summaryExpanded && (
            <button
              type="button"
              onClick={() => setSummaryExpanded(false)}
              className="mt-2 flex min-h-11 w-full items-center justify-center gap-1 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-warmgray lg:hidden"
            >
              Hide details <ChevronUp size={14} />
            </button>
          )}

          {hasPreorder && (
            <p className="mt-4 border border-amber/30 bg-amber/5 px-3 py-2.5 font-mono text-[0.65rem] uppercase leading-[1.6] tracking-[0.1em] text-cream/80">
              {hasInStock
                ? "This order mixes pieces that ship now with pre-orders. Each line ships on its own window, shown above, and you pay for all of it today."
                : "Made to order. Every piece here is cut once the run is claimed and ships in 4 to 6 weeks. You pay in full today."}
            </p>
          )}

          {heldLines.length > 0 && (
            <p className="mt-4 border border-white/12 px-3 py-2.5 font-mono text-[0.65rem] uppercase leading-[1.6] tracking-[0.1em] text-warmgray">
              {heldLines.length === 1 ? "One item" : `${heldLines.length} items`} in your cart{" "}
              {heldLines.length === 1 ? "is" : "are"} not part of this payment and{" "}
              {heldLines.length === 1 ? "was" : "were"} not charged.
            </p>
          )}

          <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4">
            <span className="font-mono text-xs uppercase tracking-widest text-warmgray">Total</span>
            <span className="font-display text-3xl text-cream">
              {quote ? cad(quote.totalCents) : "-"}
            </span>
          </div>
          <p className="mt-2 text-center text-[0.72rem] leading-relaxed text-warmgray lg:text-left">
            U.S. and other international orders may incur customs duties, taxes, or carrier fees
            due on delivery.
          </p>
        </div>

        {/*
          Payment. `data-clarity-mask` covers this whole subtree so session
          replay can never capture the email, the name or the shipping address a
          buyer types. Card fields live in Square's cross-origin iframe and are
          already out of reach; these are not. The Clarity project is also set to
          "Mask all" — this attribute is the half of that guarantee that travels
          with the code, so a vendor console change cannot quietly undo it.
        */}
        <div data-clarity-mask="true">
          <p className="border-b border-white/10 pb-2.5 font-head text-sm font-bold uppercase tracking-[0.2em] text-cream">
            Contact
          </p>
          <label className="mt-4 block">
            <span className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-warmgray">
              Email for your receipt
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              className="mt-1.5 w-full border border-white/15 bg-void px-3 py-2.5 text-sm text-cream placeholder:text-warmgray/60 focus:border-amber focus:outline-none"
            />
          </label>

          <p className="mt-8 border-b border-white/10 pb-2.5 font-head text-sm font-bold uppercase tracking-[0.2em] text-cream">
            Shipping address
          </p>
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-warmgray">
                Name on the shipping label
              </span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                className="mt-1.5 w-full border border-white/15 bg-void px-3 py-2.5 text-sm text-cream placeholder:text-warmgray/60 focus:border-amber focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-warmgray">
                Street address
              </span>
              <input
                type="text"
                value={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
                autoComplete="address-line1"
                className="mt-1.5 w-full border border-white/15 bg-void px-3 py-2.5 text-sm text-cream placeholder:text-warmgray/60 focus:border-amber focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-warmgray">
                Apartment, suite, etc. <span className="text-warmgray/50">(optional)</span>
              </span>
              <input
                type="text"
                value={addressLine2}
                onChange={(e) => setAddressLine2(e.target.value)}
                autoComplete="address-line2"
                className="mt-1.5 w-full border border-white/15 bg-void px-3 py-2.5 text-sm text-cream placeholder:text-warmgray/60 focus:border-amber focus:outline-none"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-warmgray">
                  City
                </span>
                <input
                  type="text"
                  value={locality}
                  onChange={(e) => setLocality(e.target.value)}
                  autoComplete="address-level2"
                  className="mt-1.5 w-full border border-white/15 bg-void px-3 py-2.5 text-sm text-cream placeholder:text-warmgray/60 focus:border-amber focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-warmgray">
                  Province / State
                </span>
                <input
                  type="text"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  autoComplete="address-level1"
                  className="mt-1.5 w-full border border-white/15 bg-void px-3 py-2.5 text-sm text-cream placeholder:text-warmgray/60 focus:border-amber focus:outline-none"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-warmgray">
                  Postal code
                </span>
                <input
                  type="text"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  autoComplete="postal-code"
                  className="mt-1.5 w-full border border-white/15 bg-void px-3 py-2.5 text-sm text-cream placeholder:text-warmgray/60 focus:border-amber focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-warmgray">
                  Country
                </span>
                <input
                  type="text"
                  value={country}
                  onChange={(e) => setCountry(e.target.value.toUpperCase())}
                  autoComplete="country"
                  maxLength={2}
                  className="mt-1.5 w-full border border-white/15 bg-void px-3 py-2.5 text-sm text-cream placeholder:text-warmgray/60 focus:border-amber focus:outline-none"
                />
              </label>
            </div>
          </div>

          <p className="mt-8 border-b border-white/10 pb-2.5 font-head text-sm font-bold uppercase tracking-[0.2em] text-cream">
            Payment
          </p>

          {stage === "sdk-error" || !APP_ID || !LOCATION_ID ? (
            <div className="mt-4 border border-amber/40 px-4 py-4">
              <p className="font-mono text-[0.7rem] uppercase leading-[1.6] tracking-wider text-amber">
                The embedded checkout could not load. You can still check out securely through
                Square&apos;s hosted page, and nothing about the total or your cart changes.
              </p>
              <FallbackHostedCheckout />
            </div>
          ) : (
            <>
              <div className="mt-4 space-y-3">
                {appleReady && (
                  <>
                    <style>{`#yp-apple-pay { -webkit-appearance: -apple-pay-button; -apple-pay-button-type: buy; -apple-pay-button-style: black; width: 100%; height: 48px; border-radius: 4px; }`}</style>
                    <button
                      id="yp-apple-pay"
                      type="button"
                      aria-label="Pay with Apple Pay"
                      disabled={!!paying}
                      onClick={payWithApplePay}
                    />
                  </>
                )}
                {googleReady && <div id="yp-google-pay" onClick={payWithGooglePay} />}
                {(appleReady || googleReady) && (
                  <p className="text-center font-mono text-[0.62rem] uppercase tracking-[0.14em] text-warmgray">
                    Shipping name + address come from your wallet sheet
                  </p>
                )}
              </div>

              <div className="my-6 flex items-center gap-4">
                <span className="h-px flex-1 bg-white/10" />
                <span className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-warmgray">
                  or pay with card
                </span>
                <span className="h-px flex-1 bg-white/10" />
              </div>

              <div>
                <span className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-warmgray">
                  Card
                </span>
                <div
                  id="yp-card-container"
                  className="mt-1.5 border border-white/15 bg-void px-3 py-3"
                />
              </div>

              <Button
                onClick={payWithCard}
                disabled={!!paying || stage !== "ready" || !quote}
                className="mt-5 w-full"
              >
                {paying === "card"
                  ? "Processing…"
                  : paying
                    ? "Complete the wallet payment…"
                    : quote
                      ? `Pay ${cad(quote.totalCents)}`
                      : "Loading total…"}
              </Button>
            </>
          )}

          {error && (
            <p
              role="alert"
              className="mt-4 flex items-center justify-center gap-2 border border-danger/40 bg-danger/5 px-3 py-2.5 text-center font-mono text-[0.65rem] uppercase leading-[1.6] tracking-wider text-danger"
            >
              <AlertCircle size={14} className="shrink-0" />
              {error}
            </p>
          )}

          <p className="mt-4 flex items-center justify-center gap-1.5 text-center font-mono text-[0.65rem] uppercase tracking-wider text-warmgray">
            <Lock size={11} /> Payments by Square · card details never touch this site
          </p>
          <p className="mt-2 text-center">
            <Link
              href="/store"
              className="font-mono text-[0.65rem] uppercase tracking-wider text-warmgray underline-offset-4 hover:text-cream hover:underline"
            >
              Back to the store
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * If Square's JS cannot load, fall back to the hosted payment link flow that
 * /api/checkout has served all along. Same server-side pricing, Square's page
 * instead of ours.
 */
function FallbackHostedCheckout() {
  const { lines } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkout() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: lines
            .filter((l) => l.kind === "merch" && l.skuId)
            .map((l) => ({ skuId: l.skuId as string, size: l.size ?? null, quantity: l.quantity ?? 1 })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) {
        setError(data?.error ?? "Checkout could not be started. Nothing has been charged.");
        setBusy(false);
        return;
      }
      window.location.assign(data.url);
    } catch {
      setError("Could not reach checkout. Nothing has been charged.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-4">
      <Button onClick={checkout} disabled={busy} variant="secondary" className="w-full">
        {busy ? "Opening Square checkout…" : "Continue to secure checkout"}
      </Button>
      {error && (
        <p className="mt-3 font-mono text-[0.65rem] uppercase tracking-wider text-amber">
          {error}
        </p>
      )}
    </div>
  );
}
