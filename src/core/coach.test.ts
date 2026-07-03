import { describe, expect, it } from "vitest";
import { nextSteps, pickTop, rankPicks, type PickInput } from "./coach";
import type { Recommendation } from "./recommendation";
import type { TradePlan } from "./tradePlan";

function reco(over: Partial<Recommendation> = {}): Recommendation {
  return {
    verdict: "buy",
    label: "BUY",
    headline: "Buy near $100, stop $94, first target $110.",
    reasoning: [],
    confidence: "high",
    ...over,
  };
}

function plan(over: Partial<TradePlan> = {}): TradePlan {
  return {
    isGapPlay: false,
    entry: 100,
    reversalRef: 95,
    stop: 94,
    t1: 110,
    t2: 120,
    airPocket: null,
    riskPct: 0.06,
    rMultipleT1: 1.6,
    rMultipleT2: 3,
    notes: [],
    ...over,
  };
}

describe("nextSteps", () => {
  it("tells a buy below trigger to set an alert and wait for the close", () => {
    const steps = nextSteps(reco(), plan(), 97);
    expect(steps[0].kind).toBe("wait");
    expect(steps[0].text).toContain("$100");
    expect(steps.some((s) => s.kind === "risk" && s.text.includes("$94"))).toBe(true);
    expect(steps.some((s) => s.text.includes("T1"))).toBe(true);
  });

  it("flags a live trigger when price is already through the entry", () => {
    const steps = nextSteps(reco(), plan(), 101);
    expect(steps[0].kind).toBe("do");
    expect(steps[0].text).toMatch(/trigger is live/i);
  });

  it("gives wait verdicts the trigger condition and pre-decided stop", () => {
    const steps = nextSteps(reco({ verdict: "wait", headline: "Buy only on a close above its AVWAP ($102)." }), plan(), 97);
    expect(steps[0].text).toMatch(/no position/i);
    expect(steps[1].text).toContain("$102");
    expect(steps.some((s) => s.kind === "risk" && s.text.includes("$94"))).toBe(true);
  });

  it("keeps watch verdicts out of the market", () => {
    const steps = nextSteps(reco({ verdict: "watch", headline: "No trade yet." }), null, 97);
    expect(steps[0].text).toMatch(/watchlist/i);
  });

  it("tells avoids to skip", () => {
    const steps = nextSteps(reco({ verdict: "avoid" }), null, 97);
    expect(steps[0].text).toMatch(/skip/i);
  });
});

describe("rankPicks / pickTop", () => {
  const mk = (over: Partial<PickInput>): PickInput => ({
    ticker: "T",
    verdict: "watch",
    confidence: "medium",
    score: 50,
    passedAll: false,
    confluencePassed: 5,
    ...over,
  });

  it("puts actionable buys above waits and watches regardless of score", () => {
    const ranked = rankPicks([
      mk({ ticker: "WATCH", verdict: "watch", score: 99 }),
      mk({ ticker: "BUY", verdict: "buy", score: 40 }),
      mk({ ticker: "WAIT", verdict: "wait", score: 80 }),
    ]);
    expect(ranked.map((p) => p.ticker)).toEqual(["BUY", "WAIT", "WATCH"]);
  });

  it("breaks verdict ties with A+ gates, then confidence, confluence, score", () => {
    const ranked = rankPicks([
      mk({ ticker: "B", verdict: "buy", passedAll: false, confidence: "high" }),
      mk({ ticker: "A", verdict: "buy", passedAll: true, confidence: "medium" }),
      mk({ ticker: "C", verdict: "buy", passedAll: false, confidence: "high", confluencePassed: 4 }),
    ]);
    expect(ranked.map((p) => p.ticker)).toEqual(["A", "B", "C"]);
  });

  it("pickTop drops avoids entirely and caps at n", () => {
    const top = pickTop(
      [
        mk({ ticker: "X", verdict: "avoid", score: 100 }),
        mk({ ticker: "A", verdict: "buy" }),
        mk({ ticker: "B", verdict: "buy-dip" }),
        mk({ ticker: "C", verdict: "wait" }),
        mk({ ticker: "D", verdict: "watch" }),
      ],
      3,
    );
    expect(top.map((p) => p.ticker)).toEqual(["A", "B", "C"]);
  });
});
