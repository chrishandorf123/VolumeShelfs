import { describe, expect, it } from "vitest";
import { anchoredVwapBands, avwapCross, avwapState, indexHighVolumeDay } from "./avwapStrategy";
import type { Candle } from "./types";

const DAY = 86400;
const bar = (i: number, close: number, vol = 100): Candle => ({
  time: i * DAY,
  open: close,
  high: close + 0.5,
  low: close - 0.5,
  close,
  volume: vol,
});

describe("avwapState", () => {
  it("is bullish when price is above a rising AVWAP", () => {
    const candles = Array.from({ length: 40 }, (_, i) => bar(i, 10 + i * 0.2));
    const s = avwapState(candles, 0);
    expect(s.priceAbove).toBe(true);
    expect(s.slope).toBe("rising");
    expect(s.regime).toBe("bullish");
    expect(s.distancePct).toBeGreaterThan(0);
  });

  it("is bearish when price is below a falling AVWAP", () => {
    const candles = Array.from({ length: 40 }, (_, i) => bar(i, 30 - i * 0.2));
    const s = avwapState(candles, 0);
    expect(s.priceAbove).toBe(false);
    expect(s.slope).toBe("falling");
    expect(s.regime).toBe("bearish");
  });
});

describe("avwapCross", () => {
  it("flags a reclaim when price crosses back above the AVWAP", () => {
    // Long flat history below VWAP, then a pop above on the last 2 bars.
    const closes = [...Array(30).fill(10), 10, 9.8, 9.7, 13, 13.5];
    const candles = closes.map((c, i) => bar(i, c));
    const cross = avwapCross(candles, 0, 5);
    expect(cross.side).toBe("above");
    expect(cross.event).toBe("reclaim");
    expect(cross.barsAgo).toBeLessThanOrEqual(5);
  });

  it("reports holding-above when price has been above the whole window", () => {
    const candles = Array.from({ length: 30 }, (_, i) => bar(i, 10 + i * 0.3));
    const cross = avwapCross(candles, 0, 5);
    expect(cross.event).toBe("holding-above");
  });
});

describe("anchoredVwapBands", () => {
  it("brackets the VWAP with finite upper/lower bands", () => {
    const candles = Array.from({ length: 20 }, (_, i) => bar(i, 10 + Math.sin(i)));
    const b = anchoredVwapBands(candles, 0, 1);
    const last = b.vwap.length - 1;
    expect(Number.isFinite(b.vwap[last])).toBe(true);
    expect(b.upper[last]).toBeGreaterThan(b.vwap[last]);
    expect(b.lower[last]).toBeLessThan(b.vwap[last]);
  });
});

describe("indexHighVolumeDay", () => {
  it("finds the highest-volume bar", () => {
    const candles = [bar(0, 10, 100), bar(1, 11, 900), bar(2, 12, 200)];
    expect(indexHighVolumeDay(candles)).toBe(1);
  });
});
