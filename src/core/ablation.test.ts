import { describe, expect, it } from "vitest";
import { DEFAULT_ABLATION_CONFIG, cellKeyOf, rAtCost, runAblation } from "./ablation";
import type { Trade } from "./backtest";
import type { FootprintSnapshot } from "./footprint";

function snap(over: Partial<FootprintSnapshot> = {}): FootprintSnapshot {
  return {
    absorptionBull: false,
    absorptionBear: false,
    absorptionScore: NaN,
    volRatio: 1,
    rangeRatio: 1,
    closeLoc: 0.5,
    levelProximityAtr: NaN,
    reclaim: false,
    reclaimHold: false,
    loss: false,
    defense: false,
    reclaimCount: 0,
    activeAvwaps: 1,
    distAtr: 0,
    barsBelowPrior: 0,
    reclaimVolRatio: 1,
    avwapSlopeUp: null,
    ...over,
  };
}

/** Minimal winning/losing trade; R is derived from prices so cost stress works. */
function trade(i: number, win: boolean, fp: Partial<FootprintSnapshot> = {}): Trade {
  const entryPrice = 100;
  const exitPrice = win ? 110 : 95;
  return {
    entryIndex: i,
    entryTime: 1_600_000_000 + i * 86400,
    entryPrice,
    z: -1.5,
    bucket: "B",
    trend: "up",
    vol: "normal",
    gates: { rvol: false, rsi: false, macd: false, reversal: false, climax: false },
    footprint: snap(fp),
    breakeven: 110,
    targetShelf: null,
    stop: 95,
    perShareRisk: 5,
    hitT1: win,
    barsToT1: win ? 3 : null,
    hitT2: false,
    hitStop: !win,
    whipsaw: false,
    exitIndex: i + 3,
    exitPrice,
    rMultiple: rAtCost({ entryPrice, exitPrice, perShareRisk: 5 } as Trade, 1),
    maePct: 0.02,
    mfePct: 0.05,
    fwdReturn: {},
  };
}

describe("rAtCost", () => {
  it("recomputes R from stored prices; higher costs shrink R", () => {
    const t = trade(0, true);
    const r1 = rAtCost(t, 1);
    const r2 = rAtCost(t, 2);
    expect(r1).toBeCloseTo((110 * 0.9999 - 100 * 1.0001) / 5, 4);
    expect(r2).toBeLessThan(r1);
  });
});

describe("cellKeyOf", () => {
  it("keys each variant by exactly its conditioning variables", () => {
    const t = trade(0, true, { absorptionBull: true, reclaim: true });
    expect(cellKeyOf(t, "baseline")).toBe("B");
    expect(cellKeyOf(t, "absorption")).toBe("B|abs:1");
    expect(cellKeyOf(t, "avwapEvent")).toBe("B|av:1");
    expect(cellKeyOf(t, "both")).toBe("B|abs:1|av:1");
  });
});

describe("runAblation (walk-forward, embargoed)", () => {
  it("finds the conditioning edge OOS when the feature genuinely separates outcomes", () => {
    // 300 trades: feature-ON wins 80%, feature-OFF wins 20% — mixed together
    // the pool is 50/50 (negative after asymmetric R? wins +2R, losses −1R:
    // baseline pool expectancy ≈ +0.5R so baseline takes everything).
    const trades: Trade[] = [];
    for (let i = 0; i < 300; i++) {
      const on = i % 2 === 0;
      const win = on ? i % 10 < 8 : i % 10 >= 8;
      trades.push(trade(i, win, { absorptionBull: on }));
    }
    const [baseline, absorption] = runAblation(trades, { ...DEFAULT_ABLATION_CONFIG, minSampleN: 10 });
    expect(baseline.variant).toBe("baseline");
    expect(absorption.variant).toBe("absorption");
    // Conditioned variant should refuse the feature-off half and beat baseline.
    expect(absorption.taken).toBeLessThan(baseline.taken);
    expect(absorption.expectancyR).toBeGreaterThan(baseline.expectancyR);
    // Separation is reported with a CI on the full OOS set.
    expect(absorption.pFeatureOn).toBeGreaterThan(absorption.pAll);
    expect(absorption.nFeatureOn).toBe(150);
  });

  it("takes nothing when no cell clears the conservative expectancy floor", () => {
    // All losers: every cell's avgR is negative — every variant must sit out.
    const trades = Array.from({ length: 100 }, (_, i) => trade(i, false));
    for (const m of runAblation(trades, { ...DEFAULT_ABLATION_CONFIG, minSampleN: 10 })) {
      expect(m.taken).toBe(0);
      expect(m.expectancyR).toBe(0);
    }
  });

  it("handles an empty trade list without dividing by zero", () => {
    const res = runAblation([], DEFAULT_ABLATION_CONFIG);
    expect(res).toHaveLength(4);
    expect(res[0].taken).toBe(0);
  });

  it("cost stress reduces expectancy monotonically", () => {
    const trades: Trade[] = [];
    for (let i = 0; i < 200; i++) trades.push(trade(i, i % 10 < 7)); // 70% winners
    const base = runAblation(trades, { ...DEFAULT_ABLATION_CONFIG, minSampleN: 10 }, 1)[0];
    const stressed = runAblation(trades, { ...DEFAULT_ABLATION_CONFIG, minSampleN: 10 }, 2)[0];
    expect(base.taken).toBeGreaterThan(0);
    expect(stressed.expectancyR).toBeLessThan(base.expectancyR);
  });
});
