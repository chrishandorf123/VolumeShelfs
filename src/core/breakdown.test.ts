import { describe, expect, it } from "vitest";
import { edgeBreakdown, type TradeContext } from "./breakdown";
import { closePosition, openPosition, type Position } from "./journal";
import { proveEarlySignal } from "./signalProof";
import type { Candle } from "./types";

const PLAN = { entry: 100, stop: 94, t1: 110, t2: 120 };
const T0 = 1_700_000_000_000;

function closedWith(context: TradeContext, exit: number, at: number): Position {
  return { ...closePosition(openPosition("X", PLAN, 10, at), exit, at + 1), context } as Position & { context: TradeContext };
}

describe("edgeBreakdown", () => {
  it("groups closed trades by each tagged dimension with avg R", () => {
    const positions = [
      closedWith({ early: "LOADING", regime: "green" }, 112, T0), // +2R
      closedWith({ early: "LOADING", regime: "green" }, 106, T0 + 10), // +1R
      closedWith({ early: "QUIET", regime: "yellow" }, 94, T0 + 20), // -1R
      openPosition("OPEN", PLAN, 5, T0 + 30), // ignored: open + no context
    ];
    const buckets = edgeBreakdown(positions);
    const loading = buckets.find((b) => b.dim === "early" && b.bucket === "LOADING")!;
    expect(loading.n).toBe(2);
    expect(loading.avgR).toBeCloseTo(1.5, 6);
    const quiet = buckets.find((b) => b.dim === "early" && b.bucket === "QUIET")!;
    expect(quiet.avgR).toBeCloseTo(-1, 6);
    const green = buckets.find((b) => b.dim === "regime" && b.bucket === "green")!;
    expect(green.totalR).toBeCloseTo(3, 6);
    // within a dimension, better buckets come first
    const earlyRows = buckets.filter((b) => b.dim === "early");
    expect(earlyRows[0].bucket).toBe("LOADING");
  });

  it("returns nothing when no closed trade carries context", () => {
    expect(edgeBreakdown([openPosition("A", PLAN, 1, T0)])).toEqual([]);
  });
});

describe("proveEarlySignal", () => {
  function flatCandles(n: number): Candle[] {
    let t = Date.UTC(2024, 0, 2) / 1000;
    return Array.from({ length: n }, (_, i) => {
      const c = 100 + Math.sin(i / 9) * 2; // gentle wobble, never signals
      return { time: (t += 86400), open: c, high: c * 1.004, low: c * 0.996, close: c, volume: 1_000_000 };
    });
  }

  it("returns null without enough history", () => {
    expect(proveEarlySignal(flatCandles(100))).toBeNull();
  });

  it("samples point-in-time with sane counts and finite baseline stats", () => {
    const proof = proveEarlySignal(flatCandles(320), 20, 70, 4)!;
    expect(proof).not.toBeNull();
    expect(proof.n).toBeGreaterThan(30);
    expect(proof.nSignal).toBeLessThanOrEqual(proof.n);
    expect(Number.isFinite(proof.medianFwdBase)).toBe(true);
    expect(proof.hitRateBase).toBeGreaterThanOrEqual(0);
    expect(proof.hitRateBase).toBeLessThanOrEqual(1);
  });
});
