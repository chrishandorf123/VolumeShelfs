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
 * Exponential moving average. Seeds from the SMA of the first `period` *finite*
 * values, so it also works on a series with leading NaNs (e.g. a MACD line whose
 * early bars are undefined) — the EMA simply starts at the first bar where
 * enough finite data exists.
 */
export function emaSeries(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (period < 1) return out;
  const k = 2 / (period + 1);
  let ema = NaN;
  let seed = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (!Number.isFinite(ema)) {
      seed += v;
      count += 1;
      if (count === period) {
        ema = seed / period;
        out[i] = ema;
      }
    } else {
      ema = v * k + ema * (1 - k);
      out[i] = ema;
    }
  }
  return out;
}

export interface MacdSeries {
  macd: number[];
  signal: number[];
  hist: number[];
}

/** MACD (fast/slow EMA difference) with its signal line and histogram. */
export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): MacdSeries {
  const ef = emaSeries(values, fast);
  const es = emaSeries(values, slow);
  const line = values.map((_, i) =>
    Number.isFinite(ef[i]) && Number.isFinite(es[i]) ? ef[i] - es[i] : NaN,
  );
  const signal = emaSeries(line, signalPeriod);
  const hist = line.map((m, i) =>
    Number.isFinite(m) && Number.isFinite(signal[i]) ? m - signal[i] : NaN,
  );
  return { macd: line, signal, hist };
}

/** Wilder RSI series; entries before `period` bars of change are NaN. */
export function rsiSeries(values: number[], period = 14): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  if (n <= period || period < 1) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = values[i] - values[i - 1];
    if (ch >= 0) avgGain += ch;
    else avgLoss -= ch;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < n; i++) {
    const ch = values[i] - values[i - 1];
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/** Latest RSI value, or NaN. */
export function rsiLast(values: number[], period = 14): number {
  const s = rsiSeries(values, period);
  return s[s.length - 1] ?? NaN;
}

/**
 * Where the latest close sits within its `period`-bar high/low range (Wujastyk's
 * "% range"): 0 = at the range low, 1 = at the range high. Near the low is the
 * mean-reversion zone; near the high is extended.
 */
export function percentRange(candles: Candle[], period = 14): number {
  const n = candles.length;
  if (n === 0) return NaN;
  const start = Math.max(0, n - period);
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = start; i < n; i++) {
    if (candles[i].high > hi) hi = candles[i].high;
    if (candles[i].low < lo) lo = candles[i].low;
  }
  const span = hi - lo;
  return span > 0 ? (candles[n - 1].close - lo) / span : 0.5;
}

/**
 * Whether the latest bar is a bullish reversal candle — a hammer / pin bar (long
 * lower wick, small body near the top, closes up) or a bullish engulfing (a down
 * bar followed by an up bar that engulfs its body). The price-action trigger
 * Wujastyk waits for at a shelf before acting.
 */
export function bullishReversalBar(candles: Candle[]): boolean {
  const n = candles.length;
  if (n < 2) return false;
  const c = candles[n - 1];
  const p = candles[n - 2];
  const range = c.high - c.low;
  if (range <= 0) return false;
  const body = Math.abs(c.close - c.open);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const upperWick = c.high - Math.max(c.open, c.close);
  const hammer =
    lowerWick >= 2 * body &&
    lowerWick >= 0.5 * range &&
    upperWick <= 0.15 * range &&
    body <= 0.4 * range &&
    c.close >= c.open;
  const engulfing =
    p.close < p.open && c.close > c.open && c.close >= p.open && c.open <= p.close;
  return hammer || engulfing;
}

/**
 * Aggregate daily candles into weekly candles (Monday-anchored), for a
 * higher-timeframe bias read. Volume is summed; OHLC is open-first / high-max /
 * low-min / close-last within each week.
 */
export function resampleWeekly(candles: Candle[]): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let key = "";
  for (const c of candles) {
    const d = new Date(c.time * 1000);
    const dow = d.getUTCDay();
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - ((dow + 6) % 7));
    const wk = monday.toISOString().slice(0, 10);
    if (wk !== key) {
      if (cur) out.push(cur);
      cur = { ...c };
      key = wk;
    } else if (cur) {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume += c.volume;
    }
  }
  if (cur) out.push(cur);
  return out;
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
