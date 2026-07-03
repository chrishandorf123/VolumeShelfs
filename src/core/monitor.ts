import type { TradePlan } from "./tradePlan";
import type { Quote } from "../data/types";

/**
 * Where a live price sits relative to a saved trade plan. This is the intraday
 * "what's it doing right now" read: is it still setting up (WATCH), poking the
 * entry trigger (APPROACHING / TRIGGERED), broken below invalidation (STOPPED),
 * or already at a target (T1/T2)?
 */
export type MonitorStatus =
  | "STOPPED"
  | "T2"
  | "T1"
  | "TRIGGERED"
  | "APPROACHING"
  | "WATCH";

export interface MonitorRow {
  symbol: string;
  price: number;
  /** Today's move as a fraction (+0.012 = +1.2%). */
  changePct: number;
  status: MonitorStatus;
  /** Signed distance to entry as a fraction of price (positive = entry above). */
  toEntry: number;
  /** Distance to entry in R (units of the plan's risk) — 0.4R is "close" on a
   * tight plan and "far" on a wide one, which a raw % hides. NaN if risk unknown. */
  toEntryR: number;
  /** Signed distance to stop as a fraction (negative = stop below). */
  toStop: number;
  /** Signed distance to T1 as a fraction. */
  toT1: number;
  /** Latest trading day the quote is for, if the provider reports it. */
  day?: string;
  /** Timestamp of the print ("2026-07-01 15:55"), for intraday quotes. */
  asOf?: string;
  /** True when this is a live intraday print rather than a prior close. */
  live: boolean;
  /** One-line plain-English read of the status. */
  note: string;
}

/** How close (fraction of price) counts as "approaching" the entry trigger. */
export const APPROACH_BAND = 0.015;

const pct = (from: number, to: number): number =>
  from > 0 ? (to - from) / from : 0;

/**
 * Classify a live quote against a trade plan. Pure and point-in-time: it only
 * looks at the quote and the plan levels, so it's deterministic and testable.
 */
export function monitorRow(quote: Quote, plan: TradePlan): MonitorRow {
  const p = quote.price;
  const toEntry = pct(p, plan.entry);
  const toStop = pct(p, plan.stop);
  const toT1 = pct(p, plan.t1);
  const toEntryR = plan.riskPct > 0 ? toEntry / plan.riskPct : NaN;

  let status: MonitorStatus;
  let note: string;
  if (p <= plan.stop) {
    status = "STOPPED";
    note = `Below invalidation (${plan.stop.toFixed(2)}) — setup broken, stand aside.`;
  } else if (p >= plan.t2) {
    status = "T2";
    note = `At/through T2 (${plan.t2.toFixed(2)}) — extended, manage the runner.`;
  } else if (p >= plan.t1) {
    status = "T1";
    note = `Reached T1 (${plan.t1.toFixed(2)}) — trim / trail, don't chase.`;
  } else if (p >= plan.entry) {
    status = "TRIGGERED";
    note = `Above the ${plan.entry.toFixed(2)} trigger — in the move toward T1 ${plan.t1.toFixed(2)}.`;
  } else if (Math.abs(toEntry) <= APPROACH_BAND) {
    status = "APPROACHING";
    note = `Poking the ${plan.entry.toFixed(2)} trigger — watch for a reclaim close.`;
  } else {
    status = "WATCH";
    note = `Setting up: ${(toEntry * 100).toFixed(1)}% under the ${plan.entry.toFixed(2)} trigger.`;
  }

  return {
    symbol: quote.symbol,
    price: p,
    changePct: quote.changePct,
    status,
    toEntry,
    toEntryR,
    toStop,
    toT1,
    day: quote.day,
    asOf: quote.asOf,
    live: quote.live ?? false,
    note,
  };
}

/** Rank order for sorting the monitor so the most actionable names float up. */
const STATUS_RANK: Record<MonitorStatus, number> = {
  TRIGGERED: 0,
  APPROACHING: 1,
  T1: 2,
  T2: 3,
  WATCH: 4,
  STOPPED: 5,
};

/** Sort most-actionable first (triggered / approaching), stopped last. */
export function sortMonitorRows(rows: MonitorRow[]): MonitorRow[] {
  return [...rows].sort((a, b) => {
    const d = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (d !== 0) return d;
    // Within a status, nearest to its entry trigger first.
    return Math.abs(a.toEntry) - Math.abs(b.toEntry);
  });
}
