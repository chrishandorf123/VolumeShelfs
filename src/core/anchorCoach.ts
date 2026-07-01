import type { Candle } from "./types";
import { defaultAnchorHighIndex, defaultAnchorIndex } from "./swings";
import { significance } from "./anchor";

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

export function anchorCoach(candles: Candle[]): AnchorCoach | null {
  const n = candles.length;
  if (n < 30) return null;
  const lowIdx = defaultAnchorIndex(candles, 5, 20);
  const highIdx = defaultAnchorHighIndex(candles, 5, 20);
  const sigLow = significance(candles, lowIdx, "low");
  const sigHigh = significance(candles, highIdx, "high");
  // Bias toward the low (the common case); the high must clearly win.
  const recommendedKind: "low" | "high" = sigHigh >= sigLow + HIGH_MARGIN ? "high" : "low";

  const low: AnchorSuggestion = {
    index: lowIdx,
    price: candles[lowIdx].low,
    time: candles[lowIdx].time,
    kind: "low",
    significance: sigLow,
    recommended: recommendedKind === "low",
    label: "Major swing low",
  };
  const high: AnchorSuggestion = {
    index: highIdx,
    price: candles[highIdx].high,
    time: candles[highIdx].time,
    kind: "high",
    significance: sigHigh,
    recommended: recommendedKind === "high",
    label: "Major swing high",
  };

  const rationale =
    recommendedKind === "high"
      ? `Price has pulled back off the ${fmt(high.price)} swing high (${dateOf(high.time)}). Anchor from that high to see the overhead supply — the trapped buyers ("break-even supply") that price has to clear on the way up. You can still anchor the swing low to check for support underneath.`
      : `Price is holding above the ${fmt(low.price)} swing low (${dateOf(low.time)}). Anchor from that low to see the support built on the way up — the "break-even demand" that tends to hold price. You can still anchor the swing high to check overhead resistance.`;

  return { low, high, recommendedKind, rationale };
}
