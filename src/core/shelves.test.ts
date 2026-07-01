import { describe, expect, it } from "vitest";
import { analyzeProfile, classifyZone, detectGaps, detectShelves } from "./shelves";
import type { AnchoredVolumeProfile, ProfileBin } from "./types";

/** Build a minimal profile from an array of per-row volumes for testing. */
function profileFromVolumes(volumes: number[]): AnchoredVolumeProfile {
  const bins: ProfileBin[] = volumes.map((v, i) => ({
    low: i,
    high: i + 1,
    mid: i + 0.5,
    volume: v,
    fraction: 0,
  }));
  const total = volumes.reduce((s, v) => s + v, 0);
  let pocIndex = 0;
  volumes.forEach((v, i) => {
    if (v > volumes[pocIndex]) pocIndex = i;
  });
  for (const b of bins) b.fraction = total > 0 ? b.volume / total : 0;
  return {
    anchorIndex: 0,
    endIndex: volumes.length,
    scale: "linear",
    priceLow: 0,
    priceHigh: volumes.length,
    rowSize: volumes.length,
    totalVolume: total,
    bins,
    poc: bins[pocIndex],
    pocIndex,
    valueArea: { low: 0, high: volumes.length, volume: total, lowIndex: 0, highIndex: volumes.length - 1 },
  };
}

describe("classifyZone", () => {
  const shelf = { priceLow: 10, priceHigh: 20 };
  it("is break-even demand (support) when price is above the shelf", () => {
    expect(classifyZone(shelf, 25)).toBe("break-even-demand");
  });
  it("is break-even supply (resistance) when price is below the shelf", () => {
    expect(classifyZone(shelf, 5)).toBe("break-even-supply");
  });
  it("is at-price when price sits inside the shelf", () => {
    expect(classifyZone(shelf, 15)).toBe("at-price");
  });
});

describe("detectShelves", () => {
  it("merges adjacent high-volume rows into a single shelf", () => {
    // POC = 100. Rows 3,4,5 are >= 55% of POC -> one shelf.
    const profile = profileFromVolumes([5, 10, 20, 80, 100, 70, 15, 5]);
    const shelves = detectShelves(profile, 0, { shelfThreshold: 0.55, gapThreshold: 0.12 });
    expect(shelves).toHaveLength(1);
    expect(shelves[0].lowIndex).toBe(3);
    expect(shelves[0].highIndex).toBe(5);
    expect(shelves[0].peakPrice).toBeCloseTo(4.5); // row index 4 -> mid 4.5
  });

  it("separates two clusters divided by a low-volume gap", () => {
    const profile = profileFromVolumes([90, 100, 5, 4, 3, 95, 88]);
    const shelves = detectShelves(profile, 0, { shelfThreshold: 0.55, gapThreshold: 0.12 });
    expect(shelves).toHaveLength(2);
  });

  it("classifies shelves relative to the current price", () => {
    const profile = profileFromVolumes([90, 100, 5, 4, 3, 95, 88]);
    // Lower shelf spans price 0-2, upper spans 5-7; price 3.5 sits in the gap.
    const shelves = detectShelves(profile, 3.5, { shelfThreshold: 0.55, gapThreshold: 0.12 });
    const lower = shelves.find((s) => s.priceHigh <= 3.5)!;
    const upper = shelves.find((s) => s.priceLow >= 3.5)!;
    expect(lower.zone).toBe("break-even-demand");
    expect(upper.zone).toBe("break-even-supply");
  });
});

describe("detectGaps", () => {
  it("finds an interior low-volume vacuum", () => {
    const profile = profileFromVolumes([90, 100, 5, 4, 3, 95, 88]);
    const gaps = detectGaps(profile, { shelfThreshold: 0.55, gapThreshold: 0.12 });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].lowIndex).toBe(2);
    expect(gaps[0].highIndex).toBe(4);
  });

  it("ignores a profile that is entirely empty", () => {
    const profile = profileFromVolumes([0, 0, 0, 0]);
    const gaps = detectGaps(profile, { shelfThreshold: 0.55, gapThreshold: 0.12 });
    expect(gaps).toHaveLength(0);
  });

  it("finds the gap between two mid-height shelves the global POC would hide (the ASST case)", () => {
    // A dominant top cluster owns the POC (180). A real lower shelf (~100) sits
    // below a thin valley (~28). Relative to the POC the valley is ~15%+ — an
    // absolute cutoff misses it — but relative to its bounding shelves it's a
    // clear air pocket. Wujastyk's technique flags it; ours now must too.
    const profile = profileFromVolumes([40, 90, 150, 180, 120, 50, 30, 28, 45, 100, 85, 35]);
    const gaps = detectGaps(profile, { shelfThreshold: 0.55, gapThreshold: 0.12 });
    expect(gaps.length).toBeGreaterThanOrEqual(1);
    // The valley floor (row 7) must be inside a reported gap.
    const covering = gaps.find((g) => g.lowIndex <= 7 && g.highIndex >= 7);
    expect(covering).toBeDefined();
    // And that gap sits between the top shelf (row 3) and the lower shelf (row 9).
    expect(covering!.lowIndex).toBeGreaterThan(3);
    expect(covering!.highIndex).toBeLessThan(9);
  });

  it("does not flag a shallow saddle between shelves as a gap", () => {
    // The dip (row 2 = 80) only eases to ~80% of its walls — not an air pocket.
    const profile = profileFromVolumes([100, 95, 80, 96, 100]);
    const gaps = detectGaps(profile, { shelfThreshold: 0.55, gapThreshold: 0.12 });
    expect(gaps).toHaveLength(0);
  });
});

describe("analyzeProfile", () => {
  it("reports the nearest demand and supply shelves around price", () => {
    const profile = profileFromVolumes([90, 100, 5, 4, 3, 95, 88]);
    const { nearestDemand, nearestSupply } = analyzeProfile(profile, 3.5, {
      shelfThreshold: 0.55,
      gapThreshold: 0.12,
    });
    expect(nearestDemand).not.toBeNull();
    expect(nearestSupply).not.toBeNull();
    expect(nearestDemand!.priceHigh).toBeLessThanOrEqual(3.5);
    expect(nearestSupply!.priceLow).toBeGreaterThanOrEqual(3.5);
  });
});
