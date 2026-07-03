/**
 * "If you keep trading like this" — deterministic projection of the journal's
 * measured edge. Models each trade as the two-outcome bet the journal actually
 * records (win avgWinR·risk, lose avgLossR·risk), takes the mean/variance of
 * the log outcome, and reads percentile bands off the normal approximation of
 * the summed log-growth. The same diffusion gives the classic risk-of-ruin
 * estimate for hitting a drawdown barrier. Pure math — fully testable.
 */
export interface EdgeModel {
  /** Win probability among decided trades (0..1). */
  winRate: number;
  /** Average winning trade in R (positive). */
  avgWinR: number;
  /** Average losing trade in R (negative). */
  avgLossR: number;
  /** Fraction of the account risked per trade (e.g. 0.01). */
  riskFrac: number;
}

export interface Projection {
  /** Account multiple after `trades` trades: pessimistic / median / optimistic. */
  p05: number;
  p50: number;
  p95: number;
  /** Probability of hitting the ruin barrier (default: half the account) first. */
  riskOfRuin: number;
  /** Per-trade expected log growth (negative = the edge loses money). */
  drift: number;
}

/** Mean and variance of one trade's log account multiple. */
function logMoments(m: EdgeModel): { mu: number; sigma2: number } {
  const p = Math.min(1, Math.max(0, m.winRate));
  const win = Math.max(1e-9, 1 + m.riskFrac * Math.max(0, m.avgWinR));
  const loss = Math.max(1e-9, 1 + m.riskFrac * Math.min(0, m.avgLossR));
  const lw = Math.log(win);
  const ll = Math.log(loss);
  const mu = p * lw + (1 - p) * ll;
  const sigma2 = p * lw * lw + (1 - p) * ll * ll - mu * mu;
  return { mu, sigma2 };
}

/**
 * Diffusion approximation of ruin: with positive drift μ and variance σ² per
 * trade, the chance of ever hitting the log-barrier b<0 is exp(2μb/σ²);
 * with zero/negative drift it is certain. `ruinAt` = fraction of the account
 * that counts as ruin (0.5 = losing half).
 */
export function riskOfRuin(m: EdgeModel, ruinAt = 0.5): number {
  if (!(m.riskFrac > 0)) return 0; // risking nothing ruins nobody
  const { mu, sigma2 } = logMoments(m);
  if (mu <= 0) return 1;
  if (sigma2 <= 0) return 0; // deterministic growth
  const b = Math.log(Math.max(1e-9, Math.min(1, ruinAt)));
  return Math.min(1, Math.max(0, Math.exp((2 * mu * b) / sigma2)));
}

/** Percentile account multiples after `trades` trades (z: ±1.645 = 5/95%). */
export function projectGrowth(m: EdgeModel, trades = 100, ruinAt = 0.5): Projection {
  const { mu, sigma2 } = logMoments(m);
  const sd = Math.sqrt(Math.max(0, sigma2) * trades);
  const z = 1.645;
  return {
    p05: Math.exp(mu * trades - z * sd),
    p50: Math.exp(mu * trades),
    p95: Math.exp(mu * trades + z * sd),
    riskOfRuin: riskOfRuin(m, ruinAt),
    drift: mu,
  };
}
