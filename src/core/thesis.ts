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

  // A first objective shouldn't imply an unrealistic move. When the nearest real
  // shelf is a distant tail (e.g. an old low far under the current price), use a
  // proportional first target and surface the distant level as the second one.
  const MAX_FIRST = 0.5;

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
  let bullFar: number | null = null;
  if (bullT1 > bullTrigger * (1 + MAX_FIRST)) {
    bullFar = bullT1; // real but distant resistance
    bullT1 = bullTrigger * 1.15; // realistic first objective
  }
  let bullT2 = bullFar ?? (above ? above.priceHigh : Math.max(vah, bullT1) * 1.03);
  if (!(bullT2 > bullT1)) bullT2 = bullT1 * 1.05;
  // Invalidation must come from the SAME shelf the trigger does, and always sit
  // below the trigger — otherwise an active gap play (trigger = its launch-shelf
  // top) paired with a higher support shelf's low could put "invalid" above the
  // trigger, i.e. wrong the instant it fires.
  let bullInvalid = gp && gp.active ? gp.stop : support ? support.priceLow * 0.995 : Math.min(val, price * 0.95);
  if (!(bullInvalid < bullTrigger)) bullInvalid = bullTrigger * 0.995;
  const triggerShelfWord = gp && gp.active ? "launch shelf top" : support ? "shelf top" : "reclaim level";
  const bull: ThesisCase = {
    direction: "bull",
    trigger: bullTrigger,
    targets: [bullT1, bullT2],
    invalidation: bullInvalid,
    headline: `Above ${money(bullTrigger)} → ${money(bullT1)} / ${money(bullT2)}, invalid below ${money(bullInvalid)}`,
    detail:
      `Bull case: a close back above ${money(bullTrigger)} (the ${triggerShelfWord}${poc >= price ? " / POC" : ""}) puts buyers in control — ` +
      `the volume overhead is the fuel. First target ${money(bullT1)}, then ${money(bullT2)}${above && bullFar === null ? " (the next shelf)" : ""}. ` +
      (bullFar !== null ? `There's no heavy resistance until ${money(bullFar)} — an open runway above. ` : "") +
      `Wrong on a decisive close below ${money(bullInvalid)} (loses the shelf).`,
  };

  // ---- BEAR: lose support → fall through the air pocket below --------------
  const bearTrigger = support ? support.priceLow : Number.isFinite(avwap) ? Math.min(val, avwap) : val;
  let bearT1 = below ? (below.priceLow + below.priceHigh) / 2 : val < bearTrigger ? val : bearTrigger * 0.95;
  if (!(bearT1 < bearTrigger)) bearT1 = bearTrigger * 0.95;
  let bearFar: number | null = null;
  if (bearT1 < bearTrigger * (1 - MAX_FIRST)) {
    bearFar = bearT1; // real but distant support
    bearT1 = bearTrigger * 0.85; // realistic first objective
  }
  let bearT2 = bearFar ?? (below ? below.priceLow : Math.min(val, bearT1) * 0.97);
  if (!(bearT2 < bearT1)) bearT2 = bearT1 * 0.95;
  const bearInvalid = support ? support.priceHigh : Math.max(poc, Number.isFinite(avwap) ? avwap : poc);
  const bear: ThesisCase = {
    direction: "bear",
    trigger: bearTrigger,
    targets: [bearT1, bearT2],
    invalidation: bearInvalid,
    headline: `Below ${money(bearTrigger)} → ${money(bearT1)} / ${money(bearT2)}, invalid above ${money(bearInvalid)}`,
    detail:
      `Bear case: a decisive close below ${money(bearTrigger)} (the ${support ? "shelf low" : "value-area low"}) on rising volume breaks support — ` +
      `the thin volume beneath opens an air pocket down. First target ${money(bearT1)}, then ${money(bearT2)}${below && bearFar === null ? " (the next shelf down)" : ""}. ` +
      (bearFar !== null ? `There's little real support until ${money(bearFar)} — a large air pocket below. ` : "") +
      `Wrong back above ${money(bearInvalid)} (reclaims the ${support ? "shelf" : "POC"}).`,
  };

  return { bull, bear };
}
