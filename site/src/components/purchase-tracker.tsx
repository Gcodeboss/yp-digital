"use client";

/**
 * Fires the `purchase` analytics event, and only ever from the success page,
 * which renders nothing until a server-side Square lookup has confirmed the
 * order was actually paid. That is what makes the number trustworthy: the
 * event cannot be produced by guessing a URL, and it is not sent when the
 * payment step merely completed in the browser.
 *
 * It renders nothing. It exists because the success page is a server component
 * and `track` runs in the browser.
 */
import { useEffect } from "react";

import { trackPurchase, type GaItem } from "@/lib/analytics";

export function PurchaseTracker({
  orderId,
  valueCad,
  items,
  hasPreOrder,
}: {
  orderId: string;
  valueCad: number;
  items: GaItem[];
  hasPreOrder: boolean;
}) {
  /**
   * `items` is a fresh array on every render of the server page, so it is
   * deliberately not a dependency — including it would re-run this effect on
   * any re-render. The order id is the identity that matters, and
   * `trackPurchase` de-duplicates on it anyway.
   */
  useEffect(() => {
    trackPurchase({ orderId, valueCad, items, hasPreOrder });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);
  return null;
}
