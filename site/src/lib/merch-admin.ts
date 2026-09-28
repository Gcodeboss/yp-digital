import "server-only";

import type { MerchOrder } from "@/lib/merch";
import {
  getClaimedCounts,
  getOrdersPage,
  isSquareConfigured,
} from "@/lib/square";

/** One wire format for the initial server render and every API refresh. */
export type MerchAdminSnapshot = {
  /** When Square was read. This screen is a view, and a view has an age. */
  readAt: string;
  /** How many merch orders were asked for per load. */
  orderLimit: number;
  squareConfigured: boolean;
  /** A whole or partial Square read failure, distinct from zero orders. */
  squareError: string | null;
  /** True when Square may hold more orders than this load returned. */
  truncated: boolean;
  /** How many Square orders were scanned to build the merch-order list. */
  scanned: number;
  claimed: Record<string, number>;
  orders: MerchOrder[];
};

/**
 * `getOrdersPage` reports when this bound makes the list partial, so the screen
 * and CSV never present a cut-off list as the whole drop.
 */
export const MERCH_ORDER_LIMIT = 100;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read the complete merch-admin view directly from Square.
 *
 * Square being absent or unreachable is data, not a page crash: the catalogue,
 * stock model and economics remain useful even before credentials are wired.
 */
export async function readMerchAdminSnapshot(): Promise<MerchAdminSnapshot> {
  const readAt = new Date().toISOString();
  if (!isSquareConfigured()) {
    return {
      readAt,
      orderLimit: MERCH_ORDER_LIMIT,
      squareConfigured: false,
      squareError: null,
      truncated: false,
      scanned: 0,
      claimed: {},
      orders: [],
    };
  }

  try {
    const [claimed, page] = await Promise.all([
      getClaimedCounts(),
      getOrdersPage(MERCH_ORDER_LIMIT),
    ]);
    return {
      readAt,
      orderLimit: MERCH_ORDER_LIMIT,
      squareConfigured: true,
      squareError: page.error,
      truncated: page.truncated,
      scanned: page.scanned,
      claimed,
      orders: page.orders,
    };
  } catch (error) {
    return {
      readAt,
      orderLimit: MERCH_ORDER_LIMIT,
      squareConfigured: true,
      squareError: message(error),
      truncated: false,
      scanned: 0,
      claimed: {},
      orders: [],
    };
  }
}
