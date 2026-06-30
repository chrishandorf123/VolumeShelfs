import { describe, expect, it } from "vitest";
import { buildEdges, computeAnchoredProfile, computeValueArea } from "./volumeProfile";
import type { Candle, ProfileBin } from "./types";

function candle(time: number, low: number, high: number, volume: number): Candle {
  const mid = (low + high) / 2;
  return { time, open: mid, high, low, close: mid, volume };
}

describe("buildEdges", () => {
  it("creates rowCount+1 evenly spaced linear edges", () => {
    const edges = buildEdges(0, 100, 10, "linear");
    expect(edges).toHaveLength(11);
    expect(edges[0]).toBe(0);
    expect(edges[10]).toBe(100);
    expect(edges[5]).toBeCloseTo(50);
  });

  it("spaces log edges equally in log-price space", () => {
    const edges = buildEdges(1, 1000, 3, "log");
    expect(edges[0]).toBeCloseTo(1);
    expect(edges[1]).toBeCloseTo(10);
    expect(edges[2]).toBeCloseTo(100);
    expect(edges[3]).toBeCloseTo(1000);
  });

  it("falls back to linear when log is requested on non-positive prices", () => {
    const edges = buildEdges(-10, 10, 4, "log");
    expect(edges[0]).toBe(-10);
    expect(edges[4]).toBe(10);
    expect(edges[2]).toBeCloseTo(0);
  });

  it("handles a degenerate range without dividing by zero", () => {
    const edges = buildEdges(50, 50, 10, "linear");
    expect(edges.length).toBeGreaterThanOrEqual(2);
    expect(edges[edges.length - 1]).toBeGreaterThan(edges[0]);
  });
});

describe("computeAnchoredProfile", () => {
  it("conserves total volume across the rows", () => {
    const candles = [
      candle(1, 10, 12, 100),
      candle(2, 11, 15, 200),
      candle(3, 9, 11, 50),
      candle(4, 14, 18, 300),
    ];
    const p = computeAnchoredProfile(candles, 0, {
      rowCount: 20,
      scale: "linear",
      valueAreaFraction: 0.7,
    });
    const summed = p.bins.reduce((s, b) => s + b.volume, 0);
    expect(summed).toBeCloseTo(650, 4);
    expect(p.totalVolume).toBeCloseTo(650, 4);
  });

  it("derives the price range from the anchored window only", () => {
    const candles = [
      candle(1, 1, 2, 10), // before anchor, must be ignored
      candle(2, 50, 60, 100),
      candle(3, 40, 55, 100),
    ];
    const p = computeAnchoredProfile(candles, 1, {
      rowCount: 10,
      scale: "linear",
      valueAreaFraction: 0.7,
    });
    expect(p.priceLow).toBe(40);
    expect(p.priceHigh).toBe(60);
  });

  it("puts the POC where the most volume concentrates", () => {
    const candles = [
      candle(1, 20, 21, 1000), // heavy volume tightly around 20-21
      candle(2, 10, 30, 50), // thin wide bar
      candle(3, 20, 21, 1000),
    ];
    const p = computeAnchoredProfile(candles, 0, {
      rowCount: 20,
      scale: "linear",
      valueAreaFraction: 0.7,
    });
    expect(p.poc.low).toBeLessThanOrEqual(21);
    expect(p.poc.high).toBeGreaterThanOrEqual(20);
  });

  it("distributes a wide candle across multiple rows", () => {
    const candles = [candle(1, 0, 100, 1000)];
    const p = computeAnchoredProfile(candles, 0, {
      rowCount: 10,
      scale: "linear",
      valueAreaFraction: 0.7,
    });
    // Evenly spread => each of 10 rows holds ~100.
    for (const b of p.bins) expect(b.volume).toBeCloseTo(100, 4);
  });
});

describe("computeValueArea", () => {
  const mk = (vols: number[]): ProfileBin[] =>
    vols.map((v, i) => ({ low: i, high: i + 1, mid: i + 0.5, volume: v, fraction: 0 }));

  it("expands toward the heavier neighbour until the fraction is met", () => {
    const bins = mk([1, 2, 10, 3, 1]); // POC at index 2
    const total = 17;
    const va = computeValueArea(bins, 2, total, 0.7); // target 11.9
    // POC(10) -> add 3 (=13) reaches target; band is index 2..3.
    expect(va.lowIndex).toBe(2);
    expect(va.highIndex).toBe(3);
    expect(va.volume).toBeGreaterThanOrEqual(11.9);
  });

  it("returns the whole range at 100%", () => {
    const bins = mk([1, 2, 10, 3, 1]);
    const va = computeValueArea(bins, 2, 17, 1);
    expect(va.lowIndex).toBe(0);
    expect(va.highIndex).toBe(4);
  });
});
