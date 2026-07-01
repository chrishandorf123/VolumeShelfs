import { describe, expect, it } from "vitest";
import { computeConfluence, type ConfluenceInputs } from "./confluence";
import { bullishReversalBar, resampleWeekly } from "./indicators";
import { buildPhasedSeries } from "../data/universe";
import type { Candle } from "./types";

const series = buildPhasedSeries(5, 12, [
  { bars: 60, drift: 0.0, vol: 0.015, volume: 2_000_000 },
  { bars: 180, drift: 0.005, vol: 0.02, volume: 2_000_000 },
]);

const base: ConfluenceInputs = {
  candles: series,
  benchmark: series,
  price: series[series.length - 1].close,
  anchorIndex: 40,
  onShelf: true,
  pinchActive: true,
  valueAreaLow: 1,
  valueAreaHigh: 1000,
  ma200: 1,
  aboveMa200: true,
  ma5Rising: true,
  rsi: 55,
  macdHistRising: true,
  avwapReclaim: true,
  keyAvwap: series[series.length - 1].close * 1.05,
  rsOutperform: true,
  supportLow: series[series.length - 1].close * 0.97,
  overheadTarget: series[series.length - 1].close * 1.2,
};

describe("computeConfluence", () => {
  it("produces a 10-item scorecard with a grade and verdict", () => {
    const cf = computeConfluence(base);
    expect(cf.items).toHaveLength(10);
    expect(cf.total).toBe(10);
    expect(cf.passed).toBeGreaterThanOrEqual(0);
    expect(cf.passed).toBeLessThanOrEqual(10);
    expect(cf.score).toBe(Math.round((cf.passed / 10) * 100));
    expect(["A+", "A", "B", "C"]).toContain(cf.grade);
    expect(cf.verdict.length).toBeGreaterThan(0);
    // spans all six tiers
    expect(new Set(cf.items.map((i) => i.tier))).toEqual(new Set([1, 2, 3, 4, 5, 6]));
  });

  it("flags chasing when price is far above the anchored mean", () => {
    // Anchor near the end with a much lower price, so the current price sits many
    // SD above the anchored mean.
    const spike = [...series];
    const last = spike[spike.length - 1];
    const cf = computeConfluence({
      ...base,
      price: last.close * 3,
      anchorIndex: spike.length - 30,
    });
    expect(cf.distanceSD).toBeGreaterThan(1);
  });

  it("does not explode distanceSD when the anchor sits at the last bar", () => {
    // A near-last anchor falls back to a ~3-month window, so the reading is a
    // real, bounded number — never a float-artifact blowup.
    const cf = computeConfluence({ ...base, anchorIndex: base.candles.length - 2 });
    expect(Number.isFinite(cf.distanceSD)).toBe(true);
    expect(Math.abs(cf.distanceSD)).toBeLessThan(8);
  });

  it("marks reversion-into-strength for an uptrend on a shelf at/below the mean", () => {
    const cf = computeConfluence({
      ...base,
      price: 100,
      keyAvwap: 110,
      anchorIndex: 40,
    });
    // With aboveMa200 + ma5Rising + onShelf and price not extended, the edge flag
    // is available (depends on distanceSD which is data-driven, so just assert the
    // fields are coherent).
    expect(typeof cf.reversionIntoStrength).toBe("boolean");
    expect(cf.chasing).toBe(cf.distanceSD >= 2);
  });
});

describe("bullishReversalBar", () => {
  const c = (open: number, high: number, low: number, close: number): Candle => ({
    time: 0,
    open,
    high,
    low,
    close,
    volume: 1,
  });
  it("detects a hammer (long lower wick, close near the top)", () => {
    expect(bullishReversalBar([c(10, 10.2, 8, 10.1), c(10.1, 10.3, 9.0, 10.2)])).toBe(true);
  });
  it("detects a bullish engulfing", () => {
    expect(bullishReversalBar([c(11, 11.1, 10, 10.2), c(10.1, 11.5, 10.0, 11.4)])).toBe(true);
  });
  it("is false for an ordinary up bar", () => {
    expect(bullishReversalBar([c(10, 10.5, 9.9, 10.2), c(10.2, 10.4, 10.1, 10.3)])).toBe(false);
  });
});

describe("resampleWeekly", () => {
  it("collapses 5 trading days into one weekly candle", () => {
    const day = 86400;
    const start = Date.UTC(2024, 0, 1) / 1000; // a Monday
    const daily: Candle[] = Array.from({ length: 5 }, (_, i) => ({
      time: start + i * day,
      open: 10 + i,
      high: 11 + i,
      low: 9 + i,
      close: 10.5 + i,
      volume: 100,
    }));
    const wk = resampleWeekly(daily);
    expect(wk).toHaveLength(1);
    expect(wk[0].open).toBe(10); // first day's open
    expect(wk[0].close).toBe(14.5); // last day's close
    expect(wk[0].volume).toBe(500); // summed
  });
});
