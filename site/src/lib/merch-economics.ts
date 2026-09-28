/**
 * The tour drop's cost model.
 *
 * Pure arithmetic. No React, no Square, no fetch, no disk. It imports the
 * catalogue and nothing else, so the merch admin can render the whole economic
 * picture on a machine with no payment account wired up at all.
 *
 * Ground truth is `openspec/changes/merch-commerce-v1/research/financial-model.md`,
 * where every figure below was recomputed by hand against the Toshi Works brief.
 * Two specs constrain it: `landed-cost-pricing` (cost is allocated per piece
 * across the whole spend, not from the blank alone) and `partner-split-terms`
 * (net profit is revenue minus ALL costs, and each partner's breakeven is
 * stated separately because they are not the same number).
 *
 * The one thing this file exists to make unmissable: the brief defines profit
 * as revenue minus $6,405 and splits it 50/50, while listing shipping,
 * processing and fulfilment as "not included". Those costs land on whoever
 * ships the boxes. Run that through the arithmetic and the brief's own best
 * case pays Toshi Works $3,585 and Yanchan $826.50, which is 81/19.
 *
 * Every figure carries a `workingOut` and a `why` string so the screen can show
 * the arithmetic and the plain-English reason beside the number, instead of
 * asking anyone to trust a total.
 */
import { MERCH, formatCad, type MerchSku } from "./merch";

/* ------------------------------------------------------------------ *
 * Fixed facts. Sunk spend, and the rates the forward costs run at.
 * ------------------------------------------------------------------ */

/** Paid to Toshi Works on top of the garment cost. Undefined in the brief; ask for the invoice. */
export const ADDITIONAL_PRODUCTION_FEE_CAD = 650;
/** The artwork. Paid, to someone, for a design nobody has claimed ownership of in writing. */
export const DESIGN_COST_CAD = 1000;
/** Commerce tooling and a card reader for the merch table. The only forward cost that is fixed. */
export const PLATFORM_AND_TOOLING_CAD = 209;

/**
 * Square Canada published rates, corrected 2026-09-14 when the rail moved off Square.
 * Online was carrying Square's 2.9% and in-person a 2.65% estimate; Square Canada is
 * 2.8% + 30c online and a flat 2.5% tapped, inserted or swiped. Cards issued outside
 * Canada add 1.5%, which this model does not attempt to predict.
 */
export const ONLINE_PERCENT = 0.028;
export const ONLINE_FIXED_CAD = 0.3;
/** Square Canada card-present pricing, for the merch table. No per-transaction fee. */
export const CARD_PRESENT_PERCENT = 0.025;
export const CARD_PRESENT_FIXED_CAD = 0;
/** Share of in-person takings paid by card rather than cash. */
export const CARD_SHARE_IN_PERSON = 0.8;

export const UNITS_PER_ONLINE_ORDER = 1.3;
export const UNITS_PER_IN_PERSON_TXN = 1.15;
export const PACKAGING_ONLINE_CAD = 1.5;
export const PACKAGING_IN_PERSON_CAD = 0.4;
/** Share of online orders that come back. Each one costs a label plus the processing fee Square keeps. */
export const RETURN_RATE = 0.08;
export const RETURN_COST_CAD = 28;
/**
 * Share of units lost to damage or misprint. The loss is the REVENUE, not the
 * cost: production is already spent, so a ruined piece takes a sale with it.
 */
export const DEFECT_RATE = 0.03;

/** Canada Post domestic, 0.5kg to 1kg. The real range, for the slider bounds. */
export const PARCEL_COST_RANGE_CAD = { min: 12, max: 18 } as const;

/**
 * The research puts likely sell-through at 60% to 75% over a 60 to 90 day
 * window. 100% is the ceiling, not the forecast, and the UI defaults here so
 * nobody reads the ceiling as a plan.
 */
export const LIKELY_SELL_THROUGH = { low: 0.6, high: 0.75 } as const;
export const DEFAULT_SELL_THROUGH = 0.7;

/** The brief's own headline, at 100% sell-through. Quoted so the gap can be shown. */
export const BRIEF = {
  revenueCad: 13575,
  costToRecoverCad: 6405,
  profitCad: 7170,
  eachPartnerCad: 3585,
} as const;

export type ShippingModel = "absorb" | "flat" | "threshold";
export type SplitBasis = "brief" | "true";

export type EconomicsInputs = {
  /** 0 to 1. Share of sellable units that actually sell. */
  sellThrough: number;
  /** Retail price per SKU id. Overrides the catalogue. */
  prices: Record<string, number>;
  /** Units held back per SKU id. Changes sellable, so it changes everything. */
  absorbed: Record<string, number>;
  shippingModel: ShippingModel;
  /** What Canada Post charges us per parcel. */
  parcelCostCad: number;
  /** What the buyer is charged per parcel, under flat and threshold. */
  shippingChargeCad: number;
  freeShippingThresholdCad: number;
  /** 0 to 1. Share of online orders big enough to ship free. An assumption, not a measurement. */
  ordersClearingThreshold: number;
  /** 0 to 1. Share of units sold online rather than at the show. */
  shippedShare: number;
  splitBasis: SplitBasis;
};

export function defaultInputs(): EconomicsInputs {
  const prices: Record<string, number> = {};
  const absorbed: Record<string, number> = {};
  for (const sku of MERCH) {
    prices[sku.id] = sku.priceCad;
    absorbed[sku.id] = sku.absorbed;
  }
  return {
    sellThrough: DEFAULT_SELL_THROUGH,
    prices,
    absorbed,
    shippingModel: "absorb",
    parcelCostCad: 15,
    shippingChargeCad: 12,
    freeShippingThresholdCad: 150,
    ordersClearingThreshold: 0.45,
    shippedShare: 0.6,
    splitBasis: "brief",
  };
}

export type CostLine = {
  id: string;
  label: string;
  /** Negative for a credit, such as postage recovered from the buyer. */
  amountCad: number;
  kind: "cost" | "credit";
  /** The arithmetic, spelled out. */
  workingOut: string;
  /** Why this line exists at all, in plain English. */
  why: string;
};

export type SkuEconomics = {
  id: string;
  name: string;
  colourway: string;
  garment: MerchSku["garment"];
  art: string | null;
  artBack: string | null;
  produced: number;
  absorbed: number;
  sellable: number;
  unitsSold: number;
  priceCad: number;
  catalogPriceCad: number;
  unitCostCad: number;
  revenueCad: number;
  /** This SKU's share of the $1,650 of design and fees, at a flat rate per produced piece. */
  overheadShareCad: number;
  loadedCostTotalCad: number;
  loadedCostPerProducedCad: number;
  loadedCostPerSellableCad: number;
  loadedMarginPct: number;
  loadedContributionPerUnitCad: number;
  forwardContributionPerUnitCad: number;
  forwardMarginPct: number;
  forwardContributionTotalCad: number;
  giveawayDirectCostCad: number;
  giveawayRetailForgoneCad: number;
};

export type Breakeven = {
  /** Infinity when the contribution per unit is zero or negative, so it never clears. */
  units: number;
  pctOfSellable: number;
  reachable: boolean;
};

export type Economics = {
  inputs: EconomicsInputs;
  skus: SkuEconomics[];

  producedTotal: number;
  absorbedTotal: number;
  sellableTotal: number;
  unitsSold: number;
  sellThroughPct: number;

  revenueCad: number;
  revenueAtFullSellThroughCad: number;
  blendedPriceCad: number;

  sunkProductionCad: number;
  sunkFeeCad: number;
  sunkDesignCad: number;
  sunkTotalCad: number;

  /** The $1,650 of non-merchandise spend, at a flat rate across all 270 pieces. */
  overheadPerProducedPieceCad: number;
  costPerProducedPieceCad: number;
  costPerSellablePieceCad: number;
  weightedGarmentCostCad: number;

  onlineUnits: number;
  inPersonUnits: number;
  onlineOrders: number;
  inPersonTransactions: number;
  onlineRevenueCad: number;
  inPersonRevenueCad: number;
  averageOnlineOrderCad: number;

  costLines: CostLine[];
  shippingRecoveredCad: number;
  variableCostCad: number;
  fixedForwardCostCad: number;
  omittedCostTotalCad: number;
  /**
   * What one more unit costs to fulfil, measured across a full sell-through so
   * the rate does not wobble as the sell-through slider moves. Everything in the
   * model that is per unit uses this.
   */
  forwardCostPerUnitCad: number;
  contributionPerUnitCad: number;

  briefNetCad: number;
  honestNetCad: number;
  overstatementCad: number;
  overstatementPct: number;
  briefMarginPct: number;
  honestMarginPct: number;
  blendedContributionMarginPct: number;

  breakevenBrief: Breakeven;
  breakevenHonest: Breakeven;
  breakevenToshi: Breakeven;
  breakevenYanchan: Breakeven;

  poolCad: number;
  toshiCad: number;
  yanchanCad: number;
  yanchanBearsCad: number;
  toshiPct: number;
  yanchanPct: number;
  splitIsMeaningful: boolean;
  toshiVsBriefCad: number;
  yanchanVsBriefCad: number;

  giveawayUnits: number;
  giveawayDirectCostCad: number;
  giveawayRetailForgoneCad: number;
  giveawayFulfilmentSavedCad: number;
  giveawayProfitForgoneCad: number;
  giveawayShareOfNetPct: number;
  /** The same share measured against the ceiling case, which is the figure the research quotes. */
  giveawayShareOfNetAtFullPct: number;
};

const money = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number) => Math.round(n * 1000) / 10;
const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
const n1 = (n: number) => n.toFixed(1);

function breakeven(fixedCad: number, contributionPerUnit: number, sellableTotal: number): Breakeven {
  if (!(contributionPerUnit > 0)) {
    return { units: Infinity, pctOfSellable: Infinity, reachable: false };
  }
  const units = Math.ceil(fixedCad / contributionPerUnit);
  return {
    units,
    pctOfSellable: sellableTotal > 0 ? pct(units / sellableTotal) : 0,
    reachable: sellableTotal > 0 ? units <= sellableTotal : false,
  };
}

/**
 * The whole model, in one pass.
 *
 * Read it in four movements: what exists and what it cost (sunk), what sells
 * and for how much (revenue), what selling it costs (the forward lines the
 * brief leaves out), and who ends up with the money (the split).
 */
export function computeEconomics(inputs: EconomicsInputs, catalogue: MerchSku[] = MERCH): Economics {
  const sellThrough = clamp01(inputs.sellThrough);
  const shippedShare = clamp01(inputs.shippedShare);

  /* --- 1. What exists, and what it already cost ------------------- */

  const producedTotal = catalogue.reduce((a, s) => a + s.produced, 0);
  const sunkProductionCad = catalogue.reduce((a, s) => a + s.produced * s.unitCostCad, 0);
  const sunkTotalCad = sunkProductionCad + ADDITIONAL_PRODUCTION_FEE_CAD + DESIGN_COST_CAD;
  const overheadPerProducedPiece =
    producedTotal > 0 ? (ADDITIONAL_PRODUCTION_FEE_CAD + DESIGN_COST_CAD) / producedTotal : 0;

  /* --- 2. What sells, and for how much ---------------------------- */

  type Row = {
    sku: MerchSku;
    price: number;
    absorbed: number;
    sellable: number;
    unitsSold: number;
    revenue: number;
    loadedTotal: number;
  };

  const rows: Row[] = catalogue.map((sku) => {
    const price = Number.isFinite(inputs.prices[sku.id]) ? Math.max(0, inputs.prices[sku.id]) : sku.priceCad;
    const absorbed = Math.min(
      sku.produced,
      Math.max(0, Math.round(Number.isFinite(inputs.absorbed[sku.id]) ? inputs.absorbed[sku.id] : sku.absorbed))
    );
    const sellableUnits = Math.max(0, sku.produced - absorbed);
    const unitsSold = Math.round(sellableUnits * sellThrough);
    return {
      sku,
      price,
      absorbed,
      sellable: sellableUnits,
      unitsSold,
      revenue: unitsSold * price,
      loadedTotal: sku.produced * sku.unitCostCad + sku.produced * overheadPerProducedPiece,
    };
  });

  const absorbedTotal = rows.reduce((a, r) => a + r.absorbed, 0);
  const sellableTotal = rows.reduce((a, r) => a + r.sellable, 0);
  const unitsSold = rows.reduce((a, r) => a + r.unitsSold, 0);
  const revenue = rows.reduce((a, r) => a + r.revenue, 0);
  const revenueAtFull = rows.reduce((a, r) => a + r.sellable * r.price, 0);
  const blendedPrice = sellableTotal > 0 ? revenueAtFull / sellableTotal : 0;

  /* --- 3. What selling it costs ----------------------------------- */

  /**
   * The forward costs, for a given number of units and the revenue they earn.
   *
   * Every line except the platform budget is proportional to units or to
   * revenue, which is why it can be evaluated twice: once for the scenario on
   * screen, and once at full sell-through to get a per-unit rate that does not
   * move as the sell-through slider does.
   */
  function forwardCosts(units: number, rev: number) {
    const online = Math.round(units * shippedShare);
    const inPerson = units - online;
    const orders = online / UNITS_PER_ONLINE_ORDER;
    const transactions = inPerson / UNITS_PER_IN_PERSON_TXN;
    const onlineRev = units > 0 ? rev * (online / units) : 0;
    const inPersonRev = rev - onlineRev;

    const chargePerOrder =
      inputs.shippingModel === "absorb"
        ? 0
        : inputs.shippingModel === "flat"
          ? Math.max(0, inputs.shippingChargeCad)
          : Math.max(0, inputs.shippingChargeCad) * (1 - clamp01(inputs.ordersClearingThreshold));
    const recovered = orders * chargePerOrder;

    const onlineBase = onlineRev + recovered;
    const onlineFees = onlineBase * ONLINE_PERCENT + orders * ONLINE_FIXED_CAD;
    const cardRevenue = inPersonRev * CARD_SHARE_IN_PERSON;
    const cardPresent =
      cardRevenue * CARD_PRESENT_PERCENT +
      transactions * CARD_SHARE_IN_PERSON * CARD_PRESENT_FIXED_CAD;
    const postage = orders * Math.max(0, inputs.parcelCostCad);
    const packaging = orders * PACKAGING_ONLINE_CAD + transactions * PACKAGING_IN_PERSON_CAD;
    const returns = orders * RETURN_RATE * RETURN_COST_CAD;
    const defects = rev * DEFECT_RATE;

    const variable =
      onlineFees + cardPresent + postage + packaging + returns + defects - recovered;

    return {
      online,
      inPerson,
      orders,
      transactions,
      onlineRev,
      inPersonRev,
      chargePerOrder,
      recovered,
      onlineBase,
      onlineFees,
      cardRevenue,
      cardPresent,
      postage,
      packaging,
      returns,
      defects,
      variable,
      total: variable + PLATFORM_AND_TOOLING_CAD,
    };
  }

  const now = forwardCosts(unitsSold, revenue);
  /**
   * The same costs at 100% sell-through. This is where the per-unit forward
   * rate comes from, so that "what does one more sale cost to fulfil" and every
   * breakeven derived from it stay put while the sell-through slider moves.
   */
  const ceiling = forwardCosts(sellableTotal, revenueAtFull);
  const forwardCostPerUnit = sellableTotal > 0 ? ceiling.variable / sellableTotal : 0;
  const contributionPerUnit = blendedPrice - forwardCostPerUnit;

  const shippingWord =
    inputs.shippingModel === "absorb"
      ? "The buyer pays nothing for postage, so every cent of it comes out of the drop."
      : inputs.shippingModel === "flat"
        ? `Every online order is charged ${formatCad(inputs.shippingChargeCad)}, so the drop only carries the gap.`
        : `Orders over ${formatCad(inputs.freeShippingThresholdCad)} ship free, and ${pct(clamp01(inputs.ordersClearingThreshold))}% of them are expected to clear it.`;

  const costLines: CostLine[] = [
    {
      id: "online-fees",
      label: "Square, online",
      amountCad: money(now.onlineFees),
      kind: "cost",
      workingOut: `${(ONLINE_PERCENT * 100).toFixed(1)}% of ${formatCad(money(now.onlineBase))} plus ${n1(now.orders)} orders at ${formatCad(ONLINE_FIXED_CAD)}`,
      why: "Square takes a slice of every card payment plus a flat fee per order. Small orders are hit hardest by the flat 30 cents, which is one reason a bundle beats two separate sales.",
    },
    {
      id: "card-present",
      label: "Card reader, at the show",
      amountCad: money(now.cardPresent),
      kind: "cost",
      workingOut: `${(CARD_PRESENT_PERCENT * 100).toFixed(2)}% of ${formatCad(money(now.cardRevenue))} plus ${n1(now.transactions * CARD_SHARE_IN_PERSON)} tapped sales at ${formatCad(CARD_PRESENT_FIXED_CAD)}`,
      why: `Tap-to-pay at the merch table is cheaper than online because the card is present. Assumes ${pct(CARD_SHARE_IN_PERSON)}% of takings are on a card and the rest is cash.`,
    },
    {
      id: "postage",
      label: "Postage",
      amountCad: money(now.postage),
      kind: "cost",
      workingOut: `${n1(now.orders)} parcels at ${formatCad(inputs.parcelCostCad)}`,
      why: `Canada Post runs ${formatCad(PARCEL_COST_RANGE_CAD.min)} to ${formatCad(PARCEL_COST_RANGE_CAD.max)} for a hoodie-sized domestic parcel. ${shippingWord} This is the largest single line the brief leaves out.`,
    },
    {
      id: "packaging",
      label: "Packaging",
      amountCad: money(now.packaging),
      kind: "cost",
      workingOut: `${n1(now.orders)} mailers at ${formatCad(PACKAGING_ONLINE_CAD)} plus ${n1(now.transactions)} bags at ${formatCad(PACKAGING_IN_PERSON_CAD)}`,
      why: "A polymailer, a label and a thank-you insert. Small per order, and it never appears on an invoice anyone reads.",
    },
    {
      id: "returns",
      label: "Returns and exchanges",
      amountCad: money(now.returns),
      kind: "cost",
      workingOut: `${pct(RETURN_RATE)}% of ${n1(now.orders)} orders at ${formatCad(RETURN_COST_CAD)}`,
      why: "A wrong size costs a return label plus either a second parcel or the Square fee, which Square keeps when you refund. Apparel sold without try-on returns at roughly this rate.",
    },
    {
      id: "defects",
      label: "Defects and damage",
      amountCad: money(now.defects),
      kind: "cost",
      workingOut: `${pct(DEFECT_RATE)}% of ${formatCad(money(revenue))} of revenue`,
      why: "A misprinted or damaged piece costs you the sale, not the garment. The garment was already paid for, so the loss is the price it would have fetched.",
    },
    {
      id: "platform",
      label: "Platform and tooling",
      amountCad: PLATFORM_AND_TOOLING_CAD,
      kind: "cost",
      workingOut: "Fixed, whatever the volume",
      why: "Three months of commerce tooling, domain and email, plus a card reader for the merch table. The only forward cost that does not scale with sales.",
    },
  ];

  if (now.recovered > 0) {
    costLines.push({
      id: "shipping-recovered",
      label: "Postage recovered from buyers",
      amountCad: -money(now.recovered),
      kind: "credit",
      workingOut: `${n1(now.orders)} orders at ${formatCad(money(now.chargePerOrder))} each`,
      why: "Money the buyer pays toward postage. It comes back as a credit rather than as revenue, so the revenue line stays comparable to the brief's.",
    });
  }

  /**
   * Totalled from the unrounded figures, not by adding the rounded lines above.
   * Seven lines rounded to the cent and then summed drift a cent from the truth,
   * and this total is checked against the research model.
   */
  const omittedCostTotal = now.total;
  const variableCost = now.variable;

  /* --- 4. Who ends up with the money ------------------------------ */

  const briefNet = revenue - sunkTotalCad;
  const honestNet = briefNet - omittedCostTotal;

  const pool = briefNet;
  const briefBasis = inputs.splitBasis === "brief";
  const toshi = briefBasis ? pool / 2 : honestNet / 2;
  const yanchanBears = briefBasis ? omittedCostTotal : 0;
  const yanchan = briefBasis ? pool / 2 - omittedCostTotal : honestNet / 2;
  const totalTake = toshi + yanchan;
  /**
   * A percentage split only means anything while both takes are positive. Once
   * one partner is underwater the share reads as 142% and -42%, which is
   * arithmetically true and useless. The screen switches to plain amounts.
   */
  const splitIsMeaningful = totalTake > 0 && toshi >= 0 && yanchan >= 0;

  const skus: SkuEconomics[] = rows.map((r) => {
    const loadedPerSellable = r.sellable > 0 ? r.loadedTotal / r.sellable : 0;
    const loadedPerProduced = r.sku.produced > 0 ? r.loadedTotal / r.sku.produced : 0;
    return {
      id: r.sku.id,
      name: r.sku.name,
      colourway: r.sku.colourway,
      garment: r.sku.garment,
      art: r.sku.art,
      artBack: r.sku.artBack,
      produced: r.sku.produced,
      absorbed: r.absorbed,
      sellable: r.sellable,
      unitsSold: r.unitsSold,
      priceCad: money(r.price),
      catalogPriceCad: r.sku.priceCad,
      unitCostCad: r.sku.unitCostCad,
      revenueCad: money(r.revenue),
      overheadShareCad: money(r.sku.produced * overheadPerProducedPiece),
      loadedCostTotalCad: money(r.loadedTotal),
      loadedCostPerProducedCad: money(loadedPerProduced),
      loadedCostPerSellableCad: money(loadedPerSellable),
      loadedMarginPct: r.price > 0 ? pct((r.price - loadedPerSellable) / r.price) : 0,
      loadedContributionPerUnitCad: money(r.price - loadedPerSellable),
      forwardContributionPerUnitCad: money(r.price - forwardCostPerUnit),
      forwardMarginPct: r.price > 0 ? pct((r.price - forwardCostPerUnit) / r.price) : 0,
      forwardContributionTotalCad: money(r.unitsSold * (r.price - forwardCostPerUnit)),
      giveawayDirectCostCad: money(r.absorbed * r.sku.unitCostCad),
      giveawayRetailForgoneCad: money(r.absorbed * r.price),
    };
  });

  const giveawayDirectCost = skus.reduce((a, s) => a + s.giveawayDirectCostCad, 0);
  const giveawayRetailForgone = skus.reduce((a, s) => a + s.giveawayRetailForgoneCad, 0);
  const giveawayFulfilmentSaved = absorbedTotal * forwardCostPerUnit;
  const giveawayProfitForgone = giveawayRetailForgone - giveawayFulfilmentSaved;
  /** Honest profit at the ceiling, so the giveaway can be sized against the best case too. */
  const ceilingNet = revenueAtFull - sunkTotalCad - ceiling.total;

  return {
    inputs,
    skus,

    producedTotal,
    absorbedTotal,
    sellableTotal,
    unitsSold,
    sellThroughPct: pct(sellThrough),

    revenueCad: money(revenue),
    revenueAtFullSellThroughCad: money(revenueAtFull),
    blendedPriceCad: money(blendedPrice),

    sunkProductionCad: money(sunkProductionCad),
    sunkFeeCad: ADDITIONAL_PRODUCTION_FEE_CAD,
    sunkDesignCad: DESIGN_COST_CAD,
    sunkTotalCad: money(sunkTotalCad),

    overheadPerProducedPieceCad: money(overheadPerProducedPiece),
    costPerProducedPieceCad: money(producedTotal > 0 ? sunkTotalCad / producedTotal : 0),
    costPerSellablePieceCad: money(sellableTotal > 0 ? sunkTotalCad / sellableTotal : 0),
    weightedGarmentCostCad: money(producedTotal > 0 ? sunkProductionCad / producedTotal : 0),

    onlineUnits: now.online,
    inPersonUnits: now.inPerson,
    onlineOrders: Math.round(now.orders * 10) / 10,
    inPersonTransactions: Math.round(now.transactions * 10) / 10,
    onlineRevenueCad: money(now.onlineRev),
    inPersonRevenueCad: money(now.inPersonRev),
    averageOnlineOrderCad: money(now.orders > 0 ? now.onlineRev / now.orders : 0),

    costLines,
    shippingRecoveredCad: money(now.recovered),
    variableCostCad: money(variableCost),
    fixedForwardCostCad: PLATFORM_AND_TOOLING_CAD,
    omittedCostTotalCad: money(omittedCostTotal),
    forwardCostPerUnitCad: money(forwardCostPerUnit),
    contributionPerUnitCad: money(contributionPerUnit),

    briefNetCad: money(briefNet),
    honestNetCad: money(honestNet),
    overstatementCad: money(briefNet - honestNet),
    overstatementPct: honestNet > 0 ? pct((briefNet - honestNet) / honestNet) : 0,
    briefMarginPct: revenue > 0 ? pct(briefNet / revenue) : 0,
    honestMarginPct: revenue > 0 ? pct(honestNet / revenue) : 0,
    blendedContributionMarginPct: blendedPrice > 0 ? pct(contributionPerUnit / blendedPrice) : 0,

    breakevenBrief: breakeven(sunkTotalCad, blendedPrice, sellableTotal),
    breakevenHonest: breakeven(
      sunkTotalCad + PLATFORM_AND_TOOLING_CAD,
      contributionPerUnit,
      sellableTotal
    ),
    breakevenToshi: briefBasis
      ? breakeven(sunkTotalCad, blendedPrice, sellableTotal)
      : breakeven(sunkTotalCad + PLATFORM_AND_TOOLING_CAD, contributionPerUnit, sellableTotal),
    breakevenYanchan: briefBasis
      ? breakeven(
          sunkTotalCad / 2 + PLATFORM_AND_TOOLING_CAD,
          blendedPrice / 2 - forwardCostPerUnit,
          sellableTotal
        )
      : breakeven(sunkTotalCad + PLATFORM_AND_TOOLING_CAD, contributionPerUnit, sellableTotal),

    poolCad: money(pool),
    toshiCad: money(toshi),
    yanchanCad: money(yanchan),
    yanchanBearsCad: money(yanchanBears),
    toshiPct: splitIsMeaningful ? pct(toshi / totalTake) : 0,
    yanchanPct: splitIsMeaningful ? pct(yanchan / totalTake) : 0,
    splitIsMeaningful,
    toshiVsBriefCad: money(toshi - pool / 2),
    yanchanVsBriefCad: money(yanchan - pool / 2),

    giveawayUnits: absorbedTotal,
    giveawayDirectCostCad: money(giveawayDirectCost),
    giveawayRetailForgoneCad: money(giveawayRetailForgone),
    giveawayFulfilmentSavedCad: money(giveawayFulfilmentSaved),
    giveawayProfitForgoneCad: money(giveawayProfitForgone),
    giveawayShareOfNetPct: honestNet > 0 ? pct(giveawayProfitForgone / honestNet) : 0,
    giveawayShareOfNetAtFullPct: ceilingNet > 0 ? pct(giveawayProfitForgone / ceilingNet) : 0,
  };
}

/** The same model at a ladder of sell-through levels, so 100% reads as a ceiling. */
export function sellThroughLadder(
  inputs: EconomicsInputs,
  levels: number[] = [0.5, 0.6, 0.7, 0.75, 0.85, 1]
): { level: number; economics: Economics }[] {
  return levels.map((level) => ({
    level,
    economics: computeEconomics({ ...inputs, sellThrough: level }),
  }));
}
