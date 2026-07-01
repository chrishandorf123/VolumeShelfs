import { describe, expect, it } from "vitest";
import { buildGapPlays, selectPrimaryGapPlay } from "./gapPlay";
import type { ScoredShelf } from "./shelves";
import type { VolumeGap } from "./types";

function shelf(priceLow: number, priceHigh: number, strength: number): ScoredShelf {
  return {
    priceLow,
    priceHigh,
    peakPrice: (priceLow + priceHigh) / 2,
    volume: strength * 100,
    fraction: 0.2,
    lowIndex: 0,
    highIndex: 0,
    zone: "break-even-demand",
    strength,
  };
}

function gap(priceLow: number, priceHigh: number): VolumeGap {
  return { priceLow, priceHigh, volume: 1, fraction: 0.01, lowIndex: 0, highIndex: 0 };
}

describe("buildGapPlays", () => {
  // support shelf 9-10, air pocket 10-14, target shelf 14-15
  const shelves = [shelf(9, 10, 2), shelf(14, 15, 3)];
  const gaps = [gap(10, 14)];

  it("pairs a gap with the support shelf below and target shelf above", () => {
    const plays = buildGapPlays(shelves, gaps, 10, 0.03);
    expect(plays).toHaveLength(1);
    const p = plays[0];
    expect(p.entryShelf.priceHigh).toBe(10);
    expect(p.targetShelf?.priceLow).toBe(14);
    expect(p.entry).toBe(10); // top of support shelf
    expect(p.target).toBe(14); // first touch of target shelf
    expect(p.stop).toBeCloseTo(9 * 0.995);
    expect(p.airPocketPct).toBeCloseTo((14 - 10) / 10);
    expect(p.rr).toBeGreaterThan(0);
  });

  it("marks the play active when price sits at the support shelf", () => {
    const atSupport = buildGapPlays(shelves, gaps, 9.8, 0.03);
    expect(atSupport[0].active).toBe(true);
    const farBelow = buildGapPlays(shelves, gaps, 6, 0.03);
    expect(farBelow[0].active).toBe(false);
  });

  it("is not active in the dead zone or deep inside the gap (only the launch zone)", () => {
    // support shelf 9-10, non-adjacent gap 12-16 (dead zone 10-12), target 16-17
    const s = [shelf(9, 10, 2), shelf(16, 17, 3)];
    const g = [gap(12, 16)];
    expect(buildGapPlays(s, g, 9.8, 0.03)[0].active).toBe(true); // at the shelf
    expect(buildGapPlays(s, g, 11, 0.03)[0].active).toBe(false); // dead zone
    expect(buildGapPlays(s, g, 15.5, 0.03)[0].active).toBe(false); // deep in the gap
  });

  it("skips gaps with no support shelf beneath them", () => {
    const plays = buildGapPlays([shelf(14, 15, 3)], gaps, 10, 0.03);
    expect(plays).toHaveLength(0);
  });

  it("still forms a play when there is no far shelf (target = gap top)", () => {
    const plays = buildGapPlays([shelf(9, 10, 2)], gaps, 9.8, 0.03);
    expect(plays).toHaveLength(1);
    expect(plays[0].targetShelf).toBeNull();
    expect(plays[0].target).toBe(14);
  });
});

describe("selectPrimaryGapPlay", () => {
  it("prefers an active play over a distant one", () => {
    const shelves = [shelf(9, 10, 2), shelf(14, 15, 3), shelf(20, 21, 2)];
    const gaps = [gap(10, 14), gap(15, 20)];
    const plays = buildGapPlays(shelves, gaps, 9.8, 0.03);
    const primary = selectPrimaryGapPlay(plays, 9.8);
    expect(primary).not.toBeNull();
    expect(primary!.active).toBe(true);
    expect(primary!.entryShelf.priceHigh).toBe(10);
  });

  it("returns null when there are no plays", () => {
    expect(selectPrimaryGapPlay([], 10)).toBeNull();
  });
});
