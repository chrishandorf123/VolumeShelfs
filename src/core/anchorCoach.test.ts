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

  it("anchors from a pivot inside the selected timeframe window", () => {
    // A deep all-time low early, a long rally, then a mild recent pullback that
    // makes a much higher local low. The full-history coach should anchor the
    // deep old low; a short window should anchor the recent, higher low.
    const series = buildPhasedSeries(7, 20, [
      { bars: 30, drift: -0.01, vol: 0.02, volume: 2_000_000 }, // slide to the deep low
      { bars: 120, drift: 0.01, vol: 0.02, volume: 2_000_000 }, // long rally
      { bars: 60, drift: -0.003, vol: 0.02, volume: 2_000_000 }, // recent shallow pullback
    ]);
    const full = anchorCoach(series)!; // window >= n → whole history
    const short = anchorCoach(series, 60)!; // just the last ~3 months

    expect(short.low.index).toBeGreaterThan(full.low.index);
    expect(short.low.price).toBeGreaterThan(full.low.price);
    // The short-window low must actually sit inside that window.
    expect(short.low.index).toBeGreaterThanOrEqual(series.length - 60);
  });

  it("never claims 'holding above' the swing low when price has broken below it", () => {
    // Rally to a high, then a long decline that ends at new lows — so the
    // windowed swing low ends up ABOVE the final price.
    const broke = buildPhasedSeries(11, 30, [
      { bars: 40, drift: 0.0, vol: 0.02, volume: 2_000_000 },
      { bars: 30, drift: 0.012, vol: 0.02, volume: 2_000_000 }, // up to a high
      { bars: 90, drift: -0.015, vol: 0.025, volume: 2_000_000 }, // long decline to new lows
    ]);
    const c = anchorCoach(broke)!;
    const lastClose = broke[broke.length - 1].close;
    // Precondition: the detected swing low sits above the current price.
    expect(c.low.price).toBeGreaterThan(lastClose);
    // Then it must recommend the HIGH and must NOT claim price is holding above.
    expect(c.recommendedKind).toBe("high");
    expect(c.rationale.toLowerCase()).not.toContain("holding above");
    expect(c.rationale.toLowerCase()).toContain("broken below");
  });
});
