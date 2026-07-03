import { detectGaps } from "./shelves";
import type { ScanResult } from "./scanner";

export interface TradePlan {
  /** Which way the plan makes money. Absent = long (all older plans). */
  side?: "long" | "short";
  /** True when T1/T2 is a bare percent marker, NOT a real volume level —
   *  the UI must label these and the buy gate must not trust their R. */
  t1Synthetic?: boolean;
  t2Synthetic?: boolean;
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

  // T1: POC if it sits above entry, else the next HVN shelf above. When no
  // volume level exists above, the fallback is a bare +3% marker — flag it,
  // because a percent marker is NOT a real level and must be labeled as such.
  const aboveShelf = result.nearest.above;
  let t1Synthetic = false;
  let t2Synthetic = false;
  let t1 = poc > entry ? poc : aboveShelf ? (aboveShelf.priceLow + aboveShelf.priceHigh) / 2 : vah;
  if (!(t1 > entry)) {
    t1Synthetic = !(vah > entry);
    t1 = vah > entry ? vah : entry * 1.03;
  }

  // T2: VAH, then beyond it.
  let t2 = vah > t1 ? vah : aboveShelf ? aboveShelf.priceHigh : t1 * 1.03;
  if (!(t2 > t1)) {
    t2 = t1 * 1.03;
    t2Synthetic = true;
  } else if (!(vah > t1) && !aboveShelf) {
    t2Synthetic = true;
  }

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
    t1Synthetic = false; // the gap target is a real level (the far shelf)
    t2Synthetic = !gapPlay.targetShelf;
    t2 = gapPlay.targetShelf ? gapPlay.targetShelf.priceHigh : Math.max(t2, gapPlay.target * 1.03);
    if (!(t2 > t1)) {
      t2 = t1 * 1.03;
      t2Synthetic = true;
    }
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
  if (t1Synthetic || t2Synthetic)
    notes.push(
      `${t1Synthetic ? "T1" : "T2"}${t1Synthetic && t2Synthetic ? " and T2 are" : " is a"} bare percent marker${t1Synthetic && t2Synthetic ? "s" : ""} — no volume level found there; treat the target as soft.`,
    );

  return {
    side: "long",
    t1Synthetic,
    t2Synthetic,
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

/**
 * The mirror image for downtrends (Shannon's short playbook): short the failed
 * rally into overhead supply — the break-even sellers above — with the stop
 * beyond the supply shelf and targets at the demand levels below. Returns null
 * when there's no overhead shelf to lean on (nothing to define the risk).
 */
export function buildShortPlan(result: ScanResult): TradePlan | null {
  const supply = result.nearest.above;
  if (!supply) return null;
  const { profile, price } = result;
  const val = profile.valueArea.low;
  const poc = profile.poc.mid;

  // Breakdown trigger: the nearer underfoot of {POC, VAL} price must lose —
  // or current price when it's already lost both (short the rally instead).
  const breakLevels = [poc, val].filter((v) => v <= price);
  const entry = breakLevels.length ? Math.max(...breakLevels) : price;
  const stop = supply.priceHigh * 1.005; // beyond the overhead shelf
  const reversalRef = supply.priceLow;

  // T1: the nearest demand shelf below (its top), else VAL, else a 3% marker —
  // flagged synthetic, because a percent marker is not a real level.
  const below = result.nearest.below;
  let t1Synthetic = false;
  let t2Synthetic = false;
  let t1 = below && below.priceHigh < entry ? below.priceHigh : val < entry ? val : entry * 0.97;
  if (!(t1 < entry)) {
    t1 = entry * 0.97;
    t1Synthetic = true;
  } else if (!(below && below.priceHigh < entry) && !(val < entry)) {
    t1Synthetic = true;
  }
  // T2: through the demand shelf / below the value area.
  let t2 = below && below.priceLow < t1 ? below.priceLow : t1 * 0.97;
  if (!(t2 < t1)) {
    t2 = t1 * 0.97;
    t2Synthetic = true;
  } else if (!(below && below.priceLow < t1)) {
    t2Synthetic = true;
  }

  // Air pocket below: fast travel once support goes.
  const gaps = detectGaps(profile, { shelfThreshold: 0.55, gapThreshold: 0.15 });
  const under = gaps
    .filter((g) => g.priceHigh <= entry)
    .sort((a, b) => b.priceHigh - a.priceHigh);
  const airPocket = under.length ? (under[0].priceLow + under[0].priceHigh) / 2 : null;

  const risk = stop - entry;
  const riskPct = entry > 0 ? risk / entry : NaN;
  const rT1 = risk > 0 ? (entry - t1) / risk : NaN;
  const rT2 = risk > 0 ? (entry - t2) / risk : NaN;
  if (!(risk > 0)) return null;

  const notes: string[] = [
    `Short against the ${supply.priceLow.toFixed(2)}–${supply.priceHigh.toFixed(2)} overhead shelf — trapped buyers sell into every rally there.`,
    `Cover-stop is a decisive close above ${stop.toFixed(2)}; a reclaim of the shelf kills the thesis.`,
    "Shorts move fast and squeeze faster — size smaller than a long, and never short a stage-2 uptrend.",
  ];
  if (airPocket !== null) notes.push(`Volume gap near ${airPocket.toFixed(2)} below — expect fast downside travel through it.`);
  if (t1Synthetic || t2Synthetic)
    notes.push("Some targets are bare percent markers (no demand level found there) — treat them as soft.");

  return {
    side: "short",
    t1Synthetic,
    t2Synthetic,
    isGapPlay: false,
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
