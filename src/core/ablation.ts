/**
 * Walk-forward (purged/embargoed) ablation harness for footprint features.
 *
 * The one question it answers, per feature: does CONDITIONING the probability
 * estimate on the feature improve OUT-OF-SAMPLE expectancy vs the baseline
 * conditioning (z-bucket only)? Identical trades, identical costs — only the
 * conditioning variables differ between variants.
 *
 * Method: trades (pooled across symbols) are sorted by entry time and split
 * into K chronological folds. For each fold, cells are fit on the OTHER folds
 * with an EMBARGO — any train trade whose entry falls within `embargoDays` of
 * the test fold's time range is dropped, so overlapping evaluation windows
 * can't leak. A test trade is "taken" when its train cell has n ≥ minSampleN
 * and a conservative expectancy floor (avgR − 1.96·SE) > 0. Metrics are pooled
 * over all held-out folds. Costs can be stressed by recomputing R from the
 * stored entry/exit prices at multiplied bps — no re-simulation needed.
 */
import type { Trade } from "./backtest";
import { FEATURE_CONDITIONS, wilson } from "./probabilityTable";

export interface AblationConfig {
  /** Chronological folds (default 5). */
  folds: number;
  /** Min train-cell sample to allow acting on it (default 20). */
  minSampleN: number;
  /** Embargo, in DAYS of entry time, around each test fold (default 25 —
   * the 20-bar time stop plus buffer, so no train window overlaps test). */
  embargoDays: number;
  /** Base per-side cost in bps the trades were simulated with (default 1). */
  costBps: number;
}

export const DEFAULT_ABLATION_CONFIG: AblationConfig = {
  folds: 5,
  minSampleN: 20,
  embargoDays: 25,
  costBps: 1,
};

export type VariantName = "baseline" | "absorption" | "avwapEvent" | "both";
export const VARIANTS: VariantName[] = ["baseline", "absorption", "avwapEvent", "both"];

/** Recompute a trade's net R at an arbitrary per-side cost (bps). */
export function rAtCost(t: Trade, costBps: number): number {
  const c = costBps / 10000;
  return t.perShareRisk > 0 ? (t.exitPrice * (1 - c) - t.entryPrice * (1 + c)) / t.perShareRisk : 0;
}

const absOn = FEATURE_CONDITIONS.absorption;
const avOn = FEATURE_CONDITIONS.avwapEvent;

/** Conditioning key for a trade under a variant — the ONLY thing that differs. */
export function cellKeyOf(t: Trade, variant: VariantName): string {
  switch (variant) {
    case "baseline":
      return t.bucket;
    case "absorption":
      return `${t.bucket}|abs:${absOn(t) ? 1 : 0}`;
    case "avwapEvent":
      return `${t.bucket}|av:${avOn(t) ? 1 : 0}`;
    case "both":
      return `${t.bucket}|abs:${absOn(t) ? 1 : 0}|av:${avOn(t) ? 1 : 0}`;
  }
}

export interface VariantMetrics {
  variant: VariantName;
  /** OOS trades offered / taken under the train-fitted rule. */
  offered: number;
  taken: number;
  expectancyR: number;
  hitRate: number;
  avgWinR: number;
  avgLossR: number;
  profitFactor: number;
  maxDrawdownR: number;
  /** Conditional separation on ALL OOS trades: P(hit | feature on) vs base. */
  pFeatureOn: number;
  ciFeatureOn: [number, number];
  nFeatureOn: number;
  pAll: number;
  nAll: number;
}

interface CellStat {
  n: number;
  avgR: number;
  seR: number;
}

function fitCells(train: Trade[], variant: VariantName, costBps: number): Map<string, CellStat> {
  const groups = new Map<string, number[]>();
  for (const t of train) {
    const key = cellKeyOf(t, variant);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(rAtCost(t, costBps));
  }
  const cells = new Map<string, CellStat>();
  for (const [key, rs] of groups) {
    const n = rs.length;
    const avg = rs.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(rs.reduce((a, b) => a + (b - avg) ** 2, 0) / Math.max(1, n - 1));
    cells.set(key, { n, avgR: avg, seR: n > 0 ? sd / Math.sqrt(n) : Infinity });
  }
  return cells;
}

/** The promotion rule the harness applies to a train cell (documented in
 * ABLATION.md): act only when n ≥ minSampleN AND avgR − 1.96·SE > 0. */
function cellActs(cell: CellStat | undefined, minN: number): boolean {
  return !!cell && cell.n >= minN && cell.avgR - 1.96 * cell.seR > 0;
}

function metricsFor(variant: VariantName, taken: Trade[], all: Trade[], offered: number, costBps: number): VariantMetrics {
  const rs = taken
    .slice()
    .sort((a, b) => a.entryTime - b.entryTime)
    .map((t) => rAtCost(t, costBps));
  const n = rs.length;
  const expectancy = n ? rs.reduce((a, b) => a + b, 0) / n : 0;
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r <= 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  let cum = 0;
  let peak = 0;
  let dd = 0;
  for (const r of rs) {
    cum += r;
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
  }
  // Separation is a property of the FEATURE on the full OOS set, so the same
  // numbers appear for a variant regardless of how many trades it took.
  const cond = variant === "absorption" ? absOn : variant === "avwapEvent" ? avOn : variant === "both" ? (t: Trade) => absOn(t) || avOn(t) : null;
  const on = cond ? all.filter(cond) : all;
  const kOn = on.filter((t) => t.hitT1).length;
  const kAll = all.filter((t) => t.hitT1).length;
  return {
    variant,
    offered,
    taken: n,
    expectancyR: expectancy,
    hitRate: n ? taken.filter((t) => t.hitT1).length / n : 0,
    avgWinR: wins.length ? grossWin / wins.length : 0,
    avgLossR: losses.length ? -grossLoss / losses.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : wins.length ? Infinity : 0,
    maxDrawdownR: dd,
    pFeatureOn: on.length ? kOn / on.length : 0,
    ciFeatureOn: wilson(kOn, on.length),
    nFeatureOn: on.length,
    pAll: all.length ? kAll / all.length : 0,
    nAll: all.length,
  };
}

/**
 * Run the four-variant walk-forward ablation. `costBps` defaults to the
 * config's base cost; pass a multiple for the slippage stress.
 */
export function runAblation(
  trades: Trade[],
  config: AblationConfig = DEFAULT_ABLATION_CONFIG,
  costBps: number = config.costBps,
): VariantMetrics[] {
  const sorted = trades.slice().sort((a, b) => a.entryTime - b.entryTime);
  const n = sorted.length;
  if (n === 0) return VARIANTS.map((v) => metricsFor(v, [], [], 0, costBps));
  const embargoSec = config.embargoDays * 86400;
  const foldSize = Math.ceil(n / config.folds);

  const takenBy = new Map<VariantName, Trade[]>(VARIANTS.map((v) => [v, []]));
  let offered = 0;
  for (let f = 0; f < config.folds; f++) {
    const test = sorted.slice(f * foldSize, (f + 1) * foldSize);
    if (!test.length) continue;
    const t0 = test[0].entryTime - embargoSec;
    const t1 = test[test.length - 1].entryTime + embargoSec;
    // Purge + embargo: train excludes anything inside the test window ± embargo.
    const train = sorted.filter((t) => t.entryTime < t0 || t.entryTime > t1);
    offered += test.length;
    for (const variant of VARIANTS) {
      const cells = fitCells(train, variant, costBps);
      const take = takenBy.get(variant)!;
      for (const t of test) {
        if (cellActs(cells.get(cellKeyOf(t, variant)), config.minSampleN)) take.push(t);
      }
    }
  }
  return VARIANTS.map((v) => metricsFor(v, takenBy.get(v)!, sorted, offered, costBps));
}
