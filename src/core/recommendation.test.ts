import { describe, expect, it } from "vitest";
import { recommend, type RecoContext } from "./recommendation";
import type { TradePlan } from "./tradePlan";

const base: RecoContext = {
  price: 20,
  liquidityOk: true,
  trendOk: true,
  rsOk: true,
  avwapBullish: true,
  avwapReclaim: false,
  avwapValue: 19,
  hasShelfAtPrice: true,
  idealScore: 0.7,
  gapActive: false,
};

const plan: TradePlan = {
  isGapPlay: false,
  entry: 20,
  reversalRef: 19,
  stop: 18,
  t1: 24,
  t2: 28,
  airPocket: null,
  riskPct: 0.1,
  rMultipleT1: 2,
  rMultipleT2: 4,
  notes: [],
};

describe("recommend", () => {
  it("says BUY THE DIP at a shelf in an uptrend above a rising AVWAP", () => {
    const r = recommend(base, plan);
    expect(r.verdict).toBe("buy-dip");
    expect(r.headline).toContain("Buy near");
    expect(r.confidence).toBe("high");
  });

  it("says BUY when there's an active gap play", () => {
    const r = recommend({ ...base, gapActive: true }, plan);
    expect(r.verdict).toBe("buy");
  });

  it("downgrades to WATCH when reward-to-risk is poor despite a good backdrop", () => {
    const badPlan = { ...plan, rMultipleT1: 0.1, rMultipleT2: 0.3 };
    expect(recommend(base, badPlan).verdict).toBe("watch");
  });

  it("downgrades to WATCH when the stop is very wide", () => {
    expect(recommend(base, { ...plan, riskPct: 0.2 }).verdict).toBe("watch");
  });

  it("says WAIT FOR RECLAIM when the shelf is there but price is below its AVWAP", () => {
    const r = recommend({ ...base, avwapBullish: false, avwapReclaim: false }, plan);
    expect(r.verdict).toBe("wait");
    expect(r.headline).toContain("close above");
  });

  it("says ON WATCH for a good shelf in a downtrend (falling knife)", () => {
    const r = recommend({ ...base, trendOk: false }, plan);
    expect(r.verdict).toBe("watch");
    expect(r.reasoning.join(" ")).toMatch(/200-day/);
  });

  it("says AVOID when illiquid", () => {
    const r = recommend({ ...base, liquidityOk: false }, plan);
    expect(r.verdict).toBe("avoid");
    expect(r.confidence).toBe("low");
  });

  it("says AVOID in a downtrend with no support structure", () => {
    const r = recommend(
      { ...base, trendOk: false, hasShelfAtPrice: false, gapActive: false, idealScore: 0.1 },
      null,
    );
    expect(r.verdict).toBe("avoid");
  });

  it("waits for a pullback when the trend is up but price is not at a shelf", () => {
    const r = recommend(
      { ...base, hasShelfAtPrice: false, gapActive: false, idealScore: 0.1 },
      null,
    );
    expect(r.verdict).toBe("watch");
  });
});
