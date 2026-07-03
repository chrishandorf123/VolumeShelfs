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
  ma200: 22,
  ma50: 19,
  ma200Rising: true,
  near50ma: true,
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

  it("never lets synthetic (percent-marker) targets green-light a buy", () => {
    // Same great R numbers — but both targets are invented ±3% markers.
    const synthetic = { ...plan, t1Synthetic: true, t2Synthetic: true };
    expect(recommend(base, synthetic).verdict).toBe("watch");
    // One REAL target with good R still buys.
    expect(recommend(base, { ...plan, t2Synthetic: true }).verdict).toBe("buy-dip");
  });

  it("says WAIT FOR RECLAIM when the shelf is there but price is below its AVWAP", () => {
    // Price 20 genuinely below the AVWAP (21), matching the verdict's meaning.
    const r = recommend({ ...base, avwapBullish: false, avwapReclaim: false, avwapValue: 21 }, plan);
    expect(r.verdict).toBe("wait");
    expect(r.headline).toContain("close above");
    expect(r.headline).toContain("21"); // the AVWAP, which is overhead
  });

  it("says ON WATCH for a good shelf in a downtrend (falling knife)", () => {
    const r = recommend({ ...base, trendOk: false }, plan);
    expect(r.verdict).toBe("watch");
    expect(r.reasoning.join(" ")).toMatch(/200-day/);
  });

  it("never tells you to reclaim a level BELOW the current price", () => {
    // Downtrend: price 10.91, AVWAP 9.37 (below price), 200MA 13 (above price).
    const r = recommend(
      { ...base, trendOk: false, price: 10.91, avwapValue: 9.37, ma200: 13 },
      plan,
    );
    expect(r.verdict).toBe("watch");
    expect(r.headline).not.toContain("9.37"); // don't cite a below-price AVWAP
    expect(r.headline).toContain("13"); // cite the 200-day, which is above price
    expect(r.reasoning.join(" ")).not.toMatch(/above its AVWAP \(\$9\.37\)/);
  });

  it("explains a still-falling 200-day when price is already ABOVE the 200-day", () => {
    // The real ASST case: price 10.91, 200MA 7.03 (below price) but sloping down.
    const r = recommend(
      {
        ...base,
        trendOk: false,
        price: 10.91,
        ma200: 7.03,
        ma200Rising: false,
        near50ma: true,
        avwapValue: 6, // below price, so AVWAP is not the blocker
      },
      plan,
    );
    expect(r.verdict).toBe("watch");
    const text = `${r.headline} ${r.reasoning.join(" ")}`;
    // Must NOT claim it's below the 200-day (it isn't) …
    expect(text).not.toMatch(/below its 200-day/);
    // … nor tell you to reclaim/climb back above 7.03 (price is already above it).
    expect(text).not.toMatch(/(reclaim|climb|close back above|back above the 200-day line)[^.]*7\.03/i);
    // Must name the real reason: the 200-day is still pointing down.
    expect(text.toLowerCase()).toMatch(/sloping down|flatten/);
  });

  it("cites the 50-day as the reclaim level when above a rising 200-day but below the 50-day", () => {
    const r = recommend(
      {
        ...base,
        trendOk: false,
        price: 10.91,
        ma200: 7.03,
        ma200Rising: true,
        near50ma: false,
        ma50: 12.5, // above price — the actual overhead line
        avwapValue: 6,
      },
      plan,
    );
    expect(r.verdict).toBe("watch");
    const text = `${r.headline} ${r.reasoning.join(" ")}`;
    expect(text).toContain("12.50"); // the 50-day
    expect(text).not.toContain("7.03"); // never the below-price 200-day
    expect(text).toMatch(/50-day/);
  });

  it("downgrades a bullish setup to WATCH when price is extended (don't chase)", () => {
    const r = recommend({ ...base, chasing: true }, plan);
    expect(r.verdict).toBe("watch");
    expect(r.reasoning.join(" ").toLowerCase()).toContain("anchored mean");
    expect(r.headline.toLowerCase()).toContain("extended");
  });

  it("keeps high confidence only with broad confluence; caps a non-buy at low when empty", () => {
    expect(recommend({ ...base, confluencePassed: 8 }, plan).confidence).toBe("high");
    // An empty scorecard caps confidence at low — but only on a non-buy call.
    const watch = recommend({ ...base, trendOk: false, confluencePassed: 1 }, plan);
    expect(watch.verdict).toBe("watch");
    expect(watch.confidence).toBe("low");
  });

  it("never shows a BUY with low confidence (floors it at medium)", () => {
    const r = recommend({ ...base, confluencePassed: 1 }, plan);
    expect(r.verdict).toBe("buy-dip");
    expect(r.confidence).toBe("medium");
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
