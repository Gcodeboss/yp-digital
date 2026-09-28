"use client";

import Image from "next/image";
import { useCallback, useId, useMemo, useState } from "react";
import {
  MERCH,
  STATE_COPY,
  formatCad,
  getSku,
  resolveStock,
  sellable,
  type FulfilmentState,
  type MerchOrder,
  type MerchSku,
} from "@/lib/merch";
import {
  BRIEF,
  LIKELY_SELL_THROUGH,
  PARCEL_COST_RANGE_CAD,
  computeEconomics,
  defaultInputs,
  sellThroughLadder,
  type EconomicsInputs,
  type ShippingModel,
  type SplitBasis,
} from "@/lib/merch-economics";
import type { MerchAdminSnapshot } from "@/lib/merch-admin";
import {
  Button,
  Chip,
  EmptyState,
  Label,
  Panel,
  Section,
  SegmentedControl,
  Stat,
} from "../yp-chrome";

/**
 * Everything the merch admin knows, in one read.
 *
 * `claimed` rather than a computed stock table: `resolveStock` is the contract
 * in `@/lib/merch` and it is isomorphic, so the store card and this screen
 * compute state from the same function rather than from two implementations
 * that can disagree about what "pre-order" means.
 */
export type AdminSnapshot = MerchAdminSnapshot;

type View = "orders" | "preorders";
type FulfilmentFilter = "all" | FulfilmentState;

const MICRO = "font-head text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-dim";

/** The stock grid, shared by the header so the two cannot drift apart. */
const STOCK_ROW =
  "grid grid-cols-[40px_minmax(0,1fr)_72px_72px_78px_72px_78px_104px_72px] items-center gap-2 px-3";

const INPUT =
  "h-7 min-w-0 rounded-md border border-line-strong bg-ground px-2 font-mono text-[11.5px] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-amber/60";

/**
 * The export is an anchor, not a fetch. The browser owns the save; a blob link
 * built in script is blocked in some of the contexts this console runs in, and
 * the route already sets `Content-Disposition`. Same reasoning as the pack
 * download on the review screen.
 */
const CSV_LINK =
  "inline-flex h-7 shrink-0 items-center rounded-md border border-line-strong bg-white/[0.04] px-2.5 font-head text-[11px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:border-amber/60 hover:text-amber";

const FULFILMENT_OPTIONS: { value: FulfilmentState; label: string }[] = [
  { value: "unfulfilled", label: "unfulfilled" },
  { value: "packed", label: "packed" },
  { value: "shipped", label: "shipped" },
];

/* ------------------------------------------------------------------ *
 * Product shots
 * ------------------------------------------------------------------ */

/**
 * The plate a garment sits on.
 *
 * The shots are dark garments on a near-black ground, which is the right call
 * for the store and a problem here: dropped straight onto the console panel a
 * dark photograph has no edge and dissolves into the row. So every shot sits on
 * a plate that is one value step up from the panel, closed by a hairline. That
 * is rule 1 of the console doing the work an outline would otherwise do.
 *
 * The hairline is also the tell: solid means a shot exists, dashed means it
 * does not. Same footprint either way, so a row never changes height and an
 * empty cell never reads as a failed load.
 */
const PLATE = "border border-line-strong bg-raised";

const SHOT_BOX = {
  line: "h-7 w-7 rounded",
  row: "h-10 w-10 rounded-md",
  card: "aspect-[4/5] w-full rounded-lg",
} as const;

const SHOT_SIZES = {
  line: "32px",
  row: "48px",
  card: "(max-width: 640px) 45vw, (max-width: 1536px) 22vw, 200px",
} as const;

/**
 * The shots are 4:5. A card is 4:5 too, so it contains exactly. The small
 * thumbnails are square, and letterboxing a photograph into a 28px box leaves
 * two grey bars and nothing readable, so they crop instead.
 */
const SHOT_FIT = {
  line: "object-cover",
  row: "object-cover",
  card: "object-contain",
} as const;

type ShotSize = keyof typeof SHOT_BOX;
type ShotView = "front" | "back";

/**
 * What to say when there is no shot.
 *
 * A null in `art` or `artBack` is a fact about the catalogue, not a loading
 * state and not a broken path, so the empty state says which field is empty
 * rather than guessing at a reason. Anything beyond that would be this screen
 * inventing provenance, which is the exact failure it exists to catch.
 */
function noShotReason(sku: Pick<MerchSku, "id" | "garment">, view: ShotView = "front"): string {
  if (view === "back") {
    return sku.garment === "bandana"
      ? `The catalogue carries no rear shot for ${sku.id}. A bandana is a single printed square, so there may be no second view to take.`
      : `The catalogue carries no rear shot for ${sku.id} yet.`;
  }
  return `The catalogue carries no shot for ${sku.id} yet. Nothing is broken: the artwork field is empty.`;
}

/**
 * One product shot, or an honest empty state.
 *
 * The empty state is designed rather than absent: same footprint, hairline
 * dashed instead of solid, and a mark that reads as "deliberately blank". An
 * absent image would make the row look broken; a stand-in photograph would be
 * worse, because someone would eventually mistake it for the product.
 */
function SkuShot({
  art,
  label,
  size = "row",
  reason,
}: {
  art: string | null;
  label: string;
  size?: ShotSize;
  reason?: string;
}) {
  if (!art) {
    return (
      <div
        role="img"
        aria-label={`No product shot for ${label}`}
        title={reason ?? `No product shot exists for ${label} yet.`}
        className={`${SHOT_BOX[size]} relative flex shrink-0 items-center justify-center border border-dashed border-line-strong bg-raised`}
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          className={`text-ink-faint ${size === "card" ? "h-8 w-8" : "h-3.5 w-3.5"}`}
        >
          <path d="M5 19 L19 5" />
        </svg>
        {size === "card" && (
          <span className="absolute bottom-2 left-0 right-0 text-center font-head text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            no shot yet
          </span>
        )}
      </div>
    );
  }
  return (
    <div className={`${SHOT_BOX[size]} ${PLATE} relative shrink-0 overflow-hidden`}>
      <Image src={art} alt={label} fill sizes={SHOT_SIZES[size]} className={SHOT_FIT[size]} />
    </div>
  );
}

/** The shot for a SKU id, for rows that only carry the id. */
function LineShot({ skuId, label }: { skuId: string; label: string }) {
  const sku = getSku(skuId);
  return (
    <SkuShot
      art={sku?.art ?? null}
      label={label}
      size="line"
      reason={sku ? noShotReason(sku) : "This line references a SKU that is not in the catalogue."}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Calculator chrome
 * ------------------------------------------------------------------ */

/**
 * The plain-English line under a number.
 *
 * Every figure in the calculator carries one. A finance document that states a
 * total and trusts the reader to work out where it came from is exactly the
 * document this screen exists to argue with.
 */
function Why({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 max-w-[74ch] text-[11.5px] leading-relaxed text-ink-dim">{children}</p>;
}

function Figure({
  label,
  value,
  tone = "ink",
  sub,
  children,
}: {
  label: string;
  value: string;
  tone?: "ink" | "amber" | "sienna" | "mint" | "dim";
  sub?: string;
  children?: React.ReactNode;
}) {
  const tones = {
    ink: "text-ink",
    amber: "text-amber",
    sienna: "text-sienna",
    mint: "text-mint",
    dim: "text-ink-dim",
  };
  return (
    <div className="min-w-[150px]">
      <Label>{label}</Label>
      <div className={`mt-0.5 font-mono text-[19px] font-medium leading-none tabular-nums ${tones[tone]}`}>
        {value}
      </div>
      {sub ? <div className="mt-1 font-mono text-[10.5px] tabular-nums text-ink-faint">{sub}</div> : null}
      {children ? <Why>{children}</Why> : null}
    </div>
  );
}

/** A live control. The readout sits beside the label so the value is never hunted for. */
function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  readout,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
  readout: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="min-w-[200px] flex-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id}>
          <Label>{label}</Label>
        </label>
        <span className="font-mono text-[12.5px] tabular-nums text-amber">{readout}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 h-1 w-full cursor-pointer appearance-none rounded-full bg-line-strong accent-amber"
      />
      {hint ? <div className="mt-1 text-[10.5px] leading-snug text-ink-faint">{hint}</div> : null}
    </div>
  );
}

/** A money field. Kept narrow and mono so a column of them lines up. */
function MoneyField({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
  width = "w-[84px]",
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
  width?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id}>
        <Label>{label}</Label>
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`${INPUT} mt-1 block ${width} text-right`}
      />
    </div>
  );
}

const CALC_ROW =
  "grid min-w-[980px] grid-cols-[40px_minmax(0,1.25fr)_86px_80px_66px_58px_92px_94px_62px_98px] items-center gap-2 px-3";

const LADDER_ROW =
  "grid min-w-[620px] grid-cols-[76px_72px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 px-3";

type ReorderRow = {
  key: string;
  skuId: string;
  name: string;
  colourway: string;
  size: string;
  units: number;
  orders: number;
};

export function MerchClient({ initial }: { initial: AdminSnapshot }) {
  const [snap, setSnap] = useState<AdminSnapshot>(initial);
  const [view, setView] = useState<View>("orders");
  const [fulfilmentFilter, setFulfilmentFilter] = useState<FulfilmentFilter>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // One row is adjusted at a time, so one set of fields rather than five.
  const [editing, setEditing] = useState<string | null>(null);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");

  // Tracking drafts, keyed by order. The stored value is the fallback, so an
  // untouched field always shows what Square actually holds.
  const [tracking, setTracking] = useState<Record<string, string>>({});

  /**
   * The calculator's inputs.
   *
   * Nothing here touches Square, nothing is written anywhere, and the model in
   * `@/lib/merch-economics` is pure arithmetic, so this half of the screen works
   * in full on a machine with no payment account at all.
   *
   * The default sell-through is 70%, not 100%. The research puts the likely
   * range at 60% to 75%; 100% is the ceiling and the brief treats it as a plan.
   */
  const [calc, setCalc] = useState<EconomicsInputs>(() => defaultInputs());
  const econ = useMemo(() => computeEconomics(calc), [calc]);
  const ladder = useMemo(() => sellThroughLadder(calc), [calc]);

  const patchCalc = useCallback(
    (next: Partial<EconomicsInputs>) => setCalc((c) => ({ ...c, ...next })),
    []
  );
  const setPrice = useCallback(
    (id: string, v: number) =>
      setCalc((c) => ({ ...c, prices: { ...c.prices, [id]: Math.max(0, v) } })),
    []
  );
  const setGiveaway = useCallback(
    (id: string, v: number) =>
      setCalc((c) => ({ ...c, absorbed: { ...c.absorbed, [id]: Math.max(0, Math.round(v)) } })),
    []
  );

  const live = snap.squareConfigured && !snap.squareError;

  const send = useCallback(async (payload: Record<string, unknown>, key: string) => {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/merch-admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as Partial<AdminSnapshot> & {
        error?: string;
        note?: string;
      };
      if (!res.ok || !body.orders) {
        setError(body.error ?? `The admin route answered ${res.status}.`);
        return false;
      }
      setSnap(body as AdminSnapshot);
      if (body.note) setNote(body.note);
      return true;
    } catch (err) {
      setError(`Could not reach the admin route: ${(err as Error).message}`);
      return false;
    } finally {
      setBusy(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    setBusy("refresh");
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/merch-admin", { cache: "no-store" });
      if (!res.ok) {
        setError(`The admin route answered ${res.status}.`);
        return;
      }
      setSnap((await res.json()) as AdminSnapshot);
    } catch (err) {
      setError(`Could not reach the admin route: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, []);

  const stock = useMemo(
    () => MERCH.map((sku) => ({ sku, ...resolveStock(sku, snap.claimed[sku.id] ?? 0) })),
    [snap.claimed]
  );

  const totals = useMemo(() => {
    const produced = MERCH.reduce((a, s) => a + s.produced, 0);
    const absorbed = MERCH.reduce((a, s) => a + s.absorbed, 0);
    return {
      produced,
      absorbed,
      absorbedPct: produced > 0 ? Math.round((absorbed / produced) * 100) : 0,
      sellable: MERCH.reduce((a, s) => a + sellable(s), 0),
      claimed: stock.reduce((a, r) => a + r.claimed, 0),
      remaining: stock.reduce((a, r) => a + r.remaining, 0),
      preOrderSkus: stock.filter((r) => r.state === "pre-order").length,
    };
  }, [stock]);

  /**
   * Pre-order lines, grouped by SKU and size. This is the reorder quantity,
   * every unit promised beyond the production run, so it is summed in units
   * and counted in distinct orders, not in line items.
   */
  const reorder = useMemo(() => {
    const map = new Map<string, ReorderRow & { orderIds: Set<string> }>();
    for (const order of snap.orders) {
      for (const line of order.lines) {
        if (line.state !== "pre-order") continue;
        const size = line.size ?? "one size";
        const key = `${line.skuId}:${size}`;
        const row = map.get(key) ?? {
          key,
          skuId: line.skuId,
          name: line.name,
          colourway: line.colourway,
          size,
          units: 0,
          orders: 0,
          orderIds: new Set<string>(),
        };
        row.units += line.quantity;
        row.orderIds.add(order.id);
        map.set(key, row);
      }
    }
    return [...map.values()]
      .map((r) => ({ ...r, orders: r.orderIds.size }))
      .sort((a, b) => b.units - a.units || a.key.localeCompare(b.key));
  }, [snap.orders]);

  const reorderUnits = reorder.reduce((a, r) => a + r.units, 0);
  const preOrderOrders = snap.orders.filter((o) => o.hasPreOrder).length;

  const fulfilmentCounts = useMemo(() => {
    const base: Record<FulfilmentState, number> = { unfulfilled: 0, packed: 0, shipped: 0 };
    for (const o of snap.orders) base[o.fulfilment] += 1;
    return base;
  }, [snap.orders]);

  const visibleOrders = useMemo(() => {
    let list = snap.orders;
    if (view === "preorders") list = list.filter((o) => o.hasPreOrder);
    if (fulfilmentFilter !== "all") list = list.filter((o) => o.fulfilment === fulfilmentFilter);
    return list;
  }, [snap.orders, view, fulfilmentFilter]);

  const parsedDelta = Number.parseInt(delta, 10);
  const deltaValid = Number.isInteger(parsedDelta) && parsedDelta !== 0;

  function openAdjust(skuId: string) {
    setEditing(skuId);
    setDelta("");
    setReason("");
    setError(null);
    setNote(null);
  }

  async function recordAdjustment(skuId: string) {
    const ok = await send(
      { action: "claimed", skuId, delta: parsedDelta, reason: reason.trim() },
      `claimed:${skuId}`
    );
    if (ok) {
      setEditing(null);
      setDelta("");
      setReason("");
    }
  }

  const trackingValue = (order: MerchOrder) => tracking[order.id] ?? order.trackingNumber ?? "";

  return (
    <>
      {/* ---------------------------------------------------------------
          Where the numbers come from. A view has an age, and an admin that
          cannot reach Square has to say so rather than render an empty list
          that reads like "no orders yet".
         --------------------------------------------------------------- */}
      {!snap.squareConfigured && (
        <Panel className="border-sienna/55 bg-sienna/[0.12] p-5">
          <div className="font-head text-[13px] font-black uppercase tracking-[0.02em] text-ink">
            Square is not connected
          </div>
          <p className="mt-1.5 max-w-[92ch] text-[12.5px] leading-relaxed text-ink-dim">
            No account is wired up, so there are no orders to read and no inventory to move.
            The catalogue and the stock model below are read from{" "}
            <span className="font-mono text-ink">content/merch.json</span> and are correct;
            every claimed count reads zero because nothing has been sold through the site.
            Set <span className="font-mono text-ink">SQUARE_ACCESS_TOKEN</span>,{" "}
            <span className="font-mono text-ink">SQUARE_LOCATION_ID</span> and{" "}
            <span className="font-mono text-ink">SQUARE_ENVIRONMENT</span> to bring orders
            online. The values live in the keychain, never in a file.
          </p>
        </Panel>
      )}

      {snap.squareConfigured && snap.squareError && (
        <Panel className="border-sienna/55 bg-sienna/[0.12] p-5">
          <div className="font-head text-[13px] font-black uppercase tracking-[0.02em] text-ink">
            {snap.orders.length > 0
              ? "The Square read came back incomplete"
              : "Square is configured but the read failed"}
          </div>
          <p className="mt-1.5 max-w-[92ch] text-[12.5px] leading-relaxed text-ink-dim">
            {snap.orders.length > 0
              ? "Some orders were read and the rest were not. What is below is a partial list, not the drop, and both CSV exports inherit that. Nothing has been cached and nothing has been lost; the orders are in Square."
              : "This screen shows no orders because it could not fetch any, not because none exist. Nothing has been cached and nothing has been lost; the orders are in Square."}
          </p>
          <p className="mt-2 border-l border-l-sienna/50 bg-raised px-2 py-1.5 font-mono text-[11px] leading-relaxed text-ink">
            {snap.squareError}
          </p>
          <div className="mt-2.5">
            <Button onClick={() => void refresh()} disabled={busy !== null}>
              {busy === "refresh" ? "Retrying…" : "Retry"}
            </Button>
          </div>
        </Panel>
      )}

      {live && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-mint" />
          <Label>
            {snap.orders.length} order{snap.orders.length === 1 ? "" : "s"} read live from Square
            at {snap.readAt.slice(11, 16)} UTC · nothing is stored on this machine
          </Label>
          <div className="flex-1" />
          <Button size="sm" onClick={() => void refresh()} disabled={busy !== null}>
            {busy === "refresh" ? "Reading…" : "Re-read Square"}
          </Button>
        </div>
      )}

      {/* `@/lib/square` pages, and says so when it stopped early. A truncated
          list is indistinguishable from a complete one unless it is stated, and
          the CSV below would otherwise ship a partial packing list. */}
      {snap.squareConfigured && snap.truncated && (
        <Panel className="border-sienna/55 bg-sienna/[0.1] px-4 py-2.5">
          <p className="max-w-[96ch] text-[12.5px] leading-relaxed text-sienna">
            This is a partial list. Square holds more orders than the {snap.orderLimit} this
            screen reads per load; {snap.scanned} were scanned and {snap.orders.length} came
            back. The list, the pre-order totals and both CSV exports cover those{" "}
            {snap.orders.length} only. Treat them as the most recent orders, not as the whole
            drop.
          </p>
        </Panel>
      )}

      {error && (
        <Panel className="border-sienna/55 bg-sienna/[0.1] px-4 py-2.5">
          <p className="text-[12.5px] leading-relaxed text-sienna">{error}</p>
        </Panel>
      )}
      {note && (
        <Panel className="border-amber/35 bg-amber/[0.07] px-4 py-2.5">
          <p className="text-[12.5px] leading-relaxed text-amber">{note}</p>
        </Panel>
      )}

      {/* ---------------------------------------------------------------
          The stock picture. The one thing this screen exists to get right.
         --------------------------------------------------------------- */}
      <Panel className="border-amber/25 bg-amber/[0.05] p-5">
        <Label>the number that decides everything below</Label>
        <p className="mt-1.5 max-w-[96ch] text-[13px] leading-relaxed text-ink">
          {totals.produced} pieces were produced. {totals.absorbed} of them,{" "}
          {totals.absorbedPct}% of the run, are company-absorbed for team and giveaways and
          are never for sale.{" "}
          <span className="text-amber">
            Stock state is computed against the {totals.sellable} sellable, never against the{" "}
            {totals.produced} produced.
          </span>{" "}
          Reading the production run as stock would promise {totals.absorbed} pieces that were
          never available to sell.
        </p>
      </Panel>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Panel className="p-4">
          <Label>produced</Label>
          <div className="mt-1 text-ink-dim">
            <Stat value={totals.produced} />
          </div>
          <div className="text-[11px] text-ink-faint">the manufacturing run</div>
        </Panel>
        <Panel className="p-4">
          <Label>absorbed</Label>
          <div className="mt-1 text-ink-dim">
            <Stat value={totals.absorbed} />
          </div>
          <div className="text-[11px] text-ink-faint">team and giveaways · never sold</div>
        </Panel>
        <Panel className="border-amber/35 bg-amber/[0.06] p-4">
          <Label>sellable</Label>
          <div className="mt-1 text-amber">
            <Stat value={totals.sellable} />
          </div>
          <div className="text-[11px] text-ink-dim">produced − absorbed · state is set here</div>
        </Panel>
        <Panel className="p-4">
          <Label>claimed</Label>
          <div className="mt-1">
            <Stat value={totals.claimed} />
          </div>
          <div className="text-[11px] text-ink-dim">site orders plus floor adjustments</div>
        </Panel>
        <Panel className="p-4">
          <Label>remaining</Label>
          <div className="mt-1">
            <Stat value={totals.remaining} />
          </div>
          <div className="text-[11px] text-ink-dim">
            {totals.preOrderSkus > 0
              ? `${totals.preOrderSkus} sku${totals.preOrderSkus === 1 ? "" : "s"} now pre-order`
              : "every sku still in stock"}
          </div>
        </Panel>
      </div>

      <Section
        title="stock by sku"
        actions={<Label>produced − absorbed = sellable · claimed ≥ sellable flips to pre-order</Label>}
      >
        <div className={`${STOCK_ROW} h-7 border-b border-line`}>
          <span />
          <span className={MICRO}>sku</span>
          <span className={`${MICRO} text-right`}>produced</span>
          <span className={`${MICRO} text-right`}>absorbed</span>
          <span className="text-right font-head text-[10px] font-semibold uppercase tracking-[0.14em] text-amber">
            sellable
          </span>
          <span className={`${MICRO} text-right`}>claimed</span>
          <span className={`${MICRO} text-right`}>remaining</span>
          <span className={MICRO}>state</span>
          <span />
        </div>

        {stock.map((row) => {
          const open = editing === row.sku.id;
          const nextClaimed = deltaValid ? row.claimed + parsedDelta : row.claimed;
          const willFlip = open && deltaValid && row.state === "in-stock" && nextClaimed >= row.sellable;
          return (
            <div key={row.sku.id}>
              <div className={`${STOCK_ROW} min-h-11 border-b border-line/60 py-1`}>
                <SkuShot
                  art={row.sku.art}
                  label={`${row.sku.name}, ${row.sku.colourway}`}
                  reason={noShotReason(row.sku)}
                />
                <div className="flex min-w-0 items-baseline gap-1.5">
                  <span className="truncate text-[12.5px] text-ink">{row.sku.name}</span>
                  <span className="shrink-0 font-mono text-[10.5px] text-ink-dim">
                    {row.sku.colourway}
                  </span>
                </div>
                {/* Produced and absorbed are held at the faintest ink in the
                    system on purpose: they are provenance, not availability.
                    Sellable is the only figure on this row that decides
                    anything, so it is the only one carrying colour. */}
                <span className="text-right font-mono text-[11.5px] tabular-nums text-ink-faint">
                  {row.sku.produced}
                </span>
                <span className="text-right font-mono text-[11.5px] tabular-nums text-ink-faint">
                  −{row.sku.absorbed}
                </span>
                <span className="rounded-sm bg-amber/10 py-0.5 pr-1.5 text-right font-mono text-[12.5px] tabular-nums text-amber">
                  {row.sellable}
                </span>
                <span className="text-right font-mono text-[11.5px] tabular-nums text-ink">
                  {row.claimed}
                </span>
                <span
                  className={`text-right font-mono text-[11.5px] tabular-nums ${
                    row.remaining === 0 ? "text-sienna" : "text-ink"
                  }`}
                >
                  {row.remaining}
                </span>
                <span>
                  <Chip tone={row.state === "pre-order" ? "rust" : "muted"}>
                    {STATE_COPY[row.state].label}
                  </Chip>
                </span>
                <span className="text-right">
                  <Button
                    size="sm"
                    active={open}
                    variant="toggle"
                    onClick={() => (open ? setEditing(null) : openAdjust(row.sku.id))}
                    disabled={!snap.squareConfigured}
                    title={
                      snap.squareConfigured
                        ? "Adjust the claimed count"
                        : "Claimed counts are Square inventory. Connect an account first"
                    }
                  >
                    Adjust
                  </Button>
                </span>
              </div>

              {open && (
                <div className="border-b border-line bg-raised px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label>adjust claimed</Label>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={delta}
                      onChange={(e) => setDelta(e.target.value)}
                      placeholder="+40"
                      aria-label={`Units to add to ${row.sku.id}`}
                      className={`${INPUT} w-[86px] text-right`}
                    />
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && deltaValid && reason.trim().length >= 3) {
                          void recordAdjustment(row.sku.id);
                        }
                      }}
                      placeholder="why, e.g. 40 sold on the floor, 18 Sep show"
                      aria-label={`Reason for the ${row.sku.id} adjustment`}
                      className={`${INPUT} min-w-[260px] flex-1`}
                    />
                    <Button
                      variant="primary"
                      disabled={busy !== null || !deltaValid || reason.trim().length < 3}
                      onClick={() => void recordAdjustment(row.sku.id)}
                    >
                      {busy === `claimed:${row.sku.id}` ? "Recording…" : "Record"}
                    </Button>
                    <Button onClick={() => setEditing(null)} disabled={busy !== null}>
                      Cancel
                    </Button>
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-dim">
                    {deltaValid
                      ? `${row.claimed} → ${Math.max(0, nextClaimed)} claimed of ${row.sellable} sellable.`
                      : `${row.sku.id} is at ${row.claimed} claimed of ${row.sellable} sellable.`}{" "}
                    If the merch table runs on Square POS against this catalogue, a floor
                    sale decrements this count by itself and needs nothing typed here. This is
                    for the sales Square never saw: cash, or a different reader. The reason is
                    stored with the adjustment. An edit without one is refused, because a
                    number nobody can explain is worse than a stale one.
                  </p>
                  {willFlip && (
                    <p className="mt-1.5 border-l border-l-amber/50 bg-amber/[0.07] px-2 py-1.5 text-[11.5px] leading-relaxed text-amber">
                      This takes {row.sku.id} to {nextClaimed} of {row.sellable} sellable, so the
                      store card flips to pre-order: {STATE_COPY["pre-order"].promise.toLowerCase()}.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </Section>

      {/* ---------------------------------------------------------------
          The one thing about Square that somebody will eventually try to
          "fix". Square holds a quantity and nothing else, so the sellable
          model has to be written down beside it or the 70 giveaway pieces
          get sold. The spec rejects this exact correction.
         --------------------------------------------------------------- */}
      <Panel className="border-sienna/55 bg-sienna/[0.12] p-5">
        <div className="font-head text-[13px] font-black uppercase tracking-[0.02em] text-ink">
          Square inventory means sellable, not physically present
        </div>
        <p className="mt-1.5 max-w-[96ch] text-[12.5px] leading-relaxed text-ink-dim">
          Square&apos;s inventory is seeded to the {totals.sellable} sellable units, not to the{" "}
          {totals.produced} that were manufactured. The difference is the {totals.absorbed}{" "}
          company-absorbed pieces, and they are deliberately not in Square: they were paid for
          out of production cost and are team and giveaway allocation, not stock.{" "}
          <span className="text-sienna">
            Raising Square to {totals.produced} to match the production run is a defect, not a
            correction. It makes the giveaway allocation sellable and oversells the drop by{" "}
            {totals.absorbedPct}%.
          </span>{" "}
          Square counts what may be sold. It has never been a record of what exists.
        </p>
        <p className="mt-2.5 border-l border-l-sienna/50 bg-raised px-2.5 py-2 text-[12px] leading-relaxed text-ink-dim">
          <span className="text-ink">Which reconciliation regime is in force</span> depends on
          how the merch table takes payment, and that is not settled yet (merch-square-rail
          task 7.3). On Square POS against this catalogue, a piece sold in the room decrements
          the same inventory this screen reads and nobody types anything. On cash or a
          non-Square reader, Square never sees the sale, the claimed count above lags the room,
          and a manual adjustment with its reason is the only way it catches up.
        </p>
      </Panel>

      {/* ---------------------------------------------------------------
          The product shots. Two SKUs have them, three do not, and the
          three that do not say so in their own words.
         --------------------------------------------------------------- */}
      <Section
        title="product shots"
        actions={
          <Label>
            {MERCH.filter((s) => s.art).length} of {MERCH.length} front ·{" "}
            {MERCH.filter((s) => s.artBack).length} of {MERCH.length} rear
          </Label>
        }
      >
        <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          {MERCH.map((sku) => {
            const frontReason = noShotReason(sku, "front");
            const backReason = noShotReason(sku, "back");
            return (
              <div key={sku.id} className="min-w-0">
                <div className="grid grid-cols-2 gap-1.5">
                  <SkuShot
                    art={sku.art}
                    label={`${sku.name}, ${sku.colourway}, front`}
                    size="card"
                    reason={frontReason}
                  />
                  <SkuShot
                    art={sku.artBack}
                    label={`${sku.name}, ${sku.colourway}, back`}
                    size="card"
                    reason={backReason}
                  />
                </div>
                <div className="mt-2 flex items-baseline gap-1.5">
                  <span className="truncate text-[12.5px] text-ink">{sku.name}</span>
                  <span className="shrink-0 font-mono text-[10.5px] text-ink-dim">
                    {sku.colourway}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="font-mono text-[10.5px] tabular-nums text-ink-faint">
                    front · back
                  </span>
                  <div className="flex-1" />
                  {sku.art && sku.artBack ? (
                    <Chip tone="amber">both views</Chip>
                  ) : sku.art ? (
                    <Chip tone="muted">front only</Chip>
                  ) : (
                    <Chip tone="rust">no shot</Chip>
                  )}
                </div>
                {!sku.art ? (
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-dim">{frontReason}</p>
                ) : !sku.artBack ? (
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-dim">{backReason}</p>
                ) : null}
              </div>
            );
          })}
        </div>
        <p className="border-t border-line px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-dim">
          Every shot on this screen is whatever{" "}
          <span className="font-mono text-ink">content/merch.json</span> points at, in the{" "}
          <span className="font-mono text-ink">art</span> and{" "}
          <span className="font-mono text-ink">artBack</span> fields. Nothing is substituted and
          nothing is invented: where a field is empty the plate says so in as many words, because
          a stand-in image is exactly the kind of thing somebody eventually mistakes for the
          product. A dashed edge means no shot; a solid one means the file is there.
        </p>
      </Section>

      {/* ===============================================================
          THE CALCULATOR.

          Pure arithmetic from `@/lib/merch-economics`, so it renders in full
          with Square disconnected. Every figure carries the sentence that
          explains it, because the document this screen argues with is
          persuasive precisely because its sums are right and its framing is
          not.
          =============================================================== */}
      <Panel className="border-amber/25 bg-amber/[0.05] p-5">
        <Label>the calculator, and why it exists</Label>
        <p className="mt-1.5 max-w-[104ch] text-[13px] leading-relaxed text-ink">
          The Toshi Works brief projects{" "}
          <span className="font-mono text-ink">{formatCad(BRIEF.revenueCad)}</span> of revenue and{" "}
          <span className="font-mono text-ink">{formatCad(BRIEF.profitCad)}</span> of profit, split
          down the middle at{" "}
          <span className="font-mono text-ink">{formatCad(BRIEF.eachPartnerCad)}</span> each. Every
          sum in it is arithmetically correct; all of it was recomputed by hand. The problem is
          what is not in the sums. The brief says payment processing, shipping, fulfilment and tax{" "}
          <span className="text-amber">are not included</span>, and then calls what is left net
          profit.{" "}
          <span className="text-amber">
            Those costs do not vanish. They land on whoever ships the boxes.
          </span>{" "}
          Everything below puts them back and shows where they land. Nothing here is saved,
          nothing is sent anywhere, and none of it needs Square.
        </p>
      </Panel>

      <Section
        title="assumptions · every one of these is a live control"
        actions={
          <Button size="sm" onClick={() => setCalc(defaultInputs())}>
            Reset to the brief
          </Button>
        }
      >
        <div className="flex flex-wrap items-start gap-x-6 gap-y-4 border-b border-line p-3">
          <Slider
            label="sell-through"
            value={Math.round(calc.sellThrough * 100)}
            min={0}
            max={100}
            onChange={(n) => patchCalc({ sellThrough: n / 100 })}
            readout={`${Math.round(calc.sellThrough * 100)}% · ${econ.unitsSold} of ${econ.sellableTotal}`}
            hint={`Likely ${Math.round(LIKELY_SELL_THROUGH.low * 100)} to ${Math.round(
              LIKELY_SELL_THROUGH.high * 100
            )}% over 60 to 90 days. 100% is the ceiling, not a forecast.`}
          />
          <Slider
            label="share sold online rather than at the show"
            value={Math.round(calc.shippedShare * 100)}
            min={0}
            max={100}
            onChange={(n) => patchCalc({ shippedShare: n / 100 })}
            readout={`${Math.round(calc.shippedShare * 100)}% shipped`}
            hint={`${econ.onlineUnits} units in ${econ.onlineOrders} parcels, ${econ.inPersonUnits} handed over at the table. Every unit sold in person saves a parcel.`}
          />
          <div className="flex items-end gap-3">
            <MoneyField
              label="cost per parcel"
              value={calc.parcelCostCad}
              min={0}
              onChange={(n) => patchCalc({ parcelCostCad: n })}
            />
            <div className="pb-1 text-[10.5px] leading-snug text-ink-faint">
              Canada Post runs {formatCad(PARCEL_COST_RANGE_CAD.min)} to{" "}
              {formatCad(PARCEL_COST_RANGE_CAD.max)}
              <br />
              domestic. The US is roughly double.
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-x-5 gap-y-3 border-b border-line p-3">
          <div>
            <Label>who pays the postage</Label>
            <div className="mt-1">
              <SegmentedControl<ShippingModel>
                value={calc.shippingModel}
                label="Shipping model"
                onChange={(v) => patchCalc({ shippingModel: v })}
                options={[
                  { value: "absorb", label: "we absorb it" },
                  { value: "flat", label: "flat rate" },
                  { value: "threshold", label: "free over" },
                ]}
              />
            </div>
          </div>
          {calc.shippingModel !== "absorb" && (
            <MoneyField
              label="charged to the buyer"
              value={calc.shippingChargeCad}
              onChange={(n) => patchCalc({ shippingChargeCad: n })}
            />
          )}
          {calc.shippingModel === "threshold" && (
            <>
              <MoneyField
                label="free over"
                value={calc.freeShippingThresholdCad}
                step={5}
                width="w-[92px]"
                onChange={(n) => patchCalc({ freeShippingThresholdCad: n })}
              />
              <Slider
                label="orders expected to clear it"
                value={Math.round(calc.ordersClearingThreshold * 100)}
                min={0}
                max={100}
                onChange={(n) => patchCalc({ ordersClearingThreshold: n / 100 })}
                readout={`${Math.round(calc.ordersClearingThreshold * 100)}%`}
                hint={`An assumption, not a measurement. The average online order is currently ${formatCad(
                  econ.averageOnlineOrderCad
                )}, so judge it against that.`}
              />
            </>
          )}
          <div className="min-w-[280px] max-w-[70ch] flex-1 text-[11.5px] leading-relaxed text-ink-dim">
            {calc.shippingModel === "absorb"
              ? "Nobody has decided this yet, so the model starts where the brief leaves it: the drop eats every parcel. Charging for postage is the second largest lever in the whole project and it costs nothing but a decision."
              : calc.shippingModel === "flat"
                ? `Every online order pays ${formatCad(calc.shippingChargeCad)} toward postage. That comes back as a credit against the postage line rather than as revenue, so the revenue figure stays comparable to the brief's.`
                : `Orders above ${formatCad(calc.freeShippingThresholdCad)} ship free, which also pushes the average order up because people add a second item to clear it. This model does not try to predict that lift, so it is understating the benefit.`}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-x-5 gap-y-3 p-3">
          <div>
            <Label>the partner split is taken on</Label>
            <div className="mt-1">
              <SegmentedControl<SplitBasis>
                value={calc.splitBasis}
                label="Split basis"
                onChange={(v) => patchCalc({ splitBasis: v })}
                options={[
                  { value: "brief", label: "the brief's definition" },
                  { value: "true", label: "true net, all costs" },
                ]}
              />
            </div>
          </div>
          <p className="min-w-[320px] max-w-[78ch] flex-1 text-[11.5px] leading-relaxed text-ink-dim">
            {calc.splitBasis === "brief"
              ? `The brief's definition: profit is revenue minus the ${formatCad(
                  econ.sunkTotalCad
                )} of production, fee and design, split 50/50, with processing, postage and fulfilment left out of the calculation and therefore paid by whoever does them. That is Yanchan.`
              : "A proper definition: revenue minus every cost of the drop, including processing, postage, packaging, returns, defects and platform, and the remainder split 50/50. This is the paragraph that has to be agreed in writing before a single piece sells."}
          </p>
        </div>
      </Section>

      {/* ---------------------------------------------------------------
          The finding that matters most. Loudest thing on the screen.
         --------------------------------------------------------------- */}
      <Panel
        className={`p-5 ${
          calc.splitBasis === "brief"
            ? "border-sienna/55 bg-sienna/[0.11]"
            : "border-mint/40 bg-mint/[0.05]"
        }`}
      >
        <div className="flex flex-wrap items-baseline gap-2">
          <div className="font-head text-[13px] font-black uppercase tracking-[0.02em] text-ink">
            {calc.splitBasis === "brief"
              ? econ.splitIsMeaningful
                ? `The 50/50 split is really ${econ.toshiPct}/${econ.yanchanPct}`
                : "The 50/50 split pays one partner and bills the other"
              : "Split on true net, the deal is actually 50/50"}
          </div>
          <Chip tone={calc.splitBasis === "brief" ? "rust" : "amber"}>
            at {econ.sellThroughPct}% sell-through
          </Chip>
        </div>

        <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="border-l-2 border-l-line-strong pl-3">
            <Label>toshi works takes</Label>
            <div className="mt-1 text-ink">
              <Stat value={formatCad(econ.toshiCad)} />
            </div>
            <Why>
              {calc.splitBasis === "brief"
                ? `Half of revenue minus ${formatCad(
                    econ.sunkTotalCad
                  )}, and nothing else is deducted. Toshi Works carries no part of the cost of actually selling anything.`
                : `Half of what is genuinely left after every cost of the drop.`}
            </Why>
          </div>

          <div
            className={`border-l-2 pl-3 ${
              econ.yanchanCad < 0 ? "border-l-sienna" : "border-l-amber"
            }`}
          >
            <Label>yanchan produced keeps</Label>
            <div className={`mt-1 ${econ.yanchanCad < 0 ? "text-sienna" : "text-amber"}`}>
              <Stat value={formatCad(econ.yanchanCad)} display />
            </div>
            <Why>
              {calc.splitBasis === "brief" ? (
                <>
                  The same half, {formatCad(econ.poolCad / 2)}, less the{" "}
                  {formatCad(econ.yanchanBearsCad)} of processing, postage, packaging, returns,
                  defects and platform that the brief excluded from the calculation. Somebody still
                  pays them.
                </>
              ) : (
                <>
                  The same {formatCad(econ.toshiCad)} as Toshi Works, because the costs came out
                  before the split rather than out of one partner&rsquo;s half.
                </>
              )}
            </Why>
          </div>

          <div className="border-l-2 border-l-line-strong pl-3">
            <Label>against the brief&rsquo;s headline</Label>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink">
              The brief quotes {formatCad(BRIEF.eachPartnerCad)} each at 100% sell-through. At{" "}
              {econ.sellThroughPct}% this model pays Toshi Works {formatCad(econ.toshiCad)} and
              Yanchan{" "}
              <span className={econ.yanchanCad < 0 ? "text-sienna" : "text-amber"}>
                {formatCad(econ.yanchanCad)}
              </span>
              , a gap of {formatCad(Math.abs(econ.yanchanVsBriefCad))} against the half he is
              nominally owed.
            </p>
            <div className="mt-2 border-t border-line pt-2 font-mono text-[11.5px] leading-relaxed tabular-nums text-ink-dim">
              {econ.splitIsMeaningful ? (
                <>
                  effective split{" "}
                  <span className="text-ink">
                    {econ.toshiPct}% / {econ.yanchanPct}%
                  </span>{" "}
                  of the {formatCad(econ.honestNetCad)} actually earned
                </>
              ) : (
                <span className="text-sienna">
                  no effective percentage at this sell-through: one partner is below zero, and a
                  share of a total that one side is subsidising is not a number worth quoting
                </span>
              )}
            </div>
            <Why>
              Every projection needs the sell-through it assumes stapled to it. A bare
              &ldquo;{formatCad(BRIEF.profitCad)} profit&rdquo; is the 100% case, which is the
              ceiling.
            </Why>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2 border-t border-line pt-3">
          <div>
            <Label>toshi works breaks even at</Label>
            <div className="mt-0.5 font-mono text-[15px] tabular-nums text-ink">
              {Number.isFinite(econ.breakevenToshi.units) ? econ.breakevenToshi.units : "never"} of{" "}
              {econ.sellableTotal} units
              <span className="ml-1.5 text-[11px] text-ink-dim">
                {Number.isFinite(econ.breakevenToshi.units)
                  ? `${econ.breakevenToshi.pctOfSellable}%`
                  : ""}
              </span>
            </div>
          </div>
          <div>
            <Label>yanchan breaks even at</Label>
            <div className="mt-0.5 font-mono text-[15px] tabular-nums text-amber">
              {Number.isFinite(econ.breakevenYanchan.units) ? econ.breakevenYanchan.units : "never"}{" "}
              of {econ.sellableTotal} units
              <span className="ml-1.5 text-[11px] text-ink-dim">
                {Number.isFinite(econ.breakevenYanchan.units)
                  ? `${econ.breakevenYanchan.pctOfSellable}%`
                  : ""}
              </span>
            </div>
          </div>
          <p className="min-w-[300px] max-w-[74ch] flex-1 text-[11.5px] leading-relaxed text-ink-dim">
            {calc.splitBasis === "brief"
              ? `Two partners in a deal described as 50/50, with breakeven points ${Math.abs(
                  econ.breakevenYanchan.units - econ.breakevenToshi.units
                )} units apart on the same drop. Between those two numbers one partner is in profit and the other is paying for the privilege.`
              : "Defined properly, both partners clear at the same unit, because they are carrying the same costs. That is what a 50/50 deal looks like."}
          </p>
        </div>
      </Panel>

      {/* ---------------------------------------------------------------
          The waterfall. Revenue down to what is genuinely left.
         --------------------------------------------------------------- */}
      <Section
        title="revenue, every cost, and what is genuinely left"
        actions={<Label>at {econ.sellThroughPct}% sell-through · {econ.unitsSold} units</Label>}
      >
        <div className="flex flex-wrap items-start gap-x-8 gap-y-4 border-b border-line p-3">
          <Figure label="gross revenue" value={formatCad(econ.revenueCad)} tone="ink">
            {econ.unitsSold} units at an average of {formatCad(econ.blendedPriceCad)}. This is money
            that comes in, before anything at all is taken out of it.
          </Figure>
          <Figure
            label="already spent"
            value={formatCad(econ.sunkTotalCad)}
            tone="dim"
            sub={`${formatCad(econ.sunkProductionCad)} goods · ${formatCad(
              econ.sunkFeeCad
            )} fee · ${formatCad(econ.sunkDesignCad)} design`}
          >
            All of it is gone already. The 270 pieces exist, the artwork is drawn, the fee is paid.
            Accountants call this sunk, and it means one useful thing: no future decision can
            change it, so every sale from here is money toward it and never away from it.
          </Figure>
          <Figure
            label="cost of actually selling it"
            value={formatCad(econ.omittedCostTotalCad)}
            tone="sienna"
          >
            The lines the brief lists as not included. They are itemised below. This is the number
            that turns the brief&rsquo;s profit into the real one.
          </Figure>
          <Figure
            label="honest net profit"
            value={formatCad(econ.honestNetCad)}
            tone={econ.honestNetCad < 0 ? "sienna" : "amber"}
            sub={`${econ.honestMarginPct}% of revenue`}
          >
            Revenue, minus what was already spent, minus what it costs to sell. The brief&rsquo;s
            equivalent figure is {formatCad(econ.briefNetCad)}, which is{" "}
            {formatCad(econ.overstatementCad)} higher because it stops one line early.
          </Figure>
        </div>

        {econ.costLines.map((line) => (
          <div key={line.id} className="border-b border-line/60 px-3 py-2">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[12.5px] text-ink">{line.label}</span>
              <span className="font-mono text-[10.5px] tabular-nums text-ink-faint">
                {line.workingOut}
              </span>
              <div className="flex-1" />
              <span
                className={`font-mono text-[12.5px] tabular-nums ${
                  line.kind === "credit" ? "text-mint" : "text-ink"
                }`}
              >
                {formatCad(line.amountCad)}
              </span>
            </div>
            <Why>{line.why}</Why>
          </div>
        ))}

        <div className="flex items-baseline gap-2 border-b border-line bg-raised px-3 py-2">
          <span className="text-[12.5px] text-ink">
            Everything the brief left out, added up
          </span>
          <div className="flex-1" />
          <span className="font-mono text-[13px] tabular-nums text-sienna">
            {formatCad(econ.omittedCostTotalCad)}
          </span>
        </div>

        <div className="px-3 py-3">
          <p className="max-w-[100ch] text-[12.5px] leading-relaxed text-ink">
            So the brief&rsquo;s{" "}
            <span className="font-mono text-ink-dim">{formatCad(econ.briefNetCad)}</span> is really{" "}
            <span className="font-mono text-amber">{formatCad(econ.honestNetCad)}</span>.{" "}
            {econ.honestNetCad > 0
              ? `The brief's version is ${econ.overstatementPct}% higher than the truth.`
              : "At this sell-through the drop does not make money at all."}{" "}
            Note that all of this is still the best case in one respect: it assumes every piece
            that sells is sold in Canada. Canada Post to the United States runs roughly double the
            domestic rate, and this model has no line for it because nobody has decided whether
            international orders are accepted.
          </p>
        </div>
      </Section>

      {/* ---------------------------------------------------------------
          Per SKU. Price and giveaway are the two numbers a meeting can
          actually change, so they are the two that are editable.
         --------------------------------------------------------------- */}
      <Section
        title="per sku · retail price and giveaway are editable"
        actions={<Label>type in either column and everything above recomputes</Label>}
        bodyClassName="overflow-x-auto"
      >
        <div className={`${CALC_ROW} h-7 border-b border-line`}>
          <span />
          <span className={MICRO}>sku</span>
          <span className={`${MICRO} text-right`}>retail</span>
          <span className={`${MICRO} text-right`}>giveaway</span>
          <span className={`${MICRO} text-right`}>sellable</span>
          <span className={`${MICRO} text-right`}>sold</span>
          <span className={`${MICRO} text-right`}>revenue</span>
          <span className={`${MICRO} text-right`}>cost / sellable</span>
          <span className={`${MICRO} text-right`}>margin</span>
          <span className={`${MICRO} text-right`}>contribution</span>
        </div>
        {econ.skus.map((row) => (
          <div key={row.id} className={`${CALC_ROW} min-h-11 border-b border-line/60 py-1`}>
            <SkuShot
              art={row.art}
              label={`${row.name}, ${row.colourway}`}
              reason={noShotReason(row, "front")}
            />
            <div className="flex min-w-0 items-baseline gap-1.5">
              <span className="truncate text-[12.5px] text-ink">{row.name}</span>
              <span className="shrink-0 font-mono text-[10.5px] text-ink-dim">{row.colourway}</span>
            </div>
            <input
              type="number"
              min={0}
              step={5}
              value={row.priceCad}
              onChange={(e) => setPrice(row.id, Number(e.target.value))}
              aria-label={`Retail price for ${row.id}`}
              // A ring rather than a second border colour: two border-colour
              // utilities on one element resolve by stylesheet order, not by
              // the order they are written here, so the override is unreliable.
              className={`${INPUT} w-full text-right ${
                row.priceCad !== row.catalogPriceCad ? "ring-1 ring-amber/70" : ""
              }`}
            />
            <input
              type="number"
              min={0}
              max={row.produced}
              step={1}
              value={row.absorbed}
              onChange={(e) => setGiveaway(row.id, Number(e.target.value))}
              aria-label={`Units given away for ${row.id}`}
              className={`${INPUT} w-full text-right`}
            />
            <span className="text-right font-mono text-[11.5px] tabular-nums text-amber">
              {row.sellable}
            </span>
            <span className="text-right font-mono text-[11.5px] tabular-nums text-ink">
              {row.unitsSold}
            </span>
            <span className="text-right font-mono text-[11.5px] tabular-nums text-ink">
              {formatCad(row.revenueCad)}
            </span>
            <span className="text-right font-mono text-[11.5px] tabular-nums text-ink-dim">
              {formatCad(row.loadedCostPerSellableCad)}
            </span>
            <span
              className={`text-right font-mono text-[11.5px] tabular-nums ${
                row.loadedMarginPct < 40 ? "text-sienna" : "text-ink"
              }`}
            >
              {row.loadedMarginPct}%
            </span>
            <span className="text-right font-mono text-[11.5px] tabular-nums text-ink">
              {formatCad(row.forwardContributionPerUnitCad)}
            </span>
          </div>
        ))}
        <p className="max-w-[104ch] px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-dim">
          <span className="text-ink">cost / sellable</span> is this SKU&rsquo;s whole share of the
          spend divided by the units that can actually earn, so it already carries the giveaway and
          the design fee. <span className="text-ink">margin</span> is what is left of the retail
          price after that. <span className="text-ink">contribution</span> is the other question
          entirely: what one more sale puts in your pocket today, which is the price less the{" "}
          {formatCad(econ.forwardCostPerUnitCad)} it costs to fulfil. The first two tell you
          whether the drop was worth doing. The third is the only one that should influence a
          price from here, because everything in the first two is already spent. A SKU under 40%
          margin is flagged: it is eating units of the run without paying for them.
        </p>
      </Section>

      {/* ---------------------------------------------------------------
          The three costs per unit that all claim to be "the" cost.
         --------------------------------------------------------------- */}
      <Section
        title="cost per unit, four ways · they differ by nearly 3x and all four are correct"
        actions={<Label>this is where most of the confusion lives</Label>}
      >
        <div className="grid gap-4 p-3 md:grid-cols-2 xl:grid-cols-4">
          <Figure
            label="a · what the factory charged"
            value={formatCad(econ.weightedGarmentCostCad)}
            tone="dim"
            sub="hoodie $25 · long sleeve $20 · bandana $11"
          >
            The garment and nothing else. It ignores the {formatCad(econ.sunkFeeCad)} fee and the{" "}
            {formatCad(econ.sunkDesignCad)} of design completely, and it quietly assumes every
            piece made will earn money. This is the number the brief&rsquo;s margin story rests on,
            and it is the most flattering of the four.
          </Figure>
          <Figure
            label="b · per piece produced"
            value={formatCad(econ.costPerProducedPieceCad)}
            tone="ink"
            sub={`${formatCad(econ.sunkTotalCad)} ÷ ${econ.producedTotal} pieces`}
          >
            Every dollar spent, divided by every piece made. It is higher than (a) by{" "}
            {formatCad(econ.overheadPerProducedPieceCad)} a piece, which is the design and the fee
            spread across the run. Nothing dishonest about (a), but nobody reading a SKU table is
            mentally adding {formatCad(econ.overheadPerProducedPieceCad)} to every line.
          </Figure>
          <Figure
            label="c · per piece that can be sold"
            value={formatCad(econ.costPerSellablePieceCad)}
            tone="amber"
            sub={`${formatCad(econ.sunkTotalCad)} ÷ ${econ.sellableTotal} sellable`}
          >
            The same money, divided by only the pieces that can ever bring money back in. It is
            higher than (b) because {econ.giveawayUnits} pieces are given away, so the{" "}
            {econ.sellableTotal} that sell have to carry their cost too. A bandana that
            &ldquo;costs $11&rdquo; has to clear {formatCad(econ.costPerSellablePieceCad)} of spend
            before the drop earns anything. This is the honest answer to &ldquo;was this worth
            doing&rdquo;.
          </Figure>
          <Figure
            label="d · what one more sale costs"
            value={formatCad(econ.forwardCostPerUnitCad)}
            tone="mint"
            sub="processing, postage, packaging, returns, defects"
          >
            The only cost still ahead of you. Everything in (a), (b) and (c) has already left the
            bank account and no decision can bring it back, so the only thing a price has to beat
            today is this. That is why a bandana at $20 can be a better decision than a bandana at
            $35 that sits in a box.
          </Figure>
        </div>
        <p className="max-w-[104ch] border-t border-line px-3 py-2.5 text-[12px] leading-relaxed text-ink">
          Two separate things make {formatCad(econ.weightedGarmentCostCad)} become{" "}
          {formatCad(econ.costPerSellablePieceCad)}.{" "}
          <span className="text-amber">The first is the fees:</span> the design and the production
          fee are real spend, they are just recorded in a different table from the unit costs.{" "}
          <span className="text-amber">The second is the giveaway:</span> dividing by{" "}
          {econ.sellableTotal} instead of {econ.producedTotal} raises the cost of every remaining
          piece, because the pieces that leave for free still have to be paid for by the ones that
          do not.
        </p>
      </Section>

      {/* ---------------------------------------------------------------
          The giveaway. The largest discretionary line in the project,
          and the brief gives it one sentence.
         --------------------------------------------------------------- */}
      <Section
        title={`the ${econ.giveawayUnits} pieces given away`}
        actions={<Label>edit the giveaway column above and this moves</Label>}
      >
        <div className="flex flex-wrap items-start gap-x-8 gap-y-4 p-3">
          <Figure
            label="cost to make them"
            value={formatCad(econ.giveawayDirectCostCad)}
            tone="ink"
            sub={`${econ.giveawayUnits} of ${econ.producedTotal} pieces · ${
              econ.producedTotal > 0 ? Math.round((econ.giveawayUnits / econ.producedTotal) * 100) : 0
            }% of the run`}
          >
            Cash that has already been spent on goods that will be handed over for nothing. The
            brief is right that it should not be deducted twice, and that sentence reads as though
            the giveaways are free. They are not.
          </Figure>
          <Figure
            label="retail those pieces would have earned"
            value={formatCad(econ.giveawayRetailForgoneCad)}
            tone="ink"
          >
            What the same {econ.giveawayUnits} pieces would have brought in at the current prices,
            if every one of them had sold.
          </Figure>
          <Figure
            label="profit given up"
            value={formatCad(econ.giveawayProfitForgoneCad)}
            tone="sienna"
            sub={`retail forgone less ${formatCad(econ.giveawayFulfilmentSavedCad)} you did not spend fulfilling them`}
          >
            You do not lose the whole retail value, because a piece you never ship is a piece you
            never pay postage on. The difference is the real number.{" "}
            <span className="text-sienna">
              At full sell-through that is {econ.giveawayShareOfNetAtFullPct}% of the entire
              drop&rsquo;s honest profit.
            </span>{" "}
            This is the single largest discretionary decision in the project and the brief spends
            one sentence on it.
          </Figure>
        </div>
        <div className="border-t border-line px-3 py-2.5">
          <p className="max-w-[104ch] text-[12px] leading-relaxed text-ink">
            It is not only how many, it is which ones. The hoodie is the piece with the most profit
            in it by a distance, and it is the piece the most of is being given away. A bandana
            does the same job at a merch table, reads as a gift, and costs a quarter as much. Move
            the giveaway toward bandanas in the table above and watch the honest net move.
          </p>
        </div>
      </Section>

      {/* ---------------------------------------------------------------
          Breakeven. The floor the brief never gives.
         --------------------------------------------------------------- */}
      <Section
        title="breakeven · the floor the brief does not state"
        actions={<Label>out of {econ.sellableTotal} sellable units</Label>}
      >
        <div className="flex flex-wrap items-start gap-x-8 gap-y-4 p-3">
          <Figure
            label="in the brief's world"
            value={
              Number.isFinite(econ.breakevenBrief.units)
                ? `${econ.breakevenBrief.units} units`
                : "never"
            }
            tone="dim"
            sub={
              Number.isFinite(econ.breakevenBrief.units)
                ? `${econ.breakevenBrief.pctOfSellable}% of the ${econ.sellableTotal}`
                : undefined
            }
          >
            Enough revenue to cover the {formatCad(econ.sunkTotalCad)} and nothing else, at an
            average of {formatCad(econ.blendedPriceCad)} a unit. This is the floor the brief
            implies, and it is too low.
          </Figure>
          <Figure
            label="in the real world"
            value={
              Number.isFinite(econ.breakevenHonest.units)
                ? `${econ.breakevenHonest.units} units`
                : "never"
            }
            tone="amber"
            sub={
              Number.isFinite(econ.breakevenHonest.units)
                ? `${econ.breakevenHonest.pctOfSellable}% of the ${econ.sellableTotal}`
                : undefined
            }
          >
            Each unit leaves {formatCad(econ.contributionPerUnitCad)} behind once the{" "}
            {formatCad(econ.forwardCostPerUnitCad)} of fulfilling it is paid, so it takes this many
            to clear the {formatCad(econ.sunkTotalCad)} plus the{" "}
            {formatCad(econ.fixedForwardCostCad)} of platform and tooling.
          </Figure>
          <Figure
            label="contribution per unit"
            value={formatCad(econ.contributionPerUnitCad)}
            tone="mint"
            sub={`${econ.blendedContributionMarginPct}% of the average price`}
          >
            Average price {formatCad(econ.blendedPriceCad)} less{" "}
            {formatCad(econ.forwardCostPerUnitCad)} to fulfil. Because the production money is
            already gone, every single sale from here is contribution: it can only help.
          </Figure>
        </div>
      </Section>

      {/* ---------------------------------------------------------------
          The ladder. 100% is the ceiling, and it should look like one.
         --------------------------------------------------------------- */}
      <Section
        title="sell-through ladder · 100% is the ceiling, not the plan"
        actions={<Label>same assumptions, different sell-through · click a row to load it</Label>}
        bodyClassName="overflow-x-auto"
      >
        <div className={`${LADDER_ROW} h-7 border-b border-line`}>
          <span className={MICRO}>sell-through</span>
          <span className={`${MICRO} text-right`}>units</span>
          <span className={`${MICRO} text-right`}>revenue</span>
          <span className={`${MICRO} text-right`}>honest net</span>
          <span className={`${MICRO} text-right`}>toshi works</span>
          <span className={`${MICRO} text-right`}>yanchan</span>
        </div>
        {ladder.map((step) => {
          const isCurrent = Math.round(step.level * 100) === Math.round(calc.sellThrough * 100);
          const likely =
            step.level >= LIKELY_SELL_THROUGH.low && step.level <= LIKELY_SELL_THROUGH.high;
          return (
            <button
              key={step.level}
              type="button"
              onClick={() => patchCalc({ sellThrough: step.level })}
              className={`${LADDER_ROW} h-9 w-full border-b border-line/60 text-left transition-colors last:border-b-0 hover:bg-white/[0.03] ${
                isCurrent ? "bg-amber/10" : ""
              }`}
            >
              <span className="flex items-center gap-1.5 font-mono text-[11.5px] tabular-nums text-ink">
                {Math.round(step.level * 100)}%
                {likely && <span className="text-[9.5px] uppercase text-amber">likely</span>}
                {step.level === 1 && <span className="text-[9.5px] uppercase text-ink-faint">ceiling</span>}
              </span>
              <span className="text-right font-mono text-[11.5px] tabular-nums text-ink-dim">
                {step.economics.unitsSold}
              </span>
              <span className="text-right font-mono text-[11.5px] tabular-nums text-ink-dim">
                {formatCad(step.economics.revenueCad)}
              </span>
              <span
                className={`text-right font-mono text-[11.5px] tabular-nums ${
                  step.economics.honestNetCad < 0 ? "text-sienna" : "text-ink"
                }`}
              >
                {formatCad(step.economics.honestNetCad)}
              </span>
              <span className="text-right font-mono text-[11.5px] tabular-nums text-ink-dim">
                {formatCad(step.economics.toshiCad)}
              </span>
              <span
                className={`text-right font-mono text-[11.5px] tabular-nums ${
                  step.economics.yanchanCad < 0 ? "text-sienna" : "text-amber"
                }`}
              >
                {formatCad(step.economics.yanchanCad)}
              </span>
            </button>
          );
        })}
        <p className="max-w-[104ch] px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-dim">
          A single show cannot carry {econ.sellableTotal} pieces. Merch conversion at a live show
          runs 10% to 20% of the room, so a 300-capacity venue realistically moves 30 to 60 pieces
          and the website has to do the rest over weeks. A social following converts at a fraction
          of a percent, not at the rate a follower count suggests. The brief quotes the bottom row
          of this table as the projection. It is the top of the range, and every row above the
          highlighted one is a row where somebody has to be told why.
        </p>
      </Section>

      {/* ---------------------------------------------------------------
          Orders. Read live, filtered two ways, exported one row per line.
         --------------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2 px-1">
        <SegmentedControl<View>
          value={view}
          label="Order view"
          onChange={setView}
          options={[
            { value: "orders", label: `all orders ${snap.orders.length}` },
            { value: "preorders", label: `pre-orders ${preOrderOrders}` },
          ]}
        />
        <SegmentedControl<FulfilmentFilter>
          value={fulfilmentFilter}
          label="Fulfilment filter"
          onChange={setFulfilmentFilter}
          options={[
            { value: "all", label: "any" },
            { value: "unfulfilled", label: `unfulfilled ${fulfilmentCounts.unfulfilled}` },
            { value: "packed", label: `packed ${fulfilmentCounts.packed}` },
            { value: "shipped", label: `shipped ${fulfilmentCounts.shipped}` },
          ]}
        />
        <div className="flex-1" />
        <a href="/api/merch-admin?format=csv" className={CSV_LINK}>
          CSV · every line
        </a>
        <a href="/api/merch-admin?format=csv&scope=preorder" className={CSV_LINK}>
          CSV · pre-order lines
        </a>
      </div>

      {view === "preorders" && (
        <Section
          title="reorder quantity · pre-order units by sku and size"
          actions={<Label>this is what the second production run has to cover</Label>}
        >
          {reorder.length === 0 ? (
            <EmptyState
              title="No pre-order lines"
              body="Nothing has been sold beyond the sellable run yet. A line becomes a pre-order when its SKU's claimed count has already reached sellable at the moment of purchase."
            />
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-5 border-b border-line px-4 py-3">
                <div>
                  <Label>units to reorder</Label>
                  <div className="text-amber">
                    <Stat value={reorderUnits} display />
                  </div>
                </div>
                <p className="min-w-[280px] max-w-[62ch] flex-1 text-[12.5px] leading-relaxed text-ink-dim">
                  Every one of these is paid for and does not exist yet. Grouped by SKU and
                  size because that is how a production order is placed. {reorder.length}{" "}
                  size line{reorder.length === 1 ? "" : "s"} across {preOrderOrders} order
                  {preOrderOrders === 1 ? "" : "s"}.
                </p>
              </div>
              <div className="grid grid-cols-[32px_minmax(0,1fr)_88px_72px_88px] items-center gap-2 border-b border-line px-4 py-1.5">
                <span />
                <span className={MICRO}>sku</span>
                <span className={MICRO}>size</span>
                <span className={`${MICRO} text-right`}>units</span>
                <span className={`${MICRO} text-right`}>orders</span>
              </div>
              {reorder.map((r) => (
                <div
                  key={r.key}
                  className="grid grid-cols-[32px_minmax(0,1fr)_88px_72px_88px] items-center gap-2 border-b border-line/60 px-4 py-2 last:border-b-0"
                >
                  <LineShot skuId={r.skuId} label={`${r.name}, ${r.colourway}`} />
                  <div className="flex min-w-0 items-baseline gap-1.5">
                    <span className="truncate text-[12.5px] text-ink">{r.name}</span>
                    <span className="shrink-0 font-mono text-[10.5px] text-ink-dim">
                      {r.colourway}
                    </span>
                  </div>
                  <span className="font-mono text-[11.5px] text-ink-dim">{r.size}</span>
                  <span className="text-right font-mono text-[12.5px] tabular-nums text-amber">
                    {r.units}
                  </span>
                  <span className="text-right font-mono text-[11.5px] tabular-nums text-ink-dim">
                    {r.orders}
                  </span>
                </div>
              ))}
            </>
          )}
        </Section>
      )}

      <Section
        title={view === "preorders" ? "orders carrying a pre-order line" : "orders"}
        actions={
          <Label>
            {visibleOrders.length} shown · buyer details stay behind the internal gate
          </Label>
        }
      >
        {visibleOrders.length === 0 ? (
          <EmptyState
            title={snap.squareConfigured ? "No orders match" : "No orders to read"}
            body={
              snap.squareConfigured
                ? "Nothing in Square matches this filter. Orders are read live on every load, and there is no cached copy that could be stale."
                : "Orders live in Square and no account is connected yet. The stock model above is the catalogue, and it is complete."
            }
          />
        ) : (
          visibleOrders.map((order) => {
            const draft = trackingValue(order);
            const stored = order.trackingNumber ?? "";
            const units = order.lines.reduce((a, l) => a + l.quantity, 0);
            return (
              <article key={order.id} className="border-b border-line px-3 py-2.5 last:border-b-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-[11.5px] text-amber">{order.id}</span>
                  <span className="font-mono text-[11px] tabular-nums text-ink-dim">
                    {order.createdAt.slice(0, 10)}
                  </span>
                  <span className="text-[12.5px] text-ink">
                    {order.buyerName ?? "no name on the session"}
                  </span>
                  {order.hasPreOrder && <Chip tone="rust">pre-order</Chip>}
                  <div className="flex-1" />
                  <span className="font-mono text-[11px] tabular-nums text-ink-dim">
                    {units} unit{units === 1 ? "" : "s"}
                  </span>
                  <span className="font-mono text-[12.5px] tabular-nums text-ink">
                    {formatCad(order.totalCad)}
                  </span>
                </div>

                <div className="mt-2 grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                  <div>
                    {order.lines.map((line, i) => (
                      <div
                        key={`${line.skuId}-${line.size ?? "onesize"}-${i}`}
                        className="flex items-center gap-2 border-b border-line/50 py-1 last:border-b-0"
                      >
                        <span className="w-8 shrink-0 text-right font-mono text-[11.5px] tabular-nums text-ink">
                          {line.quantity}×
                        </span>
                        <LineShot skuId={line.skuId} label={`${line.name}, ${line.colourway}`} />
                        <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
                          {line.name}
                          <span className="ml-1.5 font-mono text-[10.5px] text-ink-dim">
                            {line.colourway}
                          </span>
                        </span>
                        <span className="w-[60px] shrink-0 font-mono text-[11px] text-ink-dim">
                          {line.size ?? "one size"}
                        </span>
                        <Chip tone={line.state === "pre-order" ? "rust" : "muted"}>
                          {STATE_COPY[line.state].label}
                        </Chip>
                        <span className="w-[72px] shrink-0 text-right font-mono text-[11px] tabular-nums text-ink-dim">
                          {formatCad(line.unitPriceCad * line.quantity)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="border-l border-line pl-3">
                    <div className={MICRO}>ship to</div>
                    <p className="mt-1 whitespace-pre-line text-[12px] leading-relaxed text-ink">
                      {order.shippingAddress ?? "No shipping address on the session."}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-ink-dim">
                      {order.buyerEmail ?? "no email on the session"}
                    </p>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
                  <Label>fulfilment</Label>
                  <SegmentedControl<FulfilmentState>
                    value={order.fulfilment}
                    label={`Fulfilment state for ${order.id}`}
                    onChange={(next) =>
                      void send(
                        {
                          action: "fulfilment",
                          orderId: order.id,
                          state: next,
                          // The draft rides along so advancing a state never
                          // drops a tracking number that is already typed.
                          trackingNumber: draft.trim() || null,
                        },
                        order.id
                      )
                    }
                    options={FULFILMENT_OPTIONS}
                  />
                  <input
                    value={draft}
                    onChange={(e) =>
                      setTracking((t) => ({ ...t, [order.id]: e.target.value }))
                    }
                    placeholder="tracking number"
                    aria-label={`Tracking number for ${order.id}`}
                    className={`${INPUT} w-[220px]`}
                  />
                  <Button
                    size="sm"
                    disabled={
                      busy !== null ||
                      !draft.trim() ||
                      (order.fulfilment === "shipped" && draft.trim() === stored)
                    }
                    onClick={() =>
                      void send(
                        {
                          action: "fulfilment",
                          orderId: order.id,
                          state: "shipped",
                          trackingNumber: draft.trim(),
                        },
                        order.id
                      )
                    }
                  >
                    {busy === order.id
                      ? "Writing…"
                      : order.fulfilment === "shipped"
                        ? "Update tracking"
                        : "Ship with tracking"}
                  </Button>
                  {stored ? (
                    <Chip tone="amber">tracking {stored}</Chip>
                  ) : order.fulfilment === "shipped" ? (
                    <Chip tone="rust">shipped with no tracking number</Chip>
                  ) : null}
                </div>
              </article>
            );
          })
        )}
      </Section>
    </>
  );
}
