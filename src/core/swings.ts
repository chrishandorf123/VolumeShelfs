import type { Candle } from "./types";

export interface SwingPoint {
  index: number;
  price: number;
  kind: "low" | "high";
}

/**
 * Detect fractal swing pivots: a swing low is a candle whose low is the lowest
 * within `lookback` bars on each side; a swing high is the symmetric case.
 *
 * These are the points the system recommends anchoring a volume profile from —
 * a swing low to read support/break-even-demand, a swing high to read overhead
 * supply.
 */
export function detectSwings(candles: Candle[], lookback = 5): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isLow = true;
    let isHigh = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].low <= candles[i].low) isLow = false;
      if (candles[j].high >= candles[i].high) isHigh = false;
    }
    if (isLow) swings.push({ index: i, price: candles[i].low, kind: "low" });
    if (isHigh) swings.push({ index: i, price: candles[i].high, kind: "high" });
  }
  return swings;
}

/**
 * Pick a sensible default anchor: the most significant (lowest-priced) swing
 * low that still leaves at least `minBars` of price action, so the profile
 * spans a meaningful base-to-now range rather than a cramped recent window.
 * This mirrors the system's advice to anchor from a major swing low with plenty
 * of candles. Falls back to a point ~40% back through the series.
 */
export function defaultAnchorIndex(candles: Candle[], lookback = 5, minBars = 20): number {
  if (candles.length <= minBars) return 0;
  const lastAllowed = candles.length - minBars;
  const swings = detectSwings(candles, lookback).filter(
    (s) => s.kind === "low" && s.index <= lastAllowed,
  );
  if (swings.length > 0) {
    let best = swings[0];
    for (const s of swings) if (s.price < best.price) best = s;
    return best.index;
  }
  return Math.floor(candles.length * 0.4);
}
