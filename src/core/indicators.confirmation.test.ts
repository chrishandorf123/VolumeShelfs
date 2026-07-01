import { describe, expect, it } from "vitest";
import { emaSeries, macd, obvSeries, percentRange, rsiSeries } from "./indicators";
import type { Candle } from "./types";

describe("emaSeries", () => {
  it("seeds from the SMA of the first period and tracks the series", () => {
    const s = emaSeries([1, 2, 3, 4, 5], 3);
    expect(s[0]).toBeNaN();
    expect(s[1]).toBeNaN();
    expect(s[2]).toBeCloseTo(2); // SMA(1,2,3)
    // EMA next: 4*0.5 + 2*0.5 = 3
    expect(s[3]).toBeCloseTo(3);
  });

  it("skips leading NaNs (works on a MACD-style line)", () => {
    const s = emaSeries([NaN, NaN, 10, 12, 14], 2);
    // first two finite (10,12) seed SMA=11 at index 3, then 14*0.667+11*0.333≈13
    expect(s[2]).toBeNaN();
    expect(s[3]).toBeCloseTo(11);
    expect(s[4]).toBeGreaterThan(11);
  });
});

describe("macd", () => {
  it("is positive when a series trends up and negative when it trends down", () => {
    const up = Array.from({ length: 60 }, (_, i) => 10 + i);
    const down = Array.from({ length: 60 }, (_, i) => 70 - i);
    const mUp = macd(up);
    const mDown = macd(down);
    expect(mUp.macd[59]).toBeGreaterThan(0);
    expect(mDown.macd[59]).toBeLessThan(0);
    // hist = macd - signal, both defined near the end
    expect(Number.isFinite(mUp.hist[59])).toBe(true);
  });
});

describe("rsiSeries", () => {
  it("is 100 for a monotonic rise and low for a monotonic fall", () => {
    const up = Array.from({ length: 30 }, (_, i) => 10 + i);
    const down = Array.from({ length: 30 }, (_, i) => 40 - i);
    const rUp = rsiSeries(up, 14);
    const rDown = rsiSeries(down, 14);
    expect(rUp[rUp.length - 1]).toBeCloseTo(100);
    expect(rDown[rDown.length - 1]).toBeLessThan(5);
  });
});

describe("obvSeries", () => {
  const c = (close: number, prevClose: number): Candle => ({
    time: 0,
    open: prevClose,
    high: Math.max(close, prevClose),
    low: Math.min(close, prevClose),
    close,
    volume: 100,
  });
  it("adds volume on up-closes and subtracts on down-closes", () => {
    // closes: 10, 11 (up +100), 10.5 (down -100), 12 (up +100)
    const bars = [c(10, 10), c(11, 10), c(10.5, 11), c(12, 10.5)];
    const obv = obvSeries(bars);
    expect(obv[0]).toBe(0);
    expect(obv[1]).toBe(100);
    expect(obv[2]).toBe(0);
    expect(obv[3]).toBe(100);
  });
});

describe("percentRange", () => {
  it("is ~1 at the range high and ~0 at the range low", () => {
    const c = (close: number, high: number, low: number): Candle => ({
      time: 0,
      open: close,
      high,
      low,
      close,
      volume: 1,
    });
    const bars = [c(10, 10, 8), c(12, 12, 9), c(14, 14, 10)];
    expect(percentRange(bars, 3)).toBeCloseTo(1); // close 14 = range high (14), low 8
    const bars2 = [c(14, 14, 12), c(12, 13, 10), c(9, 11, 9)];
    expect(percentRange(bars2, 3)).toBeCloseTo(0); // close 9 = range low (9), high 14
  });
});
