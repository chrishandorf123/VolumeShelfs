import type { Candle } from "./types";
import { returnOver, smaLast } from "./indicators";

/** 1-month / 3-month lookbacks in trading bars. */
export const RS_1MO = 21;
export const RS_3MO = 63;

export interface RelativeStrength {
  /** Stock return − benchmark return over 1 month. */
  excess1mo: number;
  /** Stock return − benchmark return over 3 months. */
  excess3mo: number;
  outperform1mo: boolean;
  outperform3mo: boolean;
  /** RS line (stock ÷ benchmark) latest value, or NaN if unalignable. */
  rsLine: number;
  /** RS line within `nearHighTol` of its own recent maximum. */
  rsLineNearHigh: boolean;
  /** RS line above its own 50-bar moving average. */
  rsLineAboveMa: boolean;
}

/** Align stock and benchmark on shared timestamps and return RS = stock/bench. */
export function rsLineSeries(stock: Candle[], benchmark: Candle[]): number[] {
  const benchByTime = new Map<number, number>();
  for (const c of benchmark) benchByTime.set(c.time, c.close);
  const out: number[] = [];
  for (const c of stock) {
    const b = benchByTime.get(c.time);
    if (b !== undefined && b > 0) out.push(c.close / b);
  }
  return out;
}

export function computeRelativeStrength(
  stock: Candle[],
  benchmark: Candle[],
  opts: { nearHighTol?: number; rsMaPeriod?: number; rsHighWindow?: number } = {},
): RelativeStrength {
  const nearHighTol = opts.nearHighTol ?? 0.03;
  const rsMaPeriod = opts.rsMaPeriod ?? 50;
  const rsHighWindow = opts.rsHighWindow ?? 126;

  const stock1 = returnOver(stock, RS_1MO);
  const stock3 = returnOver(stock, RS_3MO);
  const bench1 = returnOver(benchmark, RS_1MO);
  const bench3 = returnOver(benchmark, RS_3MO);
  const excess1mo = stock1 - bench1;
  const excess3mo = stock3 - bench3;

  const rs = rsLineSeries(stock, benchmark);
  const rsLine = rs.length ? rs[rs.length - 1] : NaN;

  let rsLineNearHigh = false;
  if (rs.length > 1) {
    const start = Math.max(0, rs.length - rsHighWindow);
    let max = -Infinity;
    for (let i = start; i < rs.length; i++) if (rs[i] > max) max = rs[i];
    rsLineNearHigh = max > 0 && rsLine >= max * (1 - nearHighTol);
  }

  const rsMa = smaLast(rs, rsMaPeriod);
  const rsLineAboveMa = Number.isFinite(rsMa) && rsLine > rsMa;

  return {
    excess1mo,
    excess3mo,
    outperform1mo: Number.isFinite(excess1mo) && excess1mo > 0,
    outperform3mo: Number.isFinite(excess3mo) && excess3mo > 0,
    rsLine,
    rsLineNearHigh,
    rsLineAboveMa,
  };
}
