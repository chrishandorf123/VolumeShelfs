import type { Candle } from "./types";

/** Simple moving average series; entries before `period` bars are NaN. */
export function smaSeries(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (period < 1) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Latest SMA value, or NaN if there is not enough data. */
export function smaLast(values: number[], period: number): number {
  if (values.length < period || period < 1) return NaN;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

/** True range for bar `i` (uses previous close when available). */
function trueRange(candles: Candle[], i: number): number {
  const c = candles[i];
  if (i === 0) return c.high - c.low;
  const prevClose = candles[i - 1].close;
  return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
}

/** Wilder-smoothed Average True Range series. */
export function atrSeries(candles: Candle[], period = 14): number[] {
  const out = new Array<number>(candles.length).fill(NaN);
  if (candles.length === 0 || period < 1) return out;
  let prev = NaN;
  let seed = 0;
  for (let i = 0; i < candles.length; i++) {
    const tr = trueRange(candles, i);
    if (i < period) {
      seed += tr;
      if (i === period - 1) {
        prev = seed / period;
        out[i] = prev;
      }
    } else {
      prev = (prev * (period - 1) + tr) / period;
      out[i] = prev;
    }
  }
  return out;
}

/** Latest ATR value. */
export function atrLast(candles: Candle[], period = 14): number {
  const s = atrSeries(candles, period);
  return s[s.length - 1] ?? NaN;
}

/** Fractional return of `close` over `lookback` bars (e.g. 0.12 = +12%). */
export function returnOver(candles: Candle[], lookback: number): number {
  const n = candles.length;
  if (n <= lookback || lookback < 1) return NaN;
  const start = candles[n - 1 - lookback].close;
  const end = candles[n - 1].close;
  if (!(start > 0)) return NaN;
  return (end - start) / start;
}

/**
 * Anchored VWAP series: cumulative (typical-price × volume) / cumulative volume
 * starting at `anchorIndex`. Bars before the anchor are NaN. Typical price is
 * HLC3. When volume is missing/zero the series falls back to a simple average
 * of typical prices so it still produces a usable line.
 */
export function anchoredVwapSeries(candles: Candle[], anchorIndex: number): number[] {
  const out = new Array<number>(candles.length).fill(NaN);
  const a = Math.min(Math.max(anchorIndex, 0), Math.max(candles.length - 1, 0));
  let pv = 0;
  let vol = 0;
  let tpSum = 0;
  let count = 0;
  for (let i = a; i < candles.length; i++) {
    const c = candles[i];
    const tp = (c.high + c.low + c.close) / 3;
    pv += tp * c.volume;
    vol += c.volume;
    tpSum += tp;
    count += 1;
    out[i] = vol > 0 ? pv / vol : tpSum / count;
  }
  return out;
}

/** Latest anchored VWAP value for the given anchor. */
export function anchoredVwapLast(candles: Candle[], anchorIndex: number): number {
  const s = anchoredVwapSeries(candles, anchorIndex);
  return s[s.length - 1] ?? NaN;
}

/** Average daily dollar volume (close × volume) over the last `period` bars. */
export function avgDollarVolume(candles: Candle[], period = 20): number {
  const n = candles.length;
  if (n === 0) return NaN;
  const start = Math.max(0, n - period);
  let sum = 0;
  let count = 0;
  for (let i = start; i < n; i++) {
    sum += candles[i].close * candles[i].volume;
    count += 1;
  }
  return count > 0 ? sum / count : NaN;
}

/**
 * Slope classification of a series tail: compares the latest value to the value
 * `lookback` bars ago. "rising" / "falling" beyond `tolPct`, else "flat".
 */
export function slopeOf(
  series: number[],
  lookback: number,
  tolPct = 0.01,
): "rising" | "flat" | "falling" | "unknown" {
  const n = series.length;
  if (n <= lookback) return "unknown";
  const now = series[n - 1];
  const then = series[n - 1 - lookback];
  if (!Number.isFinite(now) || !Number.isFinite(then) || then === 0) return "unknown";
  const change = (now - then) / Math.abs(then);
  if (change > tolPct) return "rising";
  if (change < -tolPct) return "falling";
  return "flat";
}
