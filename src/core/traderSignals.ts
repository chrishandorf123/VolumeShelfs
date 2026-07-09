/**
 * Signals behind the Playbooks tab — small, honest implementations of the
 * public methods of well-known traders (sources in docs/RESEARCH.md):
 *
 * - OBV read (IncomeSharks): "price is noise, OBV is truth" — divergences
 *   between cumulative volume flow and price, and OBV breaking out first.
 * - SuperTrend (their confirmation tool, used doubled with two settings).
 * - ATH proximity (Howard Lindzon's "8s to 80s": strength near all-time highs).
 */
import type { Candle } from "./types";
import { atrSeries, obvSeries } from "./indicators";

// ---- OBV read ---------------------------------------------------------------
export type ObvState =
  | "accumulation" // OBV rising while price flat/down — quiet buying (bullish divergence)
  | "confirmed" // OBV and price rising together — trend is real
  | "divergence" // price rising while OBV flat/down — rally without volume (de-risk tell)
  | "distribution" // both falling — money leaving
  | "neutral";

export interface ObvRead {
  state: ObvState;
  /** OBV made a new `window`-bar high while price hasn't — OBV leads price. */
  obvLeadsPrice: boolean;
  /** Normalized direction of OBV / price over the window (−1..1-ish). */
  obvDir: number;
  priceDir: number;
  headline: string;
}

/** Direction of a series over `k` bars, normalized by its window range. */
function dirOf(xs: number[], k: number): number {
  const n = xs.length;
  if (n < k + 1) return 0;
  const win = xs.slice(n - k - 1);
  const hi = Math.max(...win);
  const lo = Math.min(...win);
  const span = hi - lo;
  return span > 0 ? (xs[n - 1] - xs[n - 1 - k]) / span : 0;
}

export function obvRead(candles: Candle[], k = 20, window = 60): ObvRead | null {
  if (candles.length < window + 5) return null;
  const obv = obvSeries(candles);
  const closes = candles.map((c) => c.close);
  const obvDir = dirOf(obv, k);
  const priceDir = dirOf(closes, k);
  const n = candles.length;
  const obvHigh = Math.max(...obv.slice(n - window));
  const priceHigh = Math.max(...closes.slice(n - window));
  const obvLeadsPrice = obv[n - 1] >= obvHigh && closes[n - 1] < priceHigh * 0.99;

  const UP = 0.18;
  const DOWN = -0.18;
  let state: ObvState = "neutral";
  if (obvDir > UP && priceDir <= UP) state = "accumulation";
  else if (obvDir > UP && priceDir > UP) state = "confirmed";
  else if (priceDir > UP && obvDir <= 0) state = "divergence";
  else if (obvDir < DOWN && priceDir < DOWN) state = "distribution";

  const headline =
    state === "accumulation"
      ? "OBV is climbing while price sits still — someone is quietly buying (bullish divergence)."
      : state === "confirmed"
        ? "OBV confirms the price trend — volume is behind the move."
        : state === "divergence"
          ? "Price is rising but OBV isn't following — the rally lacks volume; a de-risk tell."
          : state === "distribution"
            ? "OBV and price falling together — money is leaving."
            : "OBV is trendless here — no volume-flow signal either way.";
  return { state, obvLeadsPrice, obvDir, priceDir, headline };
}

// ---- SuperTrend ---------------------------------------------------------------
export interface SupertrendSeries {
  /** +1 = uptrend, −1 = downtrend (NaN-warmup bars are 0). */
  dirs: number[];
  /** The active band price per bar — the lower band in an uptrend (a trailing
   *  stop under price), the upper band in a downtrend (NaN during warmup). */
  trail: number[];
}

/**
 * Classic SuperTrend: ±mult·ATR bands around HL2 with the standard ratchet;
 * +1 = uptrend (price above the lower band), −1 = downtrend.
 */
export function supertrendSeries(candles: Candle[], period = 10, mult = 3): SupertrendSeries {
  const n = candles.length;
  const atr = atrSeries(candles, period);
  const dirs = new Array<number>(n).fill(0);
  const trail = new Array<number>(n).fill(NaN);
  let up = NaN; // final lower band (support in uptrend)
  let dn = NaN; // final upper band (resistance in downtrend)
  let dir = 1;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(atr[i])) continue;
    const hl2 = (candles[i].high + candles[i].low) / 2;
    const bUp = hl2 - mult * atr[i];
    const bDn = hl2 + mult * atr[i];
    const prevClose = i > 0 ? candles[i - 1].close : candles[i].close;
    // Standard ratchet: the lower band may only rise while price holds above it.
    if (!Number.isFinite(up)) up = bUp;
    else up = prevClose > up ? Math.max(bUp, up) : bUp;
    if (!Number.isFinite(dn)) dn = bDn;
    else dn = prevClose < dn ? Math.min(bDn, dn) : bDn;
    const close = candles[i].close;
    if (dir === 1 && close < up) dir = -1;
    else if (dir === -1 && close > dn) dir = 1;
    dirs[i] = dir;
    trail[i] = dir === 1 ? up : dn;
  }
  return { dirs, trail };
}

/** Per-bar SuperTrend direction series (see supertrendSeries). */
export function supertrendDirs(candles: Candle[], period = 10, mult = 3): number[] {
  return supertrendSeries(candles, period, mult).dirs;
}

/** IncomeSharks-style DOUBLE SuperTrend: both a tight and a loose setting must
 * agree up for a confirmed uptrend (fewer whipsaws than either alone). */
export function doubleSupertrendUp(candles: Candle[]): boolean | null {
  if (candles.length < 30) return null;
  const a = supertrendDirs(candles, 10, 1.5);
  const b = supertrendDirs(candles, 11, 2.5);
  return a[a.length - 1] === 1 && b[b.length - 1] === 1;
}

// ---- ATH proximity (Lindzon momentum) ------------------------------------------
export interface AthRead {
  /** Fraction below the all-time (loaded-history) high: 0 = at the high. */
  pctFromAth: number;
  nearAth: boolean; // within 5%
  headline: string;
}

export function athRead(candles: Candle[]): AthRead | null {
  if (candles.length < 30) return null;
  let ath = -Infinity;
  for (const c of candles) if (c.high > ath) ath = c.high;
  const close = candles[candles.length - 1].close;
  if (!(ath > 0)) return null;
  const pctFromAth = Math.max(0, (ath - close) / ath);
  const nearAth = pctFromAth <= 0.05;
  return {
    pctFromAth,
    nearAth,
    headline: nearAth
      ? `Within ${(pctFromAth * 100).toFixed(1)}% of its all-time high — no overhead supply above.`
      : `${(pctFromAth * 100).toFixed(0)}% below its high — overhead supply to chew through.`,
  };
}
