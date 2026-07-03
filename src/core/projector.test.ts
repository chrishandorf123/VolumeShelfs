import { describe, expect, it } from "vitest";
import { projectGrowth, riskOfRuin, type EdgeModel } from "./projector";

const GOOD: EdgeModel = { winRate: 0.5, avgWinR: 2, avgLossR: -1, riskFrac: 0.01 };
const BAD: EdgeModel = { winRate: 0.4, avgWinR: 1, avgLossR: -1, riskFrac: 0.01 };

describe("projectGrowth", () => {
  it("a positive edge compounds: median above 1 and ordered bands", () => {
    const p = projectGrowth(GOOD, 100);
    expect(p.drift).toBeGreaterThan(0);
    expect(p.p50).toBeGreaterThan(1);
    expect(p.p05).toBeLessThan(p.p50);
    expect(p.p50).toBeLessThan(p.p95);
  });

  it("a negative edge shrinks the median below 1", () => {
    const p = projectGrowth(BAD, 100);
    expect(p.drift).toBeLessThan(0);
    expect(p.p50).toBeLessThan(1);
  });

  it("more trades widen the bands and compound the median", () => {
    const short = projectGrowth(GOOD, 50);
    const long = projectGrowth(GOOD, 200);
    expect(long.p50).toBeGreaterThan(short.p50);
    expect(long.p95 / long.p05).toBeGreaterThan(short.p95 / short.p05);
  });
});

describe("riskOfRuin", () => {
  it("is certain with a losing edge and zero when risking nothing", () => {
    expect(riskOfRuin(BAD)).toBe(1);
    expect(riskOfRuin({ ...GOOD, riskFrac: 0 })).toBe(0);
  });

  it("rises with risk per trade (the whole point of the 1% rule)", () => {
    const at1 = riskOfRuin({ ...GOOD, riskFrac: 0.01 });
    const at5 = riskOfRuin({ ...GOOD, riskFrac: 0.05 });
    const at10 = riskOfRuin({ ...GOOD, riskFrac: 0.1 });
    expect(at1).toBeLessThan(at5);
    expect(at5).toBeLessThan(at10);
    expect(at1).toBeLessThan(0.01); // a real edge at 1% risk almost never ruins
  });

  it("a deeper ruin barrier is harder to hit", () => {
    const m = { ...GOOD, riskFrac: 0.05 };
    expect(riskOfRuin(m, 0.25)).toBeLessThan(riskOfRuin(m, 0.75));
  });
});
