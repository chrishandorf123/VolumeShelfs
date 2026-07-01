import { describe, expect, it } from "vitest";
import { DEFAULT_BACKTEST_CONFIG, bucketOf, runBacktest } from "./backtest";
import { buildTables, gateAblation, wilson } from "./probabilityTable";
import { DEFAULT_SIZING, decide } from "./decide";
import { buildPhasedSeries } from "../data/universe";

describe("wilson", () => {
  it("returns [0,1] for n=0 and a tight interval for a large sample", () => {
    expect(wilson(0, 0)).toEqual([0, 1]);
    const [lo, hi] = wilson(60, 100);
    expect(lo).toBeGreaterThan(0.49);
    expect(hi).toBeLessThan(0.7);
    expect(lo).toBeLessThan(0.6);
    expect(hi).toBeGreaterThan(0.6);
  });
  it("is wider for a small sample than a large one at the same proportion", () => {
    const small = wilson(6, 10);
    const large = wilson(600, 1000);
    expect(small[1] - small[0]).toBeGreaterThan(large[1] - large[0]);
  });
});

describe("bucketOf", () => {
  it("buckets by |z|", () => {
    expect(bucketOf(-0.5)).toBe("A");
    expect(bucketOf(-1.5)).toBe("B");
    expect(bucketOf(-2.5)).toBe("C");
    expect(bucketOf(-3.5)).toBe("D");
  });
});

// A long uptrend with volatility so price repeatedly dips below its anchored
// VWAP while staying above a rising 200-day — i.e. the setup can fire.
const series = buildPhasedSeries(21, 20, [
  { bars: 130, drift: 0.004, vol: 0.02, volume: 2_000_000 },
  { bars: 320, drift: 0.003, vol: 0.03, volume: 2_000_000 },
]);
const result = runBacktest(series);

describe("runBacktest", () => {
  it("produces trades with internally consistent outcomes", () => {
    expect(result.trades.length).toBeGreaterThan(0);
    for (const t of result.trades) {
      expect(t.entryIndex).toBeLessThan(series.length);
      expect(t.perShareRisk).toBeGreaterThan(0);
      expect(t.maePct).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(t.rMultiple)).toBe(true);
      expect(t.z).toBeLessThan(0); // below break-even by construction
      // A trade can't both hit T1 first and hit the stop first.
      expect(t.hitT1 && t.hitStop).toBe(false);
    }
  });

  it("has NO lookahead: a signal is reproduced from data up to the signal bar only", () => {
    const tr = result.trades.find((t) => t.entryIndex > 260 && t.entryIndex < series.length - 60);
    expect(tr).toBeDefined();
    const signalBar = tr!.entryIndex - 1;
    // Re-run on the series TRUNCATED at the signal bar (no future bars exist).
    const trunc = runBacktest(series.slice(0, signalBar + 1));
    expect(trunc.live).not.toBeNull();
    expect(trunc.live!.index).toBe(signalBar);
    expect(trunc.live!.setupActive).toBe(true);
    expect(trunc.live!.bucket).toBe(tr!.bucket);
    expect(trunc.live!.z).toBeCloseTo(tr!.z, 6);
  });

  it("is deterministic (same input → identical trade count and first trade)", () => {
    const again = runBacktest(series);
    expect(again.trades.length).toBe(result.trades.length);
    if (result.trades.length) expect(again.trades[0].entryTime).toBe(result.trades[0].entryTime);
  });
});

describe("buildTables + decide", () => {
  const tables = buildTables(result.trades, series, DEFAULT_BACKTEST_CONFIG);

  it("produces a bucket table with N and Wilson CIs and a base-rate control", () => {
    const all = tables.byBucket.find((c) => c.bucket === "ALL")!;
    expect(all.n).toBe(result.trades.length);
    expect(all.ciT1[0]).toBeLessThanOrEqual(all.hitRateT1);
    expect(all.ciT1[1]).toBeGreaterThanOrEqual(all.hitRateT1);
    expect(all.baseRate).toBeGreaterThanOrEqual(0);
    expect(all.baseRate).toBeLessThanOrEqual(1);
  });

  it("gate ablation returns a row per gate × bucket", () => {
    expect(gateAblation(result.trades).length).toBe(5 * 4);
  });

  it("STANDS ASIDE when the setup is not active", () => {
    const flat = buildPhasedSeries(5, 20, [{ bars: 300, drift: -0.01, vol: 0.02, volume: 1_000_000 }]);
    const dr = runBacktest(flat);
    if (dr.live) {
      const rec = decide(dr.live, buildTables(dr.trades, flat, DEFAULT_BACKTEST_CONFIG), DEFAULT_SIZING);
      // A pure downtrend can't be a below-break-even-in-an-uptrend TAKE.
      expect(rec.action).not.toBe("TAKE");
    }
  });

  it("never risks more than the fixed per-trade cap and returns 0 when standing aside", () => {
    if (!result.live) return;
    const rec = decide(result.live, tables, DEFAULT_SIZING);
    expect(rec.riskFrac).toBeLessThanOrEqual(DEFAULT_SIZING.maxPerTradeRisk + 1e-9);
    expect(rec.riskFrac).toBeGreaterThanOrEqual(0);
    if (rec.action === "STAND_ASIDE") expect(rec.riskFrac).toBe(0);
    expect(["TAKE", "WATCH", "STAND_ASIDE"]).toContain(rec.action);
  });
});
