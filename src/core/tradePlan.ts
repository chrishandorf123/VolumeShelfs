import { detectGaps } from "./shelves";
import type { ScanResult } from "./scanner";

export interface TradePlan {
  /** True when the plan is driven by an active volume-gap play (the main play). */
  isGapPlay: boolean;
  /** Reclaim trigger: close back above the shelf top / POC into the gap. */
  entry: number;
  /** Reference low for a reversal-candle entry (shelf low / VAL). */
  reversalRef: number;
  /** Invalidation: just below the support shelf low (or VAL). */
  stop: number;
  /** T1 = far side of the gap (target shelf) or POC / next HVN above. */
  t1: number;
  /** T2 = VAH / beyond the target shelf. */
  t2: number;
  /** The fast-travel air pocket midpoint, if any. */
  airPocket: number | null;
  /** (entry − stop) / entry. */
  riskPct: number;
  rMultipleT1: number;
  rMultipleT2: number;
  notes: string[];
}

/**
 * Derive concrete entry/stop/target levels from a scan result. When an active
 * volume-gap play exists it drives the plan (enter at the support shelf, target
 * the far side of the air pocket — the main play); otherwise it falls back to
 * the value-area / next-HVN logic. Returns null when there is no shelf to anchor
 * the plan.
 */
export function buildTradePlan(result: ScanResult): TradePlan | null {
  const support = result.supportShelf;
  if (!support) return null;
  const { profile, price, gapPlay, avwap } = result;
  const vah = profile.valueArea.high;
  const val = profile.valueArea.low;
  const poc = profile.poc.mid;

  // Reclaim entry: the nearer overhead of {shelf top, POC} that price must
  // close back above. If price already cleared both, anchor at current price.
  const reclaimLevels = [support.priceHigh, poc].filter((v) => v >= price);
  let entry = reclaimLevels.length ? Math.min(...reclaimLevels) : price;
  const reversalRef = Math.max(support.priceLow, Math.min(val, support.priceHigh));
  let stop = support.priceLow * 0.995;

  // T1: POC if it sits above entry, else the next HVN shelf above.
  const aboveShelf = result.nearest.above;
  let t1 = poc > entry ? poc : aboveShelf ? (aboveShelf.priceLow + aboveShelf.priceHigh) / 2 : vah;
  if (!(t1 > entry)) t1 = vah > entry ? vah : entry * 1.03;

  // T2: VAH, then beyond it.
  let t2 = vah > t1 ? vah : aboveShelf ? aboveShelf.priceHigh : t1 * 1.03;
  if (!(t2 > t1)) t2 = t1 * 1.03;

  // Air pocket: the next low-volume gap above VAH (price travels fast there).
  const gaps = detectGaps(profile, { shelfThreshold: 0.55, gapThreshold: 0.15 });
  const above = gaps
    .filter((g) => g.priceLow >= Math.min(vah, t1))
    .sort((a, b) => a.priceLow - b.priceLow);
  let airPocket = above.length ? (above[0].priceLow + above[0].priceHigh) / 2 : null;

  // The main play: an active gap play overrides the generic levels — enter at
  // the support shelf, ride the air pocket to the far shelf.
  const isGapPlay = gapPlay !== null && gapPlay.active;
  if (gapPlay && isGapPlay) {
    entry = gapPlay.entry;
    stop = gapPlay.stop;
    t1 = gapPlay.target;
    t2 = gapPlay.targetShelf ? gapPlay.targetShelf.priceHigh : Math.max(t2, gapPlay.target * 1.03);
    if (!(t2 > t1)) t2 = t1 * 1.03;
    airPocket = (gapPlay.gap.priceLow + gapPlay.gap.priceHigh) / 2;
  }

  const risk = entry - stop;
  const riskPct = entry > 0 ? risk / entry : NaN;
  const rT1 = risk > 0 ? (t1 - entry) / risk : NaN;
  const rT2 = risk > 0 ? (t2 - entry) / risk : NaN;

  const notes: string[] = [];
  if (isGapPlay && gapPlay) {
    notes.push(
      `Main play: hold ${support.priceLow.toFixed(2)}, ride the ${(gapPlay.airPocketPct * 100).toFixed(0)}% air pocket to ${gapPlay.target.toFixed(2)} (${gapPlay.rr.toFixed(1)}R).`,
    );
  }
  notes.push(
    `Stop is the shelf — a decisive close below ${support.priceLow.toFixed(2)} on rising volume invalidates the thesis.`,
  );
  if (avwap.bullish) notes.push("Price above a rising AVWAP — Shannon trend support is intact.");
  else if (avwap.reclaim) notes.push("Fresh AVWAP reclaim — momentum is turning up.");
  else notes.push("Below the key AVWAP — wait for a reclaim before committing (Shannon).");
  if (result.pinch?.priceInside) notes.push("AVWAP pinch overlaps the shelf — confluence.");
  if (!result.pocBelowPrice) notes.push("POC is above price (overhead supply); treat longs cautiously.");
  if (airPocket !== null && !isGapPlay)
    notes.push(`Volume gap near ${airPocket.toFixed(2)} — expect fast travel through it.`);

  return {
    isGapPlay,
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
