import { describe, expect, it } from "vitest";
import { anchorCoach } from "./anchorCoach";
import { buildPhasedSeries } from "../data/universe";

describe("anchorCoach", () => {
  it("recommends the swing LOW for a leader holding above its base", () => {
    // Uptrend: price sits in the upper part of its range.
    const up = buildPhasedSeries(1, 15, [
      { bars: 40, drift: 0.0, vol: 0.015, volume: 2_000_000 },
      { bars: 120, drift: 0.006, vol: 0.02, volume: 2_000_000 },
      { bars: 20, drift: -0.002, vol: 0.02, volume: 2_000_000 },
    ]);
    const c = anchorCoach(up)!;
    expect(c).not.toBeNull();
    expect(c.recommendedKind).toBe("low");
    expect(c.low.recommended).toBe(true);
    expect(c.rationale).toMatch(/swing low/i);
  });

  it("recommends the swing HIGH for a pullback from a dominant high", () => {
    // High, then a big decline, then a rally that stalls in the lower range.
    const pullback = buildPhasedSeries(2, 16, [
      { bars: 20, drift: 0.02, vol: 0.02, volume: 2_000_000 }, // to the high
      { bars: 40, drift: -0.02, vol: 0.025, volume: 3_000_000 }, // decline
      { bars: 60, drift: 0.004, vol: 0.02, volume: 2_000_000 }, // weak rally, still low in range
    ]);
    const c = anchorCoach(pullback)!;
    expect(c.recommendedKind).toBe("high");
    expect(c.high.recommended).toBe(true);
    expect(c.rationale).toMatch(/swing high/i);
  });

  it("returns null when there isn't enough history", () => {
    const few = buildPhasedSeries(3, 20, [{ bars: 10, drift: 0.01, vol: 0.02, volume: 1_000_000 }]);
    expect(anchorCoach(few)).toBeNull();
  });
});
