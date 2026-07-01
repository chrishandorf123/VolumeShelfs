import type { Candle } from "../core/types";
import { normalizeCandles } from "./types";

/** Deterministic PRNG (shared style with sample.ts). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Phase {
  bars: number;
  drift: number;
  vol: number;
  volume: number;
}

/** Build a daily OHLCV series from a sequence of phases. */
export function buildPhasedSeries(seed: number, startPrice: number, phases: Phase[]): Candle[] {
  const rnd = mulberry32(seed);
  const candles: Candle[] = [];
  let price = startPrice;
  let time = Date.UTC(2022, 0, 3) / 1000;
  const DAY = 86400;
  for (const phase of phases) {
    for (let i = 0; i < phase.bars; i++) {
      const shock = (rnd() - 0.5) * 2 * phase.vol;
      const open = price;
      price = Math.max(0.5, price * (1 + phase.drift + shock));
      const close = price;
      const wick = phase.vol * 0.6 * price;
      const high = Math.max(open, close) + rnd() * wick;
      const low = Math.min(open, close) - rnd() * wick;
      const volume = Math.round(phase.volume * (0.6 + rnd() * 0.8));
      candles.push({ time, open, high, low, close, volume });
      time += DAY;
      if (new Date(time * 1000).getUTCDay() === 6) time += 2 * DAY;
    }
  }
  return normalizeCandles(candles);
}

/**
 * A leader archetype: prior up-leg from a base, a heavy consolidation shelf,
 * then a shallow low-volume pullback into the shelf (the Wujastyk setup).
 */
function leader(seed: number, start: number, strength: number): Candle[] {
  return buildPhasedSeries(seed, start, [
    { bars: 40, drift: -0.004, vol: 0.02, volume: 2_000_000 }, // decline into base
    { bars: 50, drift: 0.001, vol: 0.018, volume: 3_000_000 }, // base
    { bars: 60, drift: 0.014 * strength, vol: 0.02, volume: 2_400_000 }, // run-up (gap)
    { bars: 70, drift: 0.0006, vol: 0.013, volume: 6_500_000 }, // heavy shelf
    { bars: 18, drift: -0.0012, vol: 0.01, volume: 2_000_000 }, // quiet pullback into shelf
  ]);
}

const ARCHETYPES: Array<{ ticker: string; build: () => Candle[] }> = [
  { ticker: "AVPX", build: () => leader(11, 14, 1.0) },
  { ticker: "SHLF", build: () => leader(23, 22, 1.15) },
  { ticker: "PNCH", build: () => leader(47, 38, 0.9) },
  { ticker: "RSLD", build: () => leader(71, 9, 1.05) },
  { ticker: "BASE", build: () => leader(98, 55, 0.8) },
  // Extended: ran up hard, no shelf near price (price far above support).
  { ticker: "XTND", build: () => buildPhasedSeries(5, 18, [
      { bars: 60, drift: 0.001, vol: 0.02, volume: 4_000_000 },
      { bars: 120, drift: 0.012, vol: 0.025, volume: 3_000_000 },
      { bars: 40, drift: 0.006, vol: 0.03, volume: 2_500_000 },
    ]) },
  { ticker: "MOON", build: () => buildPhasedSeries(8, 30, [
      { bars: 80, drift: 0.0, vol: 0.02, volume: 3_000_000 },
      { bars: 140, drift: 0.014, vol: 0.03, volume: 2_800_000 },
    ]) },
  // Laggards / downtrends: below 200MA, weak RS.
  { ticker: "DOWN", build: () => buildPhasedSeries(14, 80, [
      { bars: 120, drift: -0.004, vol: 0.025, volume: 3_000_000 },
      { bars: 100, drift: -0.002, vol: 0.02, volume: 2_000_000 },
    ]) },
  { ticker: "FADE", build: () => buildPhasedSeries(27, 60, [
      { bars: 100, drift: 0.002, vol: 0.02, volume: 2_500_000 },
      { bars: 120, drift: -0.006, vol: 0.03, volume: 2_800_000 },
    ]) },
  { ticker: "SLMP", build: () => buildPhasedSeries(31, 45, [
      { bars: 220, drift: -0.003, vol: 0.022, volume: 1_500_000 },
    ]) },
  // Choppy / rangebound: no clean trend.
  { ticker: "CHOP", build: () => buildPhasedSeries(44, 25, [
      { bars: 220, drift: 0.0, vol: 0.03, volume: 2_000_000 },
    ]) },
  { ticker: "RNGE", build: () => buildPhasedSeries(52, 12, [
      { bars: 110, drift: 0.004, vol: 0.025, volume: 2_200_000 },
      { bars: 110, drift: -0.004, vol: 0.025, volume: 2_000_000 },
    ]) },
  // Thin / illiquid: fails the liquidity gate.
  { ticker: "THIN", build: () => buildPhasedSeries(63, 7, [
      { bars: 120, drift: 0.002, vol: 0.04, volume: 120_000 },
      { bars: 100, drift: 0.001, vol: 0.05, volume: 90_000 },
    ]) },
  { ticker: "PNNY", build: () => buildPhasedSeries(77, 3, [
      { bars: 220, drift: 0.001, vol: 0.05, volume: 400_000 },
    ]) },
  // Steady compounders with a recent base.
  { ticker: "GRND", build: () => leader(120, 28, 0.7) },
  { ticker: "TREN", build: () => leader(133, 48, 0.95) },
  // PRIME: a clean BUY-THE-DIP — strong uptrend, heavy overhead POC, then a
  // shallow pullback to a tight fat shelf that still sits above a rising AVWAP,
  // with room up to the POC/value-area (good reward-to-risk).
  { ticker: "PRIME", build: () => buildPhasedSeries(202, 18, [
      { bars: 60, drift: 0.0, vol: 0.015, volume: 2_500_000 }, // base at the low (anchor)
      { bars: 80, drift: 0.0112, vol: 0.018, volume: 1_600_000 }, // thin run-up (gap zone)
      { bars: 60, drift: 0.0004, vol: 0.012, volume: 6_500_000 }, // heavy shelf ~44 (target)
      { bars: 20, drift: -0.009, vol: 0.014, volume: 2_800_000 }, // fast pullback through the gap
      { bars: 32, drift: 0.0004, vol: 0.007, volume: 5_500_000 }, // tight fat support shelf at price
    ]) },
  // ASST-style pullback-from-a-high into a fat volume shelf (the reference
  // "ideal" anchor case): pivot high, decline, rally, then a heavy base the
  // price has fallen into. Anchored from the high, the shelf sits at price.
  { ticker: "ASST", build: () => buildPhasedSeries(314, 16, [
      { bars: 20, drift: 0.018, vol: 0.02, volume: 2_500_000 }, // run to the ~24 pivot high
      { bars: 35, drift: -0.02, vol: 0.025, volume: 3_000_000 }, // decline off the high
      { bars: 20, drift: -0.02, vol: 0.03, volume: 3_500_000 }, // spike to the ~7 low
      { bars: 60, drift: 0.016, vol: 0.022, volume: 2_500_000 }, // rally to ~19
      { bars: 35, drift: -0.013, vol: 0.018, volume: 5_500_000 }, // heavy pullback
      { bars: 70, drift: -0.001, vol: 0.02, volume: 6_000_000 }, // heavy base / shelf ~11-13
    ]) },
];

export interface UniverseTicker {
  ticker: string;
  candles: Candle[];
}

/** The bundled offline universe of synthetic tickers. */
export function buildDemoUniverse(): UniverseTicker[] {
  return ARCHETYPES.map((a) => ({ ticker: a.ticker, candles: a.build() }));
}

/**
 * Benchmark proxy (an "SPY"-like index): a gentle uptrend that chops sideways
 * over the recent window, so genuine leaders show positive relative strength.
 */
export function buildDemoBenchmark(): Candle[] {
  return buildPhasedSeries(999, 400, [
    { bars: 150, drift: 0.0015, vol: 0.009, volume: 80_000_000 },
    { bars: 92, drift: 0.0002, vol: 0.008, volume: 80_000_000 },
  ]);
}
