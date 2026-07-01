import type { Bucket, LiveState } from "./backtest";
import type { Cell, Tables } from "./probabilityTable";

/**
 * The decision engine. Given the live last-bar state and the backtested
 * probability tables, it returns a deterministic call — TAKE / WATCH /
 * STAND ASIDE — whose every number is traceable to a table cell and an N. It is
 * built so STAND ASIDE fires often: no active setup, too little sample, no
 * measured edge over the base rate, or a regime where the edge disappears all
 * produce "no trade", stated plainly. Size comes from fractional Kelly on the
 * CI *lower* bound, capped by a fixed per-trade risk — never the point estimate.
 */
export interface SizingConfig {
  minSampleN: number; // below this, no confident call (default 30)
  kellyMultiplier: number; // fraction of full Kelly (default 0.25)
  kellyCap: number; // hard cap on the multiplier (default 0.5)
  maxPerTradeRisk: number; // fixed-fractional cap (default 0.01 = 1%)
}

export const DEFAULT_SIZING: SizingConfig = {
  minSampleN: 30,
  kellyMultiplier: 0.25,
  kellyCap: 0.5,
  maxPerTradeRisk: 0.01,
};

export type Action = "TAKE" | "WATCH" | "STAND_ASIDE";

export interface ModelRecommendation {
  action: Action;
  bucket: Bucket | null;
  regime: string;
  entry: number | null;
  stop: number | null;
  t1: number | null; // break-even AVWAP
  t2: number | null; // travel-lane target shelf
  rr: number | null;
  hitRateT1: number | null;
  ciT1: [number, number] | null;
  n: number;
  baseRate: number | null;
  edgeOverBase: boolean;
  /** Fraction of equity to RISK on the trade (0 = stand aside). */
  riskFrac: number;
  bindingConstraint: string;
  /** True when the cell's P75 heat is wider than the structural stop. */
  maeConflict: boolean;
  /** True when the call rests on the broader (bucket-only) cell, not the regime cell. */
  lowSample: boolean;
  rationale: string;
  cell: Cell | null;
}

function standAside(reason: string, live: LiveState, bucket: Bucket | null): ModelRecommendation {
  return {
    action: "STAND_ASIDE",
    bucket,
    regime: `trend:${live.trend} · vol:${live.vol}`,
    entry: null,
    stop: null,
    t1: null,
    t2: null,
    rr: null,
    hitRateT1: null,
    ciT1: null,
    n: 0,
    baseRate: null,
    edgeOverBase: false,
    riskFrac: 0,
    bindingConstraint: "no bet",
    maeConflict: false,
    lowSample: false,
    rationale: reason,
    cell: null,
  };
}

export function decide(live: LiveState, tables: Tables, sizing: SizingConfig = DEFAULT_SIZING): ModelRecommendation {
  const regimeLabel = `trend:${live.trend} · vol:${live.vol}`;
  if (!live.setupActive || live.bucket === null) {
    const why = live.reasons.length ? live.reasons.join("; ") : "setup not active";
    return standAside(`No below-break-even setup here — ${why}.`, live, live.bucket);
  }
  const bucket = live.bucket;

  // Prefer the regime-specific cell; fall back to the broader bucket cell (with a
  // low-confidence flag) only if the regime cell is under-sampled.
  const regimeCell = tables.byBucketRegime.find((c) => c.bucket === bucket && c.regime === `trend:${live.trend}`);
  const bucketCell = tables.byBucket.find((c) => c.bucket === bucket && c.regime === "ALL");
  let cell: Cell | null = null;
  let lowSample = false;
  if (regimeCell && regimeCell.n >= sizing.minSampleN) cell = regimeCell;
  else if (bucketCell && bucketCell.n >= sizing.minSampleN) {
    cell = bucketCell;
    lowSample = true;
  }
  if (!cell) {
    return standAside(`Unobserved / thin setup — only ${regimeCell?.n ?? 0} matching cases in this regime and ${bucketCell?.n ?? 0} in this bucket overall (need ≥ ${sizing.minSampleN}). No basis to act.`, live, bucket);
  }

  const entry = live.entry;
  const stop = live.stop;
  const t1 = live.breakeven;
  const t2 = live.targetShelf;
  const rr = stop !== null && t1 !== null && entry - stop > 0 ? (t1 - entry) / (entry - stop) : null;

  // Regime where the edge is known to disappear: deep deviations in a downtrend.
  if ((bucket === "C" || bucket === "D") && live.trend === "down") {
    return standAside(`Price is ${bucket === "D" ? "far" : "well"} below break-even, but the 200-day is falling — the backtest shows this deep-deviation bucket has no edge in a downtrend. Stand aside.`, live, bucket);
  }
  // No measured edge over the base rate → stand aside.
  if (!cell.edgeOverBase) {
    return {
      ...standAside(`Setup is active (bucket ${bucket}), but its hit-rate CI (${pct(cell.ciT1[0])}–${pct(cell.ciT1[1])}, N=${cell.n}) doesn't clear the ${pct(cell.baseRate)} base rate — no edge over just being long here.`, live, bucket),
      bucket,
      hitRateT1: cell.hitRateT1,
      ciT1: cell.ciT1,
      n: cell.n,
      baseRate: cell.baseRate,
      cell,
    };
  }

  // ---- sizing: fractional Kelly on the CI lower bound --------------------
  const p = cell.ciT1[0]; // conservative win prob
  const b = rr ?? 0; // payoff ratio for THIS trade (reward:risk)
  const kellyF = b > 0 ? p - (1 - p) / b : 0;
  let riskFrac = 0;
  let binding = "";
  if (kellyF <= 0) {
    riskFrac = 0;
    binding = "Kelly on the CI lower bound ≤ 0 — no demonstrable edge";
  } else {
    const mult = Math.min(sizing.kellyMultiplier, sizing.kellyCap);
    const kSize = mult * kellyF;
    if (kSize <= sizing.maxPerTradeRisk) {
      riskFrac = kSize;
      binding = `capped by ${(mult * 100).toFixed(0)}%-Kelly on the CI lower bound`;
    } else {
      riskFrac = sizing.maxPerTradeRisk;
      binding = `capped by ${(sizing.maxPerTradeRisk * 100).toFixed(0)}% per-trade risk`;
    }
  }

  const perShareRiskFrac = stop !== null && entry > 0 ? (entry - stop) / entry : NaN;
  const maeConflict = Number.isFinite(perShareRiskFrac) && cell.maeP75 > perShareRiskFrac;

  const action: Action = riskFrac <= 0 ? "STAND_ASIDE" : lowSample ? "WATCH" : "TAKE";
  const edge = cell.hitRateT1 - cell.baseRate;
  let rationale: string;
  if (action === "STAND_ASIDE") {
    rationale = `Below break-even in bucket ${bucket}, but Kelly on the CI lower bound is ≤ 0 (reward:risk ${rr?.toFixed(2) ?? "—"} too thin for a ${pct(p)} floor). No bet.`;
  } else {
    rationale = `Bucket ${bucket} in a ${live.trend}trend: historically ${pct(cell.hitRateT1)} reverted to break-even (N=${cell.n}, 95% CI ${pct(cell.ciT1[0])}–${pct(cell.ciT1[1])}) vs ${pct(cell.baseRate)} base rate — a ${(edge * 100).toFixed(0)}-pt edge.${lowSample ? " Using the bucket-wide cell (this regime is thin), so WATCH not TAKE." : ""}${maeConflict ? " Heads-up: typical heat (P75 MAE) is wider than the stop — expect to be tested." : ""}`;
  }

  return {
    action,
    bucket,
    regime: regimeLabel,
    entry,
    stop,
    t1,
    t2,
    rr,
    hitRateT1: cell.hitRateT1,
    ciT1: cell.ciT1,
    n: cell.n,
    baseRate: cell.baseRate,
    edgeOverBase: cell.edgeOverBase,
    riskFrac,
    bindingConstraint: binding,
    maeConflict,
    lowSample,
    rationale,
    cell,
  };
}

function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}
