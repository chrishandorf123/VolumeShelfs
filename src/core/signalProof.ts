import type { Candle } from "./types";
import { earlySignal } from "./earlySignal";

/**
 * Signal proof: does the Early Signal actually precede moves ON THIS SYMBOL?
 * Point-in-time replay — for each sampled historical bar t, compute the score
 * using ONLY data ≤ t (no lookahead), then compare forward returns of
 * signal bars vs all bars. Honest per-symbol validation, not a promise:
 * small n means "not enough history to judge", and it says so.
 */
export interface SignalProof {
  /** Sampled bars with a forward window available. */
  n: number;
  /** Of those, bars where the early score was ≥ minScore. */
  nSignal: number;
  medianFwdSignal: number;
  medianFwdBase: number;
  /** Fraction reaching +5% within the window. */
  hitRateSignal: number;
  hitRateBase: number;
  fwdBars: number;
  minScore: number;
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function proveEarlySignal(
  candles: Candle[],
  fwdBars = 20,
  minScore = 70,
  stride = 2,
): SignalProof | null {
  const n = candles.length;
  if (n < 140) return null; // need warmup + forward windows to say anything
  const fwdAll: number[] = [];
  const fwdSig: number[] = [];
  let hitsAll = 0;
  let hitsSig = 0;

  for (let t = 70; t + fwdBars < n; t += stride) {
    const sig = earlySignal(candles.slice(0, t + 1)); // strictly point-in-time
    if (!sig) continue;
    const fwd = candles[t].close > 0 ? candles[t + fwdBars].close / candles[t].close - 1 : NaN;
    if (!Number.isFinite(fwd)) continue;
    // "Hit" = printed +5% at any point inside the window, not just at the end.
    let hit = false;
    for (let k = 1; k <= fwdBars; k++) {
      if (candles[t + k].high >= candles[t].close * 1.05) {
        hit = true;
        break;
      }
    }
    fwdAll.push(fwd);
    if (hit) hitsAll += 1;
    if (sig.score >= minScore) {
      fwdSig.push(fwd);
      if (hit) hitsSig += 1;
    }
  }

  if (fwdAll.length === 0) return null;
  return {
    n: fwdAll.length,
    nSignal: fwdSig.length,
    medianFwdSignal: median(fwdSig),
    medianFwdBase: median(fwdAll),
    hitRateSignal: fwdSig.length ? hitsSig / fwdSig.length : NaN,
    hitRateBase: hitsAll / fwdAll.length,
    fwdBars,
    minScore,
  };
}
