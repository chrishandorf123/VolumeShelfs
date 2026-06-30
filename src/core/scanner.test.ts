import { describe, expect, it } from "vitest";
import { DEFAULT_SCAN_CONFIG, scanTicker, scanUniverse, type ScanInput } from "./scanner";
import { buildTradePlan } from "./tradePlan";
import type { Candle } from "./types";

const DAY = 86400;

/** Build a daily series from a generator of close prices with simple wicks. */
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

// A constructive setup: a V-base swing low (the leg anchor), a thin run-up
// (volume gap), then a heavy consolidation shelf the price pulls back into.
function path(i: number): number {
  if (i <= 40) return 30 + (18 - 30) * (i / 40); // decline to the major low at 18
  if (i <= 110) return 18 + (28 - 18) * ((i - 40) / 70); // run-up 18 -> 28
  if (i <= 250) return 28 + Math.sin((i - 110) / 8) * 1.0; // shelf ~27-29 (heavy)
  return 28 + 0.5 * ((i - 250) / 29); // settle ~28.5 inside the shelf
}
function shelfThenUptrend(): Candle[] {
  return makeSeries(
    280,
    path,
    (i) => (i <= 110 ? 1_000_000 : i <= 250 ? 5_000_000 : 1_200_000),
  );
}

const benchmark = makeSeries(280, (i) => 100 * Math.pow(1.0008, i), () => 1_000_000);

describe("scanTicker", () => {
  const result = scanTicker({ ticker: "TEST", candles: shelfThenUptrend() }, benchmark);

  it("returns a fully populated result", () => {
    expect(result.ticker).toBe("TEST");
    expect(Number.isFinite(result.price)).toBe(true);
    expect(result.profile.bins.length).toBe(DEFAULT_SCAN_CONFIG.rows);
    expect(result.anchor.index).toBeGreaterThanOrEqual(0);
  });

  it("computes the trend gate from the 200-day MA", () => {
    expect(result.aboveMa200).toBe(true);
    expect(result.gates.trend.pass).toBe(true);
  });

  it("detects the heavy consolidation as a support shelf at/below price", () => {
    expect(result.shelves.length).toBeGreaterThanOrEqual(1);
    expect(result.supportShelf).not.toBeNull();
    expect(result.supportShelf!.priceLow).toBeLessThanOrEqual(result.price);
    expect(result.supportShelf!.strength).toBeGreaterThan(1);
  });

  it("computes relative strength against the benchmark", () => {
    expect(Number.isFinite(result.rs.excess3mo)).toBe(true);
    expect(Number.isFinite(result.rs.rsLine)).toBe(true);
  });

  it("derives a trade plan with a stop below the shelf and ordered targets", () => {
    const plan = buildTradePlan(result)!;
    expect(plan).not.toBeNull();
    expect(plan.stop).toBeLessThan(plan.entry);
    expect(plan.t2).toBeGreaterThan(plan.t1);
    expect(plan.riskPct).toBeGreaterThan(0);
  });
});

describe("scanUniverse", () => {
  const inputs: ScanInput[] = [
    { ticker: "STRONG", candles: shelfThenUptrend() },
    { ticker: "WEAK", candles: makeSeries(300, (i) => 50 * Math.pow(0.997, i), () => 200_000) },
  ];
  const ranked = scanUniverse(inputs, benchmark);

  it("scores every candidate in 0..100", () => {
    for (const r of ranked) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });

  it("ranks the constructive setup above the broken one", () => {
    expect(ranked[0].ticker).toBe("STRONG");
  });

  it("fails liquidity/trend gates on the weak, illiquid name", () => {
    const weak = ranked.find((r) => r.ticker === "WEAK")!;
    expect(weak.gates.liquidity.pass).toBe(false);
    expect(weak.passedAll).toBe(false);
  });
});
