import type { Candle } from "../core/types";
import { DataError, normalizeCandles, type DataProvider, type DataRequest } from "./types";

/** Tiny deterministic PRNG so demo data is identical on every load. */
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

interface Phase {
  /** Number of bars in the phase. */
  bars: number;
  /** Price drift per bar (fraction). */
  drift: number;
  /** Per-bar volatility (fraction). */
  vol: number;
  /** Baseline volume for the phase. */
  volume: number;
}

/**
 * Build a daily OHLCV series by walking through a sequence of market phases.
 * Designed to produce a clean teaching scenario: a heavy accumulation shelf, a
 * thin run-up (volume gap), a heavy distribution shelf, then a pullback that
 * leaves price between the two shelves.
 */
function buildSeries(seed: number, startPrice: number, phases: Phase[]): Candle[] {
  const rnd = mulberry32(seed);
  const candles: Candle[] = [];
  let price = startPrice;
  // Start ~3 years back on a fixed date so demo data never depends on "now".
  let time = Date.UTC(2021, 0, 4) / 1000;
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
      // Skip weekends to look like a real daily chart.
      const dow = new Date(time * 1000).getUTCDay();
      if (dow === 6) time += 2 * DAY;
    }
  }
  return normalizeCandles(candles);
}

export interface SampleDataset {
  symbol: string;
  label: string;
  candles: Candle[];
}

export const SAMPLE_DATASETS: SampleDataset[] = [
  {
    symbol: "DEMO-SHELF",
    label: "DEMO-SHELF — accumulation, gap, distribution",
    candles: buildSeries(1337, 11, [
      { bars: 90, drift: 0.0008, vol: 0.018, volume: 12_000_000 }, // accumulation shelf ~11-13
      { bars: 30, drift: 0.026, vol: 0.025, volume: 2_000_000 }, // thin run-up (volume gap)
      { bars: 80, drift: 0.0003, vol: 0.02, volume: 11_000_000 }, // distribution shelf ~25-27
      { bars: 40, drift: -0.008, vol: 0.022, volume: 3_000_000 }, // pullback into the gap (~19)
    ]),
  },
  {
    symbol: "DEMO-TREND",
    label: "DEMO-TREND — steady uptrend with a base",
    candles: buildSeries(7, 25, [
      { bars: 60, drift: 0.0002, vol: 0.02, volume: 5_000_000 }, // base shelf
      { bars: 120, drift: 0.004, vol: 0.022, volume: 4_000_000 }, // grind up
      { bars: 30, drift: -0.003, vol: 0.025, volume: 4_500_000 }, // shallow pullback
    ]),
  },
];

/** Offline provider serving the bundled demo datasets. */
export const sampleProvider: DataProvider = {
  id: "sample",
  label: "Demo data (offline)",
  requiresApiKey: false,
  note: "Synthetic datasets bundled with the app. No network required.",

  async fetchCandles(req: DataRequest): Promise<Candle[]> {
    const wanted = req.symbol.trim().toUpperCase();
    const match =
      SAMPLE_DATASETS.find((d) => d.symbol === wanted) ?? SAMPLE_DATASETS[0];
    if (!match) throw new DataError("No demo dataset available");
    return match.candles;
  },
};
