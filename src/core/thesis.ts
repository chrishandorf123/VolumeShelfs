import type { ScanResult } from "./scanner";

/**
 * Wujastyk always frames a name as BOTH a bull case and a bear case — each with
 * a specific trigger, target(s) and invalidation — so it stays "a perspective,"
 * not a single prediction. This derives both directional cases from the volume
 * structure (the shelf at price, the shelves above/below, the value area and the
 * key anchored VWAP).
 */
export interface ThesisCase {
  direction: "bull" | "bear";
  /** The price level that activates the case. */
  trigger: number;
  /** One or two objectives in the direction of the case. */
  targets: number[];
  /** The level that proves the case wrong. */
  invalidation: number;
  /** Compact "trigger → targets, invalid @" line. */
  headline: string;
  /** Plain-English rationale. */
  detail: string;
}

export interface DualThesis {
  bull: ThesisCase;
  bear: ThesisCase;
}

function money(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `$${v >= 100 ? v.toFixed(0) : v.toFixed(2)}`;
}

/** Build the bull and bear cases for a scanned name. */
export function buildThesis(r: ScanResult): DualThesis {
  const { price, profile } = r;
  const vah = profile.valueArea.high;
  const val = profile.valueArea.low;
  const poc = profile.poc.mid;
  const support = r.supportShelf; // shelf at/below price
  const above = r.nearest.above; // nearest overhead shelf (resistance)
  const below = r.nearest.below; // nearest shelf beneath (lower support)
  const avwap = r.avwap.keyState.value;
  const gp = r.gapPlay;

  // ---- BULL: reclaim overhead → ride the volume above ---------------------
  let bullTrigger: number;
  if (gp && gp.active) {
    bullTrigger = gp.entry;
  } else {
    const reclaim = [support?.priceHigh, poc].filter(
      (v): v is number => typeof v === "number" && Number.isFinite(v) && v >= price,
    );
    bullTrigger = reclaim.length ? Math.min(...reclaim) : price;
  }
  let bullT1 = above ? (above.priceLow + above.priceHigh) / 2 : vah > bullTrigger ? vah : bullTrigger * 1.05;
  if (!(bullT1 > bullTrigger)) bullT1 = bullTrigger * 1.05;
  let bullT2 = above ? above.priceHigh : Math.max(vah, bullT1) * 1.03;
  if (!(bullT2 > bullT1)) bullT2 = bullT1 * 1.03;
  const bullInvalid = support ? support.priceLow * 0.995 : Math.min(val, price * 0.95);
  const bull: ThesisCase = {
    direction: "bull",
    trigger: bullTrigger,
    targets: [bullT1, bullT2],
    invalidation: bullInvalid,
    headline: `Above ${money(bullTrigger)} → ${money(bullT1)} / ${money(bullT2)}, invalid below ${money(bullInvalid)}`,
    detail:
      `Bull case: a close back above ${money(bullTrigger)} (the ${support ? "shelf top" : "reclaim level"}${poc >= price ? " / POC" : ""}) puts buyers in control — ` +
      `the volume overhead is the fuel. First target ${money(bullT1)} (${above ? "the next shelf" : "value-area high"}), then ${money(bullT2)}. ` +
      `Wrong on a decisive close below ${money(bullInvalid)} (loses the shelf).`,
  };

  // ---- BEAR: lose support → fall through the air pocket below --------------
  const bearTrigger = support ? support.priceLow : Number.isFinite(avwap) ? Math.min(val, avwap) : val;
  let bearT1 = below ? (below.priceLow + below.priceHigh) / 2 : val < bearTrigger ? val : bearTrigger * 0.95;
  if (!(bearT1 < bearTrigger)) bearT1 = bearTrigger * 0.95;
  let bearT2 = below ? below.priceLow : Math.min(val, bearT1) * 0.97;
  if (!(bearT2 < bearT1)) bearT2 = bearT1 * 0.97;
  const bearInvalid = support ? support.priceHigh : Math.max(poc, Number.isFinite(avwap) ? avwap : poc);
  const bear: ThesisCase = {
    direction: "bear",
    trigger: bearTrigger,
    targets: [bearT1, bearT2],
    invalidation: bearInvalid,
    headline: `Below ${money(bearTrigger)} → ${money(bearT1)} / ${money(bearT2)}, invalid above ${money(bearInvalid)}`,
    detail:
      `Bear case: a decisive close below ${money(bearTrigger)} (the ${support ? "shelf low" : "value-area low"}) on rising volume breaks support — ` +
      `the thin volume beneath opens an air pocket down. First target ${money(bearT1)} (${below ? "the next shelf down" : "value-area low"}), then ${money(bearT2)}. ` +
      `Wrong back above ${money(bearInvalid)} (reclaims the ${support ? "shelf" : "POC"}).`,
  };

  return { bull, bear };
}
