import { detectGaps } from "./shelves";
import type { ScanResult } from "./scanner";

export interface TradePlan {
  /** Reclaim trigger: close back above the shelf top / POC. */
  entry: number;
  /** Reference low for a reversal-candle entry (shelf low / VAL). */
  reversalRef: number;
  /** Invalidation: just below the support shelf low (or VAL). */
  stop: number;
  /** T1 = POC or next HVN above. */
  t1: number;
  /** T2 = VAH, then the next LVN "air pocket" above. */
  t2: number;
  /** Optional fast-travel target: midpoint of the next volume gap above. */
  airPocket: number | null;
  /** (entry − stop) / entry. */
  riskPct: number;
  rMultipleT1: number;
  rMultipleT2: number;
  notes: string[];
}

/**
 * Derive concrete entry/stop/target levels from a scan result, following the
 * checklist's Part 5. Returns null when there is no support shelf to anchor the
 * plan (the setup is not actionable for a long).
 */
export function buildTradePlan(result: ScanResult): TradePlan | null {
  const support = result.supportShelf;
  if (!support) return null;
  const { profile, price } = result;
  const vah = profile.valueArea.high;
  const val = profile.valueArea.low;
  const poc = profile.poc.mid;

  // Reclaim entry: the nearer overhead of {shelf top, POC} that price must
  // close back above. If price already cleared both, anchor at current price.
  const reclaimLevels = [support.priceHigh, poc].filter((v) => v >= price);
  const entry = reclaimLevels.length ? Math.min(...reclaimLevels) : price;

  const reversalRef = Math.max(support.priceLow, Math.min(val, support.priceHigh));
  const stop = support.priceLow * 0.995;

  // T1: POC if it sits above entry, else the next HVN shelf above.
  const aboveShelf = result.nearest.above;
  let t1 = poc > entry ? poc : (aboveShelf ? (aboveShelf.priceLow + aboveShelf.priceHigh) / 2 : vah);
  if (!(t1 > entry)) t1 = vah > entry ? vah : entry * 1.03;

  // T2: VAH, then beyond it.
  let t2 = vah > t1 ? vah : (aboveShelf ? aboveShelf.priceHigh : t1 * 1.03);
  if (!(t2 > t1)) t2 = t1 * 1.03;

  // Air pocket: the next low-volume gap above VAH (price travels fast there).
  const gaps = detectGaps(profile, { shelfThreshold: 0.55, gapThreshold: 0.15 });
  const above = gaps
    .filter((g) => g.priceLow >= Math.min(vah, t1))
    .sort((a, b) => a.priceLow - b.priceLow);
  const airPocket = above.length ? (above[0].priceLow + above[0].priceHigh) / 2 : null;

  const risk = entry - stop;
  const riskPct = entry > 0 ? risk / entry : NaN;
  const rT1 = risk > 0 ? (t1 - entry) / risk : NaN;
  const rT2 = risk > 0 ? (t2 - entry) / risk : NaN;

  const notes: string[] = [];
  notes.push(`Stop is the shelf — a decisive close below ${support.priceLow.toFixed(2)} on rising volume invalidates the thesis.`);
  if (result.pinch?.priceInside) notes.push("AVWAP pinch overlaps the shelf — A+ confluence.");
  if (!result.pocBelowPrice) notes.push("POC is above price; treat longs cautiously until reclaimed.");
  if (airPocket !== null) notes.push(`Volume gap near ${airPocket.toFixed(2)} — expect fast travel through it.`);

  return {
    entry,
    reversalRef,
    stop,
    t1,
    t2,
    airPocket,
    riskPct,
    rMultipleT1: rT1,
    rMultipleT2: rT2,
    notes,
  };
}
