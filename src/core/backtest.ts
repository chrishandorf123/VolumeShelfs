import type { Candle } from "./types";
import { atrSeries, macd, rsiSeries, slopeOf, smaSeries, bullishReversalBar } from "./indicators";
import { computeAnchoredProfile } from "./volumeProfile";
import { detectGaps, detectHvnShelves, nearestShelves } from "./shelves";

/**
 * Research backtest of one hypothesis (long, v1): when a liquid name holds a
 * volume shelf in a 200-day uptrend but trades BELOW its operative anchored-VWAP
 * "break-even", price tends to revert UP toward break-even, and the strength of
 * that reversion scales with how many standard deviations below break-even it
 * sits. Everything here is strictly point-in-time (bar t uses only data <= t) and
 * reuses the app's indicator functions so the live decision engine cannot drift
 * from the study. This is a research tool, not a live trader — it is built to be
 * able to DISCONFIRM the hypothesis.
 */
export type Bucket = "A" | "B" | "C" | "D";
export type TrendRegime = "up" | "flat" | "down";
export type VolRegime = "low" | "normal" | "high";

export interface BacktestConfig {
  /** Rolling lookback for the deviation std that defines the z-score. */
  zLookback: number;
  /** Volume-by-price bins across the anchored range. */
  binCount: number;
  /** Structural stop = min(POC, entry) − k·ATR. */
  stopAtrK: number;
  /** Exit if neither target nor stop hit within this many bars. */
  timeStopBars: number;
  /** Per-side cost (basis points) applied to entry and each exit. */
  costBps: number;
  /** Forward-return horizons to record for the reversion curve. */
  horizons: number[];
  /** HVN shelf strength (× mean row volume) for shelf/target detection. */
  shelfK: number;
}

export const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
  zLookback: 100,
  binCount: 50,
  stopAtrK: 1.0,
  timeStopBars: 20,
  costBps: 1,
  horizons: [5, 10, 20, 40],
  shelfK: 1.5,
};

export interface Gates {
  rvol: boolean; // entry-bar volume ≥ 1.5× 20-day average
  rsi: boolean; // RSI turning up through ~50
  macd: boolean; // MACD histogram turning up
  reversal: boolean; // bullish reversal candle at the shelf
  climax: boolean; // volume in the top decile of the trailing 50 bars
}

export interface Trade {
  entryIndex: number;
  entryTime: number;
  entryPrice: number;
  /** Signed break-even z-score at the signal bar (negative = below break-even). */
  z: number;
  bucket: Bucket;
  trend: TrendRegime;
  vol: VolRegime;
  gates: Gates;
  breakeven: number; // operative anchored VWAP = target 1
  targetShelf: number | null; // travel-lane target = target 2
  stop: number;
  perShareRisk: number;
  hitT1: boolean;
  barsToT1: number | null;
  hitT2: boolean;
  hitStop: boolean;
  /** Whipsaw: hit the stop but T1 would have been reached inside the window. */
  whipsaw: boolean;
  exitIndex: number;
  exitPrice: number;
  /** Realized reward ÷ initial risk, net of costs. */
  rMultiple: number;
  /** Max adverse / favorable excursion as a positive fraction of entry. */
  maePct: number;
  mfePct: number;
  /** Net forward return at each configured horizon. */
  fwdReturn: Record<number, number>;
}

export interface BacktestResult {
  trades: Trade[];
  /** Bars that were valid candidates (setup active) even if pre-sim. */
  signalCount: number;
  /** % of usable bars that were candidates (mis-scale warning if <1% or >20%). */
  candidateFraction: number;
  usableBars: number;
  /** The last-bar live state, for the decision engine (may be null). */
  live: LiveState | null;
  notes: string[];
}

/** The setup/level state at a single bar — shared by the backtest and decide(). */
export interface LiveState {
  index: number;
  close: number;
  setupActive: boolean;
  z: number;
  bucket: Bucket | null;
  trend: TrendRegime;
  vol: VolRegime;
  gates: Gates;
  breakeven: number | null; // operative AVWAP (T1)
  shelf: number | null; // nearest HVN below (support / POC-ish)
  targetShelf: number | null; // T2
  stop: number | null;
  entry: number; // next-bar reference (last close as proxy live)
  perShareRisk: number | null;
  /** Reasons the setup is inactive, for an honest STAND-ASIDE explanation. */
  reasons: string[];
}

function hlc3(c: Candle): number {
  return (c.high + c.low + c.close) / 3;
}

export function bucketOf(z: number): Bucket {
  const a = Math.abs(z);
  if (a <= 1) return "A";
  if (a <= 2) return "B";
  if (a <= 3) return "C";
  return "D";
}

/** Rolling argmax of `sel` over [0..t] (all-time to date). */
function runningExtremeIndex(candles: Candle[], sel: (c: Candle) => number, max: boolean): number[] {
  const out = new Array<number>(candles.length);
  let best = 0;
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) best = 0;
    else if (max ? sel(candles[i]) > sel(candles[best]) : sel(candles[i]) < sel(candles[best])) best = i;
    out[i] = best;
  }
  return out;
}

/** Argmax/argmin of `sel` within a trailing `window` ending at each bar. */
function windowedExtremeIndex(candles: Candle[], sel: (c: Candle) => number, window: number, max: boolean): number[] {
  const out = new Array<number>(candles.length);
  for (let i = 0; i < candles.length; i++) {
    const lo = Math.max(0, i - window + 1);
    let best = lo;
    for (let j = lo; j <= i; j++) {
      if (max ? sel(candles[j]) > sel(candles[best]) : sel(candles[j]) < sel(candles[best])) best = j;
    }
    out[i] = best;
  }
  return out;
}

/** First bar index of each bar's calendar year (year-open anchor). */
function yearOpenIndex(candles: Candle[]): number[] {
  const out = new Array<number>(candles.length);
  const firstOfYear = new Map<number, number>();
  for (let i = 0; i < candles.length; i++) {
    const y = new Date(candles[i].time * 1000).getUTCFullYear();
    if (!firstOfYear.has(y)) firstOfYear.set(y, i);
    out[i] = firstOfYear.get(y)!;
  }
  return out;
}

const BARS_52W = 252;

/**
 * Run the backtest over one symbol's candles. Returns every simulated trade plus
 * the live last-bar state for the decision engine.
 */
export function runBacktest(candles: Candle[], config: BacktestConfig = DEFAULT_BACKTEST_CONFIG): BacktestResult {
  const n = candles.length;
  const notes: string[] = [];
  if (n < 260) {
    return { trades: [], signalCount: 0, candidateFraction: 0, usableBars: 0, live: null, notes: ["Not enough history (need ≥ ~260 daily bars)."] };
  }

  const closes = candles.map((c) => c.close);
  // Prefix sums of typical-price·volume and volume for O(1) anchored VWAP.
  const Pp = new Array<number>(n + 1).fill(0);
  const Vp = new Array<number>(n + 1).fill(0);
  for (let i = 0; i < n; i++) {
    Pp[i + 1] = Pp[i] + hlc3(candles[i]) * candles[i].volume;
    Vp[i + 1] = Vp[i] + candles[i].volume;
  }
  const avwap = (a: number, t: number): number => {
    const dv = Vp[t + 1] - Vp[a];
    return dv > 0 ? (Pp[t + 1] - Pp[a]) / dv : hlc3(candles[t]);
  };

  // Rolling anchors (computed only from data ≤ t).
  const ath = runningExtremeIndex(candles, (c) => c.high, true);
  const atl = runningExtremeIndex(candles, (c) => c.low, false);
  const w52hi = windowedExtremeIndex(candles, (c) => c.high, BARS_52W, true);
  const w52lo = windowedExtremeIndex(candles, (c) => c.low, BARS_52W, false);
  const yopen = yearOpenIndex(candles);

  // Context indicators (all point-in-time).
  const sma200 = smaSeries(closes, 200);
  const sma5 = smaSeries(closes, 5);
  const atr = atrSeries(candles, 14);
  const rsi = rsiSeries(closes, 14);
  const mac = macd(closes);

  // Operative AVWAP (nearest anchored VWAP ABOVE close) + deviation, per bar.
  const opAnchor = new Array<number>(n).fill(-1);
  const opVwap = new Array<number>(n).fill(NaN);
  const dev = new Array<number>(n).fill(NaN);
  for (let t = 0; t < n; t++) {
    const cands = new Set<number>([ath[t], atl[t], w52hi[t], w52lo[t], yopen[t]]);
    let bestIdx = -1;
    let bestVal = Infinity;
    for (const a of cands) {
      if (a > t) continue;
      const v = avwap(a, t);
      if (v > candles[t].close && v < bestVal) {
        bestVal = v;
        bestIdx = a;
      }
    }
    opAnchor[t] = bestIdx;
    if (bestIdx >= 0) {
      opVwap[t] = bestVal;
      dev[t] = (candles[t].close - bestVal) / bestVal; // negative below break-even
    }
  }

  // Rolling std of the deviation → z-score.
  const z = new Array<number>(n).fill(NaN);
  for (let t = config.zLookback; t < n; t++) {
    let sum = 0;
    let cnt = 0;
    for (let i = t - config.zLookback + 1; i <= t; i++) {
      if (Number.isFinite(dev[i])) {
        sum += dev[i];
        cnt += 1;
      }
    }
    if (cnt < config.zLookback * 0.5) continue;
    const mean = sum / cnt;
    let v = 0;
    for (let i = t - config.zLookback + 1; i <= t; i++) if (Number.isFinite(dev[i])) v += (dev[i] - mean) ** 2;
    const sd = Math.sqrt(v / cnt);
    if (sd > 0 && Number.isFinite(dev[t])) z[t] = dev[t] / sd;
  }

  // 20-day realized-vol terciles as the (own-proxy) vol regime. NOTE: the brief
  // wants VIX; that isn't available client-side per single symbol, so we proxy
  // with the symbol's own realized vol and flag it.
  notes.push("Vol regime uses the symbol's own 20-day realized-vol terciles as a VIX proxy (no VIX client-side).");
  const rvol20 = new Array<number>(n).fill(NaN);
  for (let t = 20; t < n; t++) {
    let s = 0;
    let s2 = 0;
    for (let i = t - 19; i <= t; i++) {
      const r = Math.log(closes[i] / closes[i - 1]);
      s += r;
      s2 += r * r;
    }
    const m = s / 20;
    rvol20[t] = Math.sqrt(Math.max(0, s2 / 20 - m * m));
  }
  const trendOf = (t: number): TrendRegime => {
    const sl = slopeOf(sma200.slice(0, t + 1), 20, 0.005);
    return sl === "rising" ? "up" : sl === "falling" ? "down" : "flat";
  };
  const volOf = (t: number): VolRegime => {
    // Terciles vs the trailing distribution (≤ t) to stay point-in-time.
    const hist: number[] = [];
    for (let i = Math.max(20, t - BARS_52W); i <= t; i++) if (Number.isFinite(rvol20[i])) hist.push(rvol20[i]);
    if (hist.length < 20 || !Number.isFinite(rvol20[t])) return "normal";
    hist.sort((a, b) => a - b);
    const lo = hist[Math.floor(hist.length / 3)];
    const hi = hist[Math.floor((2 * hist.length) / 3)];
    return rvol20[t] <= lo ? "low" : rvol20[t] >= hi ? "high" : "normal";
  };

  const gatesAt = (t: number): Gates => {
    const avg20 = avgVol(candles, t, 20);
    const climaxThresh = decileTopVol(candles, t, 50);
    return {
      rvol: Number.isFinite(avg20) && candles[t].volume >= 1.5 * avg20,
      rsi: Number.isFinite(rsi[t]) && Number.isFinite(rsi[t - 1]) && rsi[t] > 45 && rsi[t] > rsi[t - 1],
      macd: Number.isFinite(mac.hist[t]) && Number.isFinite(mac.hist[t - 1]) && Number.isFinite(mac.hist[t - 2]) && mac.hist[t] > mac.hist[t - 1] && mac.hist[t - 1] <= mac.hist[t - 2],
      reversal: bullishReversalBar(candles.slice(0, t + 1)),
      climax: Number.isFinite(climaxThresh) && candles[t].volume >= climaxThresh,
    };
  };

  // Detect the setup at a bar and, if active, its levels (needs the profile).
  const evalBar = (t: number): { active: boolean; reasons: string[]; poc: number; shelf: number | null; target: number | null } => {
    const reasons: string[] = [];
    if (!Number.isFinite(z[t])) reasons.push("insufficient history for z-score");
    if (opAnchor[t] < 0) reasons.push("no break-even (no anchored VWAP above price)");
    if (!(candles[t].close > sma200[t])) reasons.push("below the 200-day (trend not up)");
    if (!(slopeOf(sma5.slice(0, t + 1), 3, 0) === "rising")) reasons.push("5-day average not rising");
    if (Number.isFinite(z[t]) && !(z[t] < 0)) reasons.push("not below break-even");
    // Cheap conditions failed → not a candidate (skip the expensive profile).
    if (reasons.length) return { active: false, reasons, poc: NaN, shelf: null, target: null };
    // Expensive: anchored profile from the operative anchor to t.
    const profile = computeAnchoredProfile(candles, opAnchor[t], { rowCount: config.binCount, scale: "log", valueAreaFraction: 0.7 }, t);
    const poc = profile.poc.mid;
    if (!(candles[t].close > poc)) return { active: false, reasons: ["below the volume shelf (POC)"], poc, shelf: null, target: null };
    const shelves = detectHvnShelves(profile, candles[t].close, config.shelfK, 2);
    const near = nearestShelves(shelves, candles[t].close);
    const gaps = detectGaps(profile, { shelfThreshold: 0.55, gapThreshold: 0.15 });
    // Travel-lane target: the nearest HVN above the nearest LVN above price.
    const lvnAbove = gaps.filter((g) => g.priceLow >= candles[t].close).sort((a, b) => a.priceLow - b.priceLow)[0] ?? null;
    let target: number | null = null;
    if (lvnAbove) {
      const above = shelves.filter((s) => s.priceLow >= lvnAbove.priceHigh).sort((a, b) => a.priceLow - b.priceLow)[0] ?? null;
      target = above ? (above.priceLow + above.priceHigh) / 2 : null;
    }
    const shelf = near.below ? (near.below.priceLow + near.below.priceHigh) / 2 : poc;
    return { active: true, reasons: [], poc, shelf, target };
  };

  // ---- walk the bars, collect signals ------------------------------------
  const trades: Trade[] = [];
  let signalCount = 0;
  let usableBars = 0;
  const firstUsable = Math.max(200, config.zLookback + 1);
  for (let t = firstUsable; t < n - 1; t++) {
    usableBars += 1;
    const ev = evalBar(t);
    if (!ev.active) continue;
    signalCount += 1;
    // Entry at next bar open; stop below the shelf; T1 = break-even; T2 = target.
    const entryIndex = t + 1;
    const entry = candles[entryIndex].open;
    const stop = Math.min(ev.poc, entry) - config.stopAtrK * (atr[t] || 0);
    const perShareRisk = entry - stop;
    if (!(perShareRisk > 0)) continue;
    const t1 = opVwap[t];
    const t2 = ev.target;
    const sim = simulate(candles, entryIndex, entry, t1, t2, stop, config);
    trades.push({
      entryIndex,
      entryTime: candles[entryIndex].time,
      entryPrice: entry,
      z: z[t],
      bucket: bucketOf(z[t]),
      trend: trendOf(t),
      vol: volOf(t),
      gates: gatesAt(t),
      breakeven: t1,
      targetShelf: t2,
      stop,
      perShareRisk,
      ...sim,
    });
  }

  const candidateFraction = usableBars > 0 ? signalCount / usableBars : 0;
  if (usableBars > 0 && (candidateFraction < 0.01 || candidateFraction > 0.2)) {
    notes.push(`Candidate fraction ${(candidateFraction * 100).toFixed(1)}% is outside 1–20% — the filter may be mis-scaled.`);
  }

  // ---- live state at the last bar (for decide) ---------------------------
  const lt = n - 1;
  const ev = evalBar(lt);
  const live: LiveState = {
    index: lt,
    close: candles[lt].close,
    setupActive: ev.active,
    z: Number.isFinite(z[lt]) ? z[lt] : NaN,
    bucket: Number.isFinite(z[lt]) ? bucketOf(z[lt]) : null,
    trend: trendOf(lt),
    vol: volOf(lt),
    gates: gatesAt(lt),
    breakeven: opAnchor[lt] >= 0 ? opVwap[lt] : null,
    shelf: ev.shelf,
    targetShelf: ev.target,
    stop: ev.active ? Math.min(ev.poc, candles[lt].close) - config.stopAtrK * (atr[lt] || 0) : null,
    entry: candles[lt].close,
    perShareRisk: null,
    reasons: ev.reasons,
  };
  if (live.stop !== null) live.perShareRisk = live.entry - live.stop;

  return { trades, signalCount, candidateFraction, usableBars, live, notes };
}

interface SimOut {
  hitT1: boolean;
  barsToT1: number | null;
  hitT2: boolean;
  hitStop: boolean;
  whipsaw: boolean;
  exitIndex: number;
  exitPrice: number;
  rMultiple: number;
  maePct: number;
  mfePct: number;
  fwdReturn: Record<number, number>;
}

/** Simulate one trade forward with strict next-bar execution. */
function simulate(candles: Candle[], entryIndex: number, entry: number, t1: number, t2: number | null, stop: number, config: BacktestConfig): SimOut {
  const n = candles.length;
  const cost = config.costBps / 10000;
  const risk = entry - stop;
  let hitT1 = false;
  let barsToT1: number | null = null;
  let hitT2 = false;
  let hitStop = false;
  let stopBar: number | null = null;
  let mae = 0;
  let mfe = 0;
  let exitIndex = Math.min(entryIndex + config.timeStopBars, n - 1);
  let exitPrice = candles[exitIndex].close;
  for (let k = 0; k <= config.timeStopBars && entryIndex + k < n; k++) {
    const bar = candles[entryIndex + k];
    mae = Math.max(mae, (entry - bar.low) / entry);
    mfe = Math.max(mfe, (bar.high - entry) / entry);
    // Stop is checked first (conservative — assume the adverse level trades).
    if (!hitStop && bar.low <= stop) {
      hitStop = true;
      stopBar = k;
      exitIndex = entryIndex + k;
      exitPrice = stop;
      break;
    }
    if (!hitT1 && bar.high >= t1) {
      hitT1 = true;
      barsToT1 = k;
      exitIndex = entryIndex + k;
      exitPrice = t1;
      if (t2 !== null && bar.high >= t2) hitT2 = true;
      break;
    }
  }
  // Whipsaw: stopped, but T1 would have printed within the remaining window.
  let whipsaw = false;
  if (hitStop && stopBar !== null) {
    for (let k = stopBar + 1; k <= config.timeStopBars && entryIndex + k < n; k++) {
      if (candles[entryIndex + k].high >= t1) {
        whipsaw = true;
        break;
      }
    }
  }
  const rMultiple = risk > 0 ? (exitPrice * (1 - cost) - entry * (1 + cost)) / risk : 0;
  const fwdReturn: Record<number, number> = {};
  for (const h of config.horizons) {
    const idx = Math.min(entryIndex + h, n - 1);
    fwdReturn[h] = candles[idx].close / entry - 1;
  }
  return { hitT1, barsToT1, hitT2, hitStop, whipsaw, exitIndex, exitPrice, rMultiple, maePct: mae, mfePct: mfe, fwdReturn };
}

function avgVol(candles: Candle[], t: number, n: number): number {
  const lo = Math.max(0, t - n);
  let s = 0;
  let c = 0;
  for (let i = lo; i < t; i++) {
    s += candles[i].volume;
    c += 1;
  }
  return c > 0 ? s / c : NaN;
}

/** Volume threshold that puts a bar in the top decile of the trailing `n`. */
function decileTopVol(candles: Candle[], t: number, n: number): number {
  const lo = Math.max(0, t - n + 1);
  const v: number[] = [];
  for (let i = lo; i <= t; i++) v.push(candles[i].volume);
  if (v.length < 10) return NaN;
  v.sort((a, b) => a - b);
  return v[Math.floor(v.length * 0.9)];
}
