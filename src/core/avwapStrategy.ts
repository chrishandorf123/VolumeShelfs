import type { Candle } from "./types";
import { anchoredVwapSeries, slopeOf } from "./indicators";

/**
 * Brian Shannon's Anchored-VWAP strategy layer (from "Maximum Trading Gains
 * with the Anchored VWAP"). The AVWAP is the volume-weighted average price paid
 * since a significant anchor — i.e. the break-even cost basis of everyone who
 * positioned since then. The edge comes from how price behaves relative to it:
 *
 *   - price above a *rising* AVWAP  -> buyers in control (bullish, "innocent
 *     until proven guilty")
 *   - price below a *falling* AVWAP -> sellers in control (bearish)
 *   - a *reclaim* (close back above) or *loss* (close back below) of a key
 *     AVWAP is the trigger
 *   - broken AVWAP support becomes resistance and vice-versa
 */

export type Trend = "rising" | "flat" | "falling" | "unknown";

export interface AvwapState {
  value: number;
  slope: Trend;
  priceAbove: boolean;
  /** % distance of price from the AVWAP (positive = above). */
  distancePct: number;
  /**
   * Shannon's bullish regime: price above a rising AVWAP. Bearish regime: price
   * below a falling AVWAP. Otherwise mixed/indecisive.
   */
  regime: "bullish" | "bearish" | "mixed";
}

/** Evaluate price relative to one anchored VWAP. */
export function avwapState(candles: Candle[], anchorIndex: number, slopeLookback = 10): AvwapState {
  const series = anchoredVwapSeries(candles, anchorIndex);
  const value = series[series.length - 1] ?? NaN;
  const price = candles.length ? candles[candles.length - 1].close : NaN;
  const slope = slopeOf(series, slopeLookback, 0.003);
  const priceAbove = price >= value;
  const distancePct = value > 0 ? (price - value) / value : NaN;
  let regime: AvwapState["regime"] = "mixed";
  if (priceAbove && slope === "rising") regime = "bullish";
  else if (!priceAbove && slope === "falling") regime = "bearish";
  return { value, slope, priceAbove, distancePct, regime };
}

export type AvwapEvent = "reclaim" | "loss" | "holding-above" | "holding-below";

export interface AvwapCross {
  event: AvwapEvent;
  /** Bars since the most recent cross (Infinity if no cross in the window). */
  barsAgo: number;
  side: "above" | "below";
}

/**
 * Detect a recent AVWAP reclaim or loss. A *reclaim* is a close that crosses
 * from below to above the AVWAP within the last `withinBars` bars (a long
 * trigger); a *loss* is the opposite. If no cross occurred recently the price
 * is simply holding above/below.
 */
export function avwapCross(
  candles: Candle[],
  anchorIndex: number,
  withinBars = 5,
): AvwapCross {
  const series = anchoredVwapSeries(candles, anchorIndex);
  const n = candles.length;
  if (n === 0) return { event: "holding-below", barsAgo: Infinity, side: "below" };
  const sideAt = (i: number) => (candles[i].close >= series[i] ? 1 : -1);
  const nowSide = sideAt(n - 1);
  let crossBarsAgo = Infinity;
  for (let i = n - 1; i >= Math.max(1, n - withinBars); i--) {
    if (!Number.isFinite(series[i]) || !Number.isFinite(series[i - 1])) break;
    if (sideAt(i) !== sideAt(i - 1)) {
      crossBarsAgo = n - 1 - (i - 1);
      break;
    }
  }
  const side = nowSide > 0 ? "above" : "below";
  let event: AvwapEvent;
  if (Number.isFinite(crossBarsAgo)) event = nowSide > 0 ? "reclaim" : "loss";
  else event = nowSide > 0 ? "holding-above" : "holding-below";
  return { event, barsAgo: crossBarsAgo, side };
}

export interface AvwapBands {
  vwap: number[];
  upper: number[];
  lower: number[];
}

/**
 * Anchored VWAP standard-deviation bands. Shannon uses them to gauge extension
 * and to project targets: cumulative volume-weighted variance of typical price
 * around the running AVWAP, band = AVWAP ± k·σ.
 */
export function anchoredVwapBands(candles: Candle[], anchorIndex: number, k = 1): AvwapBands {
  const n = candles.length;
  const vwap = new Array<number>(n).fill(NaN);
  const upper = new Array<number>(n).fill(NaN);
  const lower = new Array<number>(n).fill(NaN);
  const a = Math.min(Math.max(anchorIndex, 0), Math.max(n - 1, 0));
  let pv = 0;
  let v = 0;
  let pv2 = 0;
  let tpSum = 0;
  let tp2Sum = 0;
  let count = 0;
  for (let i = a; i < n; i++) {
    const c = candles[i];
    const tp = (c.high + c.low + c.close) / 3;
    pv += tp * c.volume;
    v += c.volume;
    pv2 += tp * tp * c.volume;
    tpSum += tp;
    tp2Sum += tp * tp;
    count += 1;
    const mean = v > 0 ? pv / v : tpSum / count;
    const meanSq = v > 0 ? pv2 / v : tp2Sum / count;
    const variance = Math.max(0, meanSq - mean * mean);
    const sigma = Math.sqrt(variance);
    vwap[i] = mean;
    upper[i] = mean + k * sigma;
    lower[i] = mean - k * sigma;
  }
  return { vwap, upper, lower };
}

/** Index of the single highest-volume bar within the last `window` bars. */
export function indexHighVolumeDay(candles: Candle[], window = 252): number {
  const n = candles.length;
  const start = Math.max(0, n - window);
  let idx = start;
  for (let i = start; i < n; i++) if (candles[i].volume > candles[idx].volume) idx = i;
  return idx;
}
