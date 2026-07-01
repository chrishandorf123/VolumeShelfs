import { describe, expect, it } from "vitest";
import {
  chooseScanAnchor,
  electBestShelfAnchor,
  isHighAnchor,
  significance,
} from "./anchor";
import { defaultAnchorIndex } from "./swings";
import { DEFAULT_SCAN_CONFIG } from "./scanner";
import { buildPhasedSeries } from "../data/universe";
import type { Candle } from "./types";

const DAY = 86400;

/** Close-based bars (no tied lows) so swing pivots resolve cleanly. */
function makeSeries(n: number, fn: (i: number) => number, vol: (i: number) => number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const close = fn(i);
    const prev = i > 0 ? fn(i - 1) : close;
    out.push({
      time: i * DAY,
      open: prev,
      high: close * 1.01,
      low: close * 0.99,
      close,
      volume: Math.max(1, vol(i)),
    });
  }
  return out;
}

// Leader: V-base -> run-up -> heavy shelf -> shallow pullback into the shelf.
function leaderPath(i: number): number {
  if (i <= 40) return 30 + (18 - 30) * (i / 40);
  if (i <= 110) return 18 + (28 - 18) * ((i - 40) / 70);
  if (i <= 250) return 28 + Math.sin((i - 110) / 8) * 1.0;
  return 28 + 0.5 * ((i - 250) / 29);
}
const leader = makeSeries(280, leaderPath, (i) => (i <= 110 ? 1_000_000 : i <= 250 ? 5_000_000 : 1_200_000));

// ASST-style: pivot high -> decline -> rally -> heavy base the price fell into.
const asst = buildPhasedSeries(314, 16, [
  { bars: 20, drift: 0.018, vol: 0.02, volume: 2_500_000 },
  { bars: 35, drift: -0.02, vol: 0.025, volume: 3_000_000 },
  { bars: 20, drift: -0.02, vol: 0.03, volume: 3_500_000 },
  { bars: 60, drift: 0.016, vol: 0.022, volume: 2_500_000 },
  { bars: 35, drift: -0.013, vol: 0.018, volume: 5_500_000 },
  { bars: 70, drift: -0.001, vol: 0.02, volume: 6_000_000 },
]);

// Extended: monotonic up, price far above any shelf -> no at-price shelf.
const extended = makeSeries(260, (i) => 20 * Math.pow(1.01, i), () => 3_000_000);

describe("electBestShelfAnchor", () => {
  it("keeps the leader anchored at its major swing low (no regression)", () => {
    const price = leader[leader.length - 1].close;
    const anchor = electBestShelfAnchor(leader, price, DEFAULT_SCAN_CONFIG);
    expect(anchor.label).toBe("swing-low");
    expect(anchor.index).toBe(defaultAnchorIndex(leader, 5, 20));
  });

  it("flips a pullback-from-a-high to a high anchor whose shelf sits at price", () => {
    const price = asst[asst.length - 1].close;
    const anchor = electBestShelfAnchor(asst, price, DEFAULT_SCAN_CONFIG);
    expect(isHighAnchor(anchor.label)).toBe(true);
    // The elected anchor's profile must place a shelf around current price.
    expect(anchor.index).toBeLessThan(asst.length - 40);
  });

  it("falls back to chooseScanAnchor when nothing has a shelf at price", () => {
    const price = extended[extended.length - 1].close;
    const elected = electBestShelfAnchor(extended, price, DEFAULT_SCAN_CONFIG);
    const fallback = chooseScanAnchor(extended);
    expect(elected.index).toBe(fallback.index);
    expect(elected.label).toBe(fallback.label);
  });
});

describe("significance", () => {
  it("rates a deep pullback's origin-high above its origin-low", () => {
    const highIdx = 20; // the pivot high
    const lowIdx = 70; // the spike low
    expect(significance(asst, highIdx, "high")).toBeGreaterThan(significance(asst, lowIdx, "low"));
  });

  it("rates a leader's origin-low above its origin-high", () => {
    const lowIdx = defaultAnchorIndex(leader, 5, 20);
    expect(significance(leader, lowIdx, "low")).toBeGreaterThan(significance(leader, 150, "high"));
  });

  it("discounts a high that price has since reclaimed below the origin low", () => {
    // Monotonic uptrend: the early high is far below price (reclaimed), so the
    // low is the dominant structural origin, not the reclaimed high.
    const up = makeSeries(120, (i) => 10 + i * 0.3, () => 100);
    const reclaimedHigh = significance(up, 10, "high");
    const dominantLow = significance(up, 5, "low");
    expect(dominantLow).toBeGreaterThan(reclaimedHigh);
    // The reclaim guard knocks the high's side term down to ~0.
    expect(reclaimedHigh).toBeLessThan(dominantLow * 0.6);
  });

  it("does NOT discount a swing high on a single transient poke above it", () => {
    // Pivot high at index 30 (~50), then a decline into a base price trades in.
    const path = (i: number) =>
      i <= 30
        ? 30 + (50 - 30) * (i / 30)
        : i <= 150
          ? 50 + (34 - 50) * ((i - 30) / 120)
          : 34 + Math.sin((i - 150) / 6);
    const clean = makeSeries(220, path, () => 2_000_000);
    const hi = 30;
    const cleanSig = significance(clean, hi, "high");
    // Inject ONE failed-breakout bar 3% above the pivot high, then price reverses.
    const trap = clean.map((c) => ({ ...c }));
    const pivotHigh = clean[hi].high;
    trap[120] = { ...trap[120], high: pivotHigh * 1.04, close: pivotHigh * 1.03 };
    const trapSig = significance(trap, hi, "high");
    // A one-bar poke that reverses must not collapse it (old code ×0.25 did).
    expect(trapSig).toBeGreaterThan(cleanSig * 0.6);
  });
});
