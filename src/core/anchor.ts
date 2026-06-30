import type { Candle } from "./types";
import { defaultAnchorIndex } from "./swings";
import { index52wLow, indexAtTime } from "./avwap";

export type AnchorLabel = "earnings" | "breakout" | "swing-low" | "52w-low";

export interface ChosenAnchor {
  index: number;
  label: AnchorLabel;
}

/**
 * Find the most recent breakout bar: a close that clears the highest high of
 * the prior `lookback` bars after a consolidation. Returns -1 when none is
 * found within `searchWindow` bars of the end (or when it is too recent to
 * build a profile, i.e. fewer than `minAfter` bars follow it).
 */
export function findRecentBreakout(
  candles: Candle[],
  lookback = 50,
  searchWindow = 120,
  minAfter = 20,
): number {
  const n = candles.length;
  const lastAllowed = n - 1 - minAfter;
  const earliest = Math.max(lookback, n - searchWindow);
  for (let i = lastAllowed; i >= earliest; i--) {
    let priorHigh = -Infinity;
    for (let j = i - lookback; j < i; j++) if (candles[j].high > priorHigh) priorHigh = candles[j].high;
    const brokeOut = candles[i].close > priorHigh && candles[i - 1].close <= priorHigh;
    if (brokeOut) return i;
  }
  return -1;
}

export interface AnchorOptions {
  earningsTime?: number;
  minBars?: number;
  swingLookback?: number;
}

/**
 * Choose a per-ticker anchor following the scanner's priority: a recent
 * earnings gap (if supplied) → a recent breakout → the major swing low that
 * started the leg → the 52-week low as a fallback.
 */
export function chooseScanAnchor(candles: Candle[], opts: AnchorOptions = {}): ChosenAnchor {
  const minBars = opts.minBars ?? 20;
  const n = candles.length;

  if (opts.earningsTime !== undefined) {
    const idx = indexAtTime(candles, opts.earningsTime);
    if (idx <= n - 1 - minBars && idx >= 0) return { index: idx, label: "earnings" };
  }

  // The major swing low that started the current leg is the most robust general
  // anchor — it spans base → now and captures the shelf the price pulls into.
  const swing = defaultAnchorIndex(candles, 5, minBars);
  if (swing > 0) return { index: swing, label: "swing-low" };

  // Otherwise look for the breakout that began the advance, then fall back to
  // the 52-week low.
  const breakout = findRecentBreakout(candles, opts.swingLookback ?? 50, 120, minBars);
  if (breakout >= 0) return { index: breakout, label: "breakout" };

  return { index: index52wLow(candles), label: "52w-low" };
}
