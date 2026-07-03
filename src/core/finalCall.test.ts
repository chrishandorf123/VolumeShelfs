import { describe, expect, it } from "vitest";
import { finalCall, type FinalCallInput } from "./finalCall";
import type { Recommendation } from "./recommendation";
import type { TradePlan } from "./tradePlan";
import type { DisciplineReport } from "./discipline";

const BUY: Recommendation = { verdict: "buy", label: "BUY", headline: "Buy near $100.", reasoning: [], confidence: "high" };
const WAIT: Recommendation = { verdict: "wait", label: "WAIT", headline: "No trade yet — close above AVWAP first.", reasoning: [], confidence: "medium" };

const PLAN: TradePlan = {
  side: "long", isGapPlay: false, entry: 100, reversalRef: 95, stop: 94, t1: 110, t2: 120,
  airPocket: null, riskPct: 0.06, rMultipleT1: 1.6, rMultipleT2: 3, notes: [],
};
const GO_DISC: DisciplineReport = { verdict: "go", checks: [], sizeFactor: 1 };

function input(over: Partial<FinalCallInput> = {}): FinalCallInput {
  return {
    side: "long",
    reco: BUY,
    plan: PLAN,
    stage: { stage: 2, name: "Stage 2 · Markup", guidance: "", detail: "" },
    mtf: { weekly: "up", daily: "up", aligned: true, detail: "" },
    confluencePassed: 7,
    chasing: false,
    discipline: GO_DISC,
    ...over,
  };
}

describe("finalCall", () => {
  it("says GO when everything lines up, with the plan in the headline", () => {
    const fc = finalCall(input());
    expect(fc.call).toBe("GO");
    expect(fc.headline).toContain("100.00");
    expect(fc.sizeFactor).toBe(1);
  });

  it("a discipline block is an absolute NO-GO even on a perfect setup", () => {
    const fc = finalCall(input({
      discipline: { verdict: "blocked", checks: [{ id: "heat", label: "Portfolio heat", level: "fail", message: "7% heat" }], sizeFactor: 0 },
    }));
    expect(fc.call).toBe("NO-GO");
    expect(fc.reasons[0]).toContain("7% heat");
  });

  it("stage 4 vetoes longs; stage 2 vetoes shorts", () => {
    expect(finalCall(input({ stage: { stage: 4, name: "Stage 4 · Decline", guidance: "", detail: "" } })).call).toBe("NO-GO");
    expect(finalCall(input({ side: "short", stage: { stage: 2, name: "Stage 2 · Markup", guidance: "", detail: "" } })).call).toBe("NO-GO");
  });

  it("waits on an unearned trigger, chasing, or a weekly pointing the wrong way", () => {
    expect(finalCall(input({ reco: WAIT })).call).toBe("WAIT");
    expect(finalCall(input({ chasing: true })).call).toBe("WAIT");
    expect(finalCall(input({ mtf: { weekly: "down", daily: "up", aligned: false, detail: "" } })).call).toBe("WAIT");
  });

  it("downgrades to GO-HALF when discipline says half size", () => {
    const fc = finalCall(input({
      discipline: {
        verdict: "caution",
        checks: [{ id: "streak", label: "Recent form", level: "warn", message: "3 losses in a row — halve size." }],
        sizeFactor: 0.5,
      },
    }));
    expect(fc.call).toBe("GO-HALF");
    expect(fc.sizeFactor).toBe(0.5);
    expect(fc.reasons[0]).toMatch(/halve size/i);
  });

  it("no plan means no trade, whatever else says", () => {
    expect(finalCall(input({ plan: null })).call).toBe("NO-GO");
  });
});
