import { describe, expect, it } from "vitest";
import { analyzeRetracement } from "./retracement";
import type { Candle } from "./types";

/** Build candles from {c: close, v?: volume} specs. */
function mk(specs: Array<{ c: number; v?: number }>): Candle[] {
  return specs.map((s, i) => ({
    time: 1_600_000_000 + i * 86400,
    open: i > 0 ? specs[i - 1].c : s.c,
    high: s.c * 1.005,
    low: s.c * 0.995,
    close: s.c,
    volume: s.v ?? 1_000_000,
  }));
}

/** 40-bar base at 100, then an impulse 100→150 over 30 bars. */
function impulse(): Array<{ c: number; v?: number }> {
  const out: Array<{ c: number; v?: number }> = [];
  for (let i = 0; i < 40; i++) out.push({ c: 100 });
  for (let i = 1; i <= 30; i++) out.push({ c: 100 + (50 * i) / 30, v: 1_500_000 });
  return out;
}

describe("analyzeRetracement", () => {
  it("grades a quiet 40% pullback as a retracement", () => {
    const specs = impulse();
    // Pull back ~40% of the leg (150 → 130) on LIGHT volume over 8 bars.
    for (let i = 1; i <= 8; i++) specs.push({ c: 150 - (20 * i) / 8, v: 600_000 });
    const read = analyzeRetracement(mk(specs))!;
    expect(read).not.toBeNull();
    expect(read.zone).toBe("healthy");
    expect(read.verdict).toBe("retracement");
    expect(read.volumeRatio).toBeLessThan(0.85);
    expect(read.fib.fib500).toBeCloseTo(150 * 1.005 - (150 * 1.005 - 100 * 0.995) * 0.5, 0);
  });

  it("flags a deep, heavy-volume breakdown as reversal risk", () => {
    const specs = impulse();
    // Give back >78.6% (150 → 108) on HEAVY volume over 20 bars.
    for (let i = 1; i <= 20; i++) specs.push({ c: 150 - (42 * i) / 20, v: 2_600_000 });
    const read = analyzeRetracement(mk(specs))!;
    expect(read.zone).toBe("beyond");
    expect(read.verdict).toBe("reversal-risk");
    expect(read.brokePriorLow || read.lowerHighs || read.belowImpulseAvwap).toBe(true);
    expect(read.reasons.join(" ")).toMatch(/78\.6%|HEAVY/);
  });

  it("reports no-pullback at the highs (with the fib ladder still drawn)", () => {
    const read = analyzeRetracement(mk(impulse()))!;
    expect(read.verdict).toBe("no-pullback");
    expect(read.fib.fib382).toBeLessThan(read.fib.high);
    expect(read.fib.fib618).toBeLessThan(read.fib.fib500);
  });

  it("returns null when the last leg is too small to grade", () => {
    // 2% wiggle — not an impulse.
    const specs = Array.from({ length: 80 }, (_, i) => ({ c: 100 + Math.sin(i / 5) }));
    expect(analyzeRetracement(mk(specs))).toBeNull();
  });

  it("returns null on insufficient history", () => {
    expect(analyzeRetracement(mk(Array.from({ length: 10 }, () => ({ c: 100 }))))).toBeNull();
  });

  it("keeps the invalidation at the 78.6% line", () => {
    const specs = impulse();
    for (let i = 1; i <= 5; i++) specs.push({ c: 150 - i, v: 700_000 });
    const read = analyzeRetracement(mk(specs))!;
    expect(read.invalidation).toBeCloseTo(read.fib.fib786, 6);
    expect(read.invalidation).toBeLessThan(read.fib.fib618);
  });
});
