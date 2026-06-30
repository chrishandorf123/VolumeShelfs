import { describe, expect, it } from "vitest";
import { computeRelativeStrength, rsLineSeries } from "./relativeStrength";
import type { Candle } from "./types";

const DAY = 86400;
function series(closes: number[]): Candle[] {
  return closes.map((c, i) => ({ time: i * DAY, open: c, high: c, low: c, close: c, volume: 100 }));
}

describe("rsLineSeries", () => {
  it("divides stock by benchmark on shared timestamps", () => {
    const stock = series([10, 20, 30]);
    const bench = series([10, 10, 10]);
    expect(rsLineSeries(stock, bench)).toEqual([1, 2, 3]);
  });
  it("only uses overlapping timestamps", () => {
    const stock = series([10, 20, 30]);
    const bench = [{ time: DAY, open: 5, high: 5, low: 5, close: 5, volume: 1 }];
    expect(rsLineSeries(stock, bench)).toEqual([4]);
  });
});

describe("computeRelativeStrength", () => {
  it("flags outperformance when the stock rises faster than the benchmark", () => {
    const n = 80;
    const stock = series(Array.from({ length: n }, (_, i) => 10 * Math.pow(1.01, i)));
    const bench = series(Array.from({ length: n }, (_, i) => 10 * Math.pow(1.002, i)));
    const rs = computeRelativeStrength(stock, bench);
    expect(rs.outperform1mo).toBe(true);
    expect(rs.outperform3mo).toBe(true);
    expect(rs.excess3mo).toBeGreaterThan(0);
    expect(rs.rsLineAboveMa).toBe(true);
    expect(rs.rsLineNearHigh).toBe(true);
  });

  it("flags underperformance when the stock lags", () => {
    const n = 80;
    const stock = series(Array.from({ length: n }, (_, i) => 10 * Math.pow(1.001, i)));
    const bench = series(Array.from({ length: n }, (_, i) => 10 * Math.pow(1.01, i)));
    const rs = computeRelativeStrength(stock, bench);
    expect(rs.outperform3mo).toBe(false);
  });
});
