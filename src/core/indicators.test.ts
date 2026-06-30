import { describe, expect, it } from "vitest";
import {
  anchoredVwapSeries,
  atrSeries,
  avgDollarVolume,
  returnOver,
  slopeOf,
  smaLast,
  smaSeries,
} from "./indicators";
import type { Candle } from "./types";

const bar = (close: number, high = close, low = close, volume = 100): Candle => ({
  time: 0,
  open: close,
  high,
  low,
  close,
  volume,
});

describe("smaSeries / smaLast", () => {
  it("computes a trailing average", () => {
    const v = [1, 2, 3, 4, 5];
    const s = smaSeries(v, 3);
    expect(s[0]).toBeNaN();
    expect(s[1]).toBeNaN();
    expect(s[2]).toBeCloseTo(2);
    expect(s[4]).toBeCloseTo(4);
    expect(smaLast(v, 3)).toBeCloseTo(4);
  });
  it("returns NaN without enough data", () => {
    expect(smaLast([1, 2], 5)).toBeNaN();
  });
});

describe("atrSeries", () => {
  it("seeds from the average true range then Wilder-smooths", () => {
    const candles = Array.from({ length: 20 }, (_, i) => bar(10 + i, 10 + i + 1, 10 + i - 1));
    const atr = atrSeries(candles, 14);
    expect(atr[12]).toBeNaN();
    expect(atr[13]).toBeGreaterThan(0);
    expect(atr[19]).toBeGreaterThan(0);
  });
});

describe("returnOver", () => {
  it("computes fractional return", () => {
    const candles = [bar(100), bar(110), bar(121)];
    expect(returnOver(candles, 2)).toBeCloseTo(0.21);
  });
});

describe("anchoredVwapSeries", () => {
  it("is volume-weighted from the anchor", () => {
    const candles = [bar(10, 10, 10, 100), bar(20, 20, 20, 300)];
    const v = anchoredVwapSeries(candles, 0);
    // (10*100 + 20*300) / 400 = 17.5
    expect(v[1]).toBeCloseTo(17.5);
  });
  it("falls back to a simple average when volume is zero", () => {
    const candles = [bar(10, 10, 10, 0), bar(20, 20, 20, 0)];
    const v = anchoredVwapSeries(candles, 0);
    expect(v[1]).toBeCloseTo(15);
  });
});

describe("avgDollarVolume", () => {
  it("averages close × volume", () => {
    const candles = [bar(10, 10, 10, 100), bar(20, 20, 20, 100)];
    // (10*100 + 20*100)/2 = 1500
    expect(avgDollarVolume(candles, 20)).toBeCloseTo(1500);
  });
});

describe("slopeOf", () => {
  it("classifies rising, flat and falling tails", () => {
    expect(slopeOf([1, 2, 3, 4], 2, 0.01)).toBe("rising");
    expect(slopeOf([4, 3, 2, 1], 2, 0.01)).toBe("falling");
    expect(slopeOf([10, 10.01, 10, 10.02], 2, 0.01)).toBe("flat");
  });
});
