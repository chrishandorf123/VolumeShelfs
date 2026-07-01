import type { Candle } from "./types";
import { smaSeries, slopeOf } from "./indicators";
import type { BacktestConfig, Bucket, Trade, TrendRegime } from "./backtest";

/** Wilson score interval for a binomial proportion (never report p without this). */
export function wilson(k: number, n: number, zCrit = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n;
  const z2 = zCrit * zCrit;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (zCrit * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[i];
}

export interface Cell {
  key: string;
  bucket: Bucket | "ALL";
  regime: string; // "ALL" or "trend:up" etc.
  n: number;
  hitRateT1: number;
  ciT1: [number, number];
  hitRateT2: number;
  avgR: number;
  expectancy: number; // = avgR (per unit risk), kept explicit
  maeP50: number;
  maeP75: number;
  maeP90: number;
  whipsawRate: number;
  medianBarsToT1: number | null;
  avgFwd: Record<number, number>;
  /** Unconditional control: P(a random long makes the same move in this tape). */
  baseRate: number;
  /** True when T1's CI lower bound clears the base rate (a measured edge). */
  edgeOverBase: boolean;
}

const BUCKETS: Bucket[] = ["A", "B", "C", "D"];

function summarize(bucket: Bucket | "ALL", regime: string, trades: Trade[], baseRate: number, horizons: number[]): Cell {
  const n = trades.length;
  const k1 = trades.filter((t) => t.hitT1).length;
  const k2 = trades.filter((t) => t.hitT2).length;
  const hitRateT1 = n ? k1 / n : 0;
  const ciT1 = wilson(k1, n);
  const avgR = n ? trades.reduce((s, t) => s + t.rMultiple, 0) / n : 0;
  const maes = trades.map((t) => t.maePct).sort((a, b) => a - b);
  const barsToT1 = trades.filter((t) => t.barsToT1 !== null).map((t) => t.barsToT1 as number).sort((a, b) => a - b);
  const avgFwd: Record<number, number> = {};
  for (const h of horizons) avgFwd[h] = n ? trades.reduce((s, t) => s + (t.fwdReturn[h] ?? 0), 0) / n : 0;
  return {
    key: `${bucket}|${regime}`,
    bucket,
    regime,
    n,
    hitRateT1,
    ciT1,
    hitRateT2: n ? k2 / n : 0,
    avgR,
    expectancy: avgR,
    maeP50: quantile(maes, 0.5),
    maeP75: quantile(maes, 0.75),
    maeP90: quantile(maes, 0.9),
    whipsawRate: n ? trades.filter((t) => t.whipsaw).length / n : 0,
    medianBarsToT1: barsToT1.length ? quantile(barsToT1, 0.5) : null,
    avgFwd,
    baseRate,
    edgeOverBase: n > 0 && ciT1[0] > baseRate,
  };
}

/** Per-bar trend regime (recomputed point-in-time for the base-rate control). */
function trendSeries(candles: Candle[]): TrendRegime[] {
  const closes = candles.map((c) => c.close);
  const sma200 = smaSeries(closes, 200);
  return candles.map((_, t) => {
    const sl = slopeOf(sma200.slice(0, t + 1), 20, 0.005);
    return sl === "rising" ? "up" : sl === "falling" ? "down" : "flat";
  });
}

/**
 * Unconditional base rate: over all usable bars (optionally in one trend regime),
 * the fraction whose forward `timeStopBars`-bar high reaches close·(1+movePct) —
 * i.e. how often a random long gets the same move without the setup.
 */
function baseRateForMove(candles: Candle[], config: BacktestConfig, movePct: number, trend: TrendRegime[], regime: TrendRegime | null): number {
  if (!(movePct > 0)) return 0;
  let hits = 0;
  let total = 0;
  const n = candles.length;
  for (let t = 200; t < n - 1; t++) {
    if (regime && trend[t] !== regime) continue;
    total += 1;
    const target = candles[t].close * (1 + movePct);
    for (let k = 1; k <= config.timeStopBars && t + k < n; k++) {
      if (candles[t + k].high >= target) {
        hits += 1;
        break;
      }
    }
  }
  return total ? hits / total : 0;
}

function medianMove(trades: Trade[]): number {
  const moves = trades.map((t) => t.breakeven / t.entryPrice - 1).filter((m) => m > 0).sort((a, b) => a - b);
  return moves.length ? quantile(moves, 0.5) : 0;
}

export interface Tables {
  byBucket: Cell[]; // A,B,C,D,ALL
  byBucketRegime: Cell[]; // bucket × trend regime
  baseRateAll: number;
}

/** Build the headline bucket table + the regime split, with base-rate controls. */
export function buildTables(trades: Trade[], candles: Candle[], config: BacktestConfig): Tables {
  const trend = trendSeries(candles);
  const overallMove = medianMove(trades);
  const baseRateAll = baseRateForMove(candles, config, overallMove, trend, null);

  const byBucket: Cell[] = [];
  for (const b of BUCKETS) {
    const tr = trades.filter((t) => t.bucket === b);
    const base = baseRateForMove(candles, config, medianMove(tr) || overallMove, trend, null);
    byBucket.push(summarize(b, "ALL", tr, base, config.horizons));
  }
  byBucket.push(summarize("ALL", "ALL", trades, baseRateAll, config.horizons));

  const byBucketRegime: Cell[] = [];
  for (const b of BUCKETS) {
    for (const rg of ["up", "flat", "down"] as TrendRegime[]) {
      const tr = trades.filter((t) => t.bucket === b && t.trend === rg);
      const base = baseRateForMove(candles, config, medianMove(tr) || overallMove, trend, rg);
      byBucketRegime.push(summarize(b, `trend:${rg}`, tr, base, config.horizons));
    }
  }
  return { byBucket, byBucketRegime, baseRateAll };
}

export interface GateAblationRow {
  gate: string;
  bucket: Bucket;
  n: number;
  hitRateT1: number;
  ciT1: [number, number];
  avgR: number;
}

const GATE_KEYS = ["rvol", "rsi", "macd", "reversal", "climax"] as const;

/** Marginal effect of each confirmation gate, per bucket (additive, not baked in). */
export function gateAblation(trades: Trade[]): GateAblationRow[] {
  const rows: GateAblationRow[] = [];
  for (const g of GATE_KEYS) {
    for (const b of BUCKETS) {
      const tr = trades.filter((t) => t.bucket === b && t.gates[g]);
      const k = tr.filter((t) => t.hitT1).length;
      rows.push({
        gate: g,
        bucket: b,
        n: tr.length,
        hitRateT1: tr.length ? k / tr.length : 0,
        ciT1: wilson(k, tr.length),
        avgR: tr.length ? tr.reduce((s, t) => s + t.rMultiple, 0) / tr.length : 0,
      });
    }
  }
  return rows;
}
