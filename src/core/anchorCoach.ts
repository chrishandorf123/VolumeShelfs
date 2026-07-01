import type { Candle } from "./types";
import { detectSwings } from "./swings";
import { significance } from "./anchor";

/** Look back roughly a year for the coach's pivots, not the whole history. */
const COACH_WINDOW = 252;

/**
 * The Anchor Coach: instead of silently auto-picking, tell the user WHERE and
 * WHEN to anchor. It finds the major swing low and swing high, decides which is
 * the more meaningful anchor for the current structure, and explains why in
 * plain English so a beginner learns the "swing high vs swing low" call.
 */
export interface AnchorSuggestion {
  index: number;
  price: number;
  time: number;
  kind: "low" | "high";
  /** 0..1 how dominant this pivot is as the origin of the current structure. */
  significance: number;
  recommended: boolean;
  label: string;
}

export interface AnchorCoach {
  low: AnchorSuggestion;
  high: AnchorSuggestion;
  recommendedKind: "low" | "high";
  /** One or two plain sentences on why to anchor there now. */
  rationale: string;
}

function fmt(v: number): string {
  return `$${v >= 100 ? v.toFixed(0) : v.toFixed(2)}`;
}
function dateOf(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 10);
}

const HIGH_MARGIN = 0.1;

/** Index of the lowest low / highest high bar within [from, to] (inclusive). */
function extremeIndex(candles: Candle[], from: number, to: number, kind: "low" | "high"): number {
  let best = Math.max(0, Math.min(from, candles.length - 1));
  for (let i = best; i <= to && i < candles.length; i++) {
    const better =
      kind === "low" ? candles[i].low < candles[best].low : candles[i].high > candles[best].high;
    if (better) best = i;
  }
  return best;
}

/**
 * @param window How many of the most-recent bars to search for the pivots.
 *   Defaults to ~a year. Pass the selected timeframe's bar count so the coach
 *   recommends a swing high/low from the window you're actually looking at.
 */
export function anchorCoach(candles: Candle[], window: number = COACH_WINDOW): AnchorCoach | null {
  const n = candles.length;
  if (n < 30) return null;

  // Search the major swing pivots within the selected window, so the coach's
  // recommendation matches the timeframe on screen (and a long history — a
  // former penny stock, an old IPO low — doesn't anchor from a price 30x away
  // and 3 years ago). Fall back to the full-series major pivot when the window
  // has none.
  const win = Math.max(30, Math.min(window, n));
  const from = Math.max(0, n - win);
  // Reserve the freshest bars so the anchor has room to build structure, but
  // scale the reserve to the window so a short timeframe still finds a pivot
  // instead of an empty range.
  const reserve = Math.min(20, Math.max(3, Math.floor(win / 5)));
  const lastAllowed = n - 1 - reserve;
  const swings = detectSwings(candles, 5).filter((s) => s.index >= from && s.index <= lastAllowed);
  const lows = swings.filter((s) => s.kind === "low");
  const highs = swings.filter((s) => s.kind === "high");
  // If the window has no clean fractal pivot (common on a short timeframe), fall
  // back to the extreme bar *inside the window* — never the whole-series low —
  // so the anchor always stays within the timeframe you selected.
  const lowIdx = lows.length
    ? lows.reduce((b, s) => (s.price < b.price ? s : b), lows[0]).index
    : extremeIndex(candles, from, lastAllowed, "low");
  const highIdx = highs.length
    ? highs.reduce((b, s) => (s.price > b.price ? s : b), highs[0]).index
    : extremeIndex(candles, from, lastAllowed, "high");
  const sigLow = significance(candles, lowIdx, "low");
  const sigHigh = significance(candles, highIdx, "high");
  const price = candles[n - 1].close;
  const lowPrice = candles[lowIdx].low;
  const highPrice = candles[highIdx].high;
  // Price position decides the anchor first; significance only breaks the tie in
  // the normal pullback zone. If price has broken *below* the swing low, that low
  // is no longer support — it's overhead — so anchor the high to read the supply.
  // If price is above the swing high (new highs), anchor the low for the base.
  let recommendedKind: "low" | "high";
  if (price < lowPrice) recommendedKind = "high";
  else if (price > highPrice) recommendedKind = "low";
  else recommendedKind = sigHigh >= sigLow + HIGH_MARGIN ? "high" : "low";

  const low: AnchorSuggestion = {
    index: lowIdx,
    price: lowPrice,
    time: candles[lowIdx].time,
    kind: "low",
    significance: sigLow,
    recommended: recommendedKind === "low",
    label: "Major swing low",
  };
  const high: AnchorSuggestion = {
    index: highIdx,
    price: highPrice,
    time: candles[highIdx].time,
    kind: "high",
    significance: sigHigh,
    recommended: recommendedKind === "high",
    label: "Major swing high",
  };

  let rationale: string;
  if (recommendedKind === "high") {
    rationale =
      price < lowPrice
        ? `Price has broken below the ${fmt(low.price)} swing low and now trades at ${fmt(price)} — that former support has become overhead resistance. Anchor from the ${fmt(high.price)} swing high (${dateOf(high.time)}) to see the full stack of break-even supply price has to reclaim to turn back up.`
        : `Price has pulled back off the ${fmt(high.price)} swing high (${dateOf(high.time)}) to ${fmt(price)}. Anchor from that high to see the overhead supply — the trapped buyers ("break-even supply") price has to clear on the way up. You can still anchor the swing low to check for support underneath.`;
  } else {
    rationale = `Price is holding above the ${fmt(low.price)} swing low (${dateOf(low.time)}) at ${fmt(price)}. Anchor from that low to see the support built on the way up — the "break-even demand" that tends to hold price. You can still anchor the swing high to check overhead resistance.`;
  }

  return { low, high, recommendedKind, rationale };
}
