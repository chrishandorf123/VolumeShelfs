/**
 * Retracement vs Reversal — is this dip a buyable pullback inside the uptrend,
 * or the start of a trend change? Implements the classic Investopedia
 * framework (docs/RESEARCH.md → "Retracement vs reversal"):
 *
 *   RETRACEMENT: low-volume profit taking · trend structure intact (higher
 *   lows) · holds a Fibonacci zone (38.2–61.8% of the impulse) · short-lived.
 *   REVERSAL: high-volume selling · structure breaks (lower highs, prior
 *   swing low lost) · blows through 61.8–78.6% · sustained.
 *
 * This is a read on the CURRENT pullback from the most recent impulse leg —
 * a companion to the buy-the-dip verdict, not a replacement for it.
 */
import type { Candle } from "./types";
import { anchoredVwapLast, smaSeries } from "./indicators";

export type RetraceVerdict = "no-pullback" | "retracement" | "warning" | "reversal-risk";

export interface FibLevels {
  /** Impulse extremes the fib grid is drawn on. */
  low: number;
  high: number;
  /** Price at each classic retracement (from the high, toward the low). */
  fib382: number;
  fib500: number;
  fib618: number;
  fib786: number;
}

export interface RetracementRead {
  verdict: RetraceVerdict;
  /** 0..1+ fraction of the impulse retraced (0 = at the high). */
  depth: number;
  /** Which fib zone the pullback sits in, for display. */
  zone: "at-highs" | "shallow" | "healthy" | "deep" | "danger" | "beyond";
  fib: FibLevels;
  /** Pullback volume ÷ impulse volume — < 1 = quiet dip (bullish tell). */
  volumeRatio: number;
  /** Bars spent pulling back vs bars the impulse took. */
  pullbackBars: number;
  impulseBars: number;
  /** Structure flags. */
  lowerHighs: boolean;
  brokePriorLow: boolean;
  belowImpulseAvwap: boolean;
  /** Below this price the retracement thesis is dead (78.6% line). */
  invalidation: number;
  /** Plain-English reasons, strongest first. */
  reasons: string[];
  headline: string;
}

const MIN_IMPULSE_PCT = 0.06; // an impulse smaller than this isn't worth grading
const LOOKBACK = 140; // bars scanned for the impulse leg

/** Index of the max high in [from, to]. */
function argmaxHigh(c: Candle[], from: number, to: number): number {
  let best = from;
  for (let i = from; i <= to; i++) if (c[i].high > c[best].high) best = i;
  return best;
}
/** Index of the min low in [from, to]. */
function argminLow(c: Candle[], from: number, to: number): number {
  let best = from;
  for (let i = from; i <= to; i++) if (c[i].low < c[best].low) best = i;
  return best;
}

/**
 * Grade the current pullback. Returns null when there's no readable impulse
 * (too little history, or the last leg is too small to grade honestly).
 */
export function analyzeRetracement(candles: Candle[]): RetracementRead | null {
  const n = candles.length;
  if (n < 40) return null;
  const start = Math.max(0, n - LOOKBACK);

  // The impulse: most recent meaningful swing-low → swing-high leg.
  const hiIdx = argmaxHigh(candles, start, n - 1);
  if (hiIdx === start) return null; // high sits at the window edge — no leg before it
  const loIdx = argminLow(candles, start, hiIdx);
  if (loIdx >= hiIdx) return null;
  const high = candles[hiIdx].high;
  const low = candles[loIdx].low;
  const span = high - low;
  if (!(span > 0) || span / low < MIN_IMPULSE_PCT) return null;

  const close = candles[n - 1].close;
  const depth = (high - close) / span; // 0 at the high, 1 back at the low
  const fib: FibLevels = {
    low,
    high,
    fib382: high - span * 0.382,
    fib500: high - span * 0.5,
    fib618: high - span * 0.618,
    fib786: high - span * 0.786,
  };

  // Volume character: down-bar volume during the pullback vs the impulse's
  // average volume. Low-volume dips are profit taking; heavy ones are exits.
  const avgVol = (from: number, to: number, downOnly = false): number => {
    let s = 0;
    let k = 0;
    for (let i = Math.max(1, from); i <= to; i++) {
      if (downOnly && candles[i].close >= candles[i - 1].close) continue;
      s += candles[i].volume;
      k++;
    }
    return k ? s / k : NaN;
  };
  const impulseVol = avgVol(loIdx, hiIdx);
  const pullVol = hiIdx < n - 1 ? avgVol(hiIdx + 1, n - 1, true) : NaN;
  const volumeRatio = Number.isFinite(impulseVol) && Number.isFinite(pullVol) && impulseVol > 0 ? pullVol / impulseVol : NaN;

  // Structure since the high: lower highs forming? prior swing low broken?
  let lowerHighs = false;
  if (n - 1 - hiIdx >= 6) {
    const mid = hiIdx + Math.floor((n - 1 - hiIdx) / 2);
    const h1 = argmaxHigh(candles, hiIdx + 1, mid);
    const h2 = argmaxHigh(candles, mid + 1, n - 1);
    lowerHighs = candles[h2].high < candles[h1].high && candles[h1].high < high;
  }
  // The last swing low before the final push to the high — losing it breaks
  // the "higher lows" definition of an uptrend.
  const priorLowIdx = hiIdx - loIdx >= 8 ? argminLow(candles, Math.floor((loIdx + hiIdx) / 2), hiIdx) : loIdx;
  const brokePriorLow = close < candles[priorLowIdx].low;
  const belowImpulseAvwap = close < anchoredVwapLast(candles, loIdx);
  const sma50 = smaSeries(candles.map((c) => c.close), 50);
  const below50 = Number.isFinite(sma50[n - 1]) && close < sma50[n - 1];

  const pullbackBars = n - 1 - hiIdx;
  const impulseBars = hiIdx - loIdx;
  const slowGrind = impulseBars > 0 && pullbackBars > impulseBars * 0.75;

  // ---- classify -------------------------------------------------------------
  const zone: RetracementRead["zone"] =
    depth <= 0.05 ? "at-highs"
    : depth < 0.382 ? "shallow"
    : depth <= 0.5 ? "healthy"
    : depth <= 0.618 ? "deep"
    : depth <= 0.786 ? "danger"
    : "beyond";

  const reasons: string[] = [];
  let score = 0; // positive = retracement, negative = reversal
  if (zone === "shallow" || zone === "healthy") {
    score += 2;
    reasons.push(`Pullback is holding the ${zone === "shallow" ? "shallow (<38.2%)" : "38.2–50%"} fib zone — normal profit-taking territory.`);
  } else if (zone === "deep") {
    score += 0.5;
    reasons.push("Pullback reached the 50–61.8% zone — the last fib line where a retracement usually holds.");
  } else if (zone === "danger") {
    score -= 1.5;
    reasons.push("Beyond 61.8% retraced — textbook retracements rarely go this deep; treat as a warning.");
  } else if (zone === "beyond") {
    score -= 3;
    reasons.push("More than 78.6% of the impulse is gone — statistically this behaves like a reversal, not a dip.");
  }
  if (Number.isFinite(volumeRatio)) {
    if (volumeRatio < 0.85) {
      score += 1.5;
      reasons.push(`Selling volume is quiet (${(volumeRatio * 100).toFixed(0)}% of impulse volume) — profit taking, not distribution.`);
    } else if (volumeRatio > 1.2) {
      score -= 2;
      reasons.push(`Selling volume is HEAVY (${(volumeRatio * 100).toFixed(0)}% of impulse volume) — reversals come with authority.`);
    }
  }
  if (lowerHighs) {
    score -= 1.5;
    reasons.push("Lower highs are forming since the peak — the counter-move is building structure, a reversal trait.");
  }
  if (brokePriorLow) {
    score -= 2;
    reasons.push("The prior swing low broke — 'higher lows' is gone, so the uptrend definition is violated.");
  }
  if (belowImpulseAvwap) {
    score -= 1;
    reasons.push("Price lost the AVWAP of the whole impulse — the average buyer of this leg is now underwater.");
  } else if (zone !== "at-highs") {
    score += 0.5;
    reasons.push("Still above the impulse AVWAP — the leg's average buyer is defending.");
  }
  if (below50 && zone !== "at-highs") {
    score -= 0.5;
    reasons.push("Below the 50-day line while pulling back.");
  }
  if (slowGrind) {
    score -= 1;
    reasons.push(`The pullback has lasted ${pullbackBars} bars vs a ${impulseBars}-bar impulse — retracements are short-lived; this one is overstaying.`);
  }

  let verdict: RetraceVerdict;
  if (zone === "at-highs") verdict = "no-pullback";
  else if (score >= 1.5) verdict = "retracement";
  else if (score > -1.5) verdict = "warning";
  else verdict = "reversal-risk";

  const headline =
    verdict === "no-pullback"
      ? "At/near the impulse high — nothing to grade yet. Levels below are where a future dip should hold."
      : verdict === "retracement"
        ? `Reads as a RETRACEMENT — a buyable dip while ${fmt(fib.fib618)} holds.`
        : verdict === "warning"
          ? `Mixed tape — could resolve either way. Below ${fmt(fib.fib786)} the dip thesis dies.`
          : `Reads as REVERSAL RISK — this is behaving like a trend change, not a dip. Invalidation ${fmt(fib.fib786)} is ${close < fib.fib786 ? "already gone" : "close"}.`;

  return {
    verdict,
    depth,
    zone,
    fib,
    volumeRatio,
    pullbackBars,
    impulseBars,
    lowerHighs,
    brokePriorLow,
    belowImpulseAvwap,
    invalidation: fib.fib786,
    reasons,
    headline,
  };
}

function fmt(v: number): string {
  return `$${v >= 100 ? v.toFixed(0) : v.toFixed(2)}`;
}
