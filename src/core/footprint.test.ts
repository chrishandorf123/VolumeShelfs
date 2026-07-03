import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOOTPRINT_CONFIG,
  computeFootprint,
  confirmedSwingAnchors,
  gapAnchors,
  volRatioSeries,
  type FootprintConfig,
} from "./footprint";
import { atrSeries } from "./indicators";
import type { Candle } from "./types";

/** Simple daily candles from close prices (range ±1%, volume settable). */
function mk(closes: number[], volumes?: number[]): Candle[] {
  return closes.map((c, i) => ({
    time: 1_600_000_000 + i * 86400,
    open: i > 0 ? closes[i - 1] : c,
    high: c * 1.01,
    low: c * 0.99,
    close: c,
    volume: volumes?.[i] ?? 1_000_000,
  }));
}

/** A V-shape with a clean swing low at index `pivot`. */
function vShape(n: number, pivot: number): number[] {
  return Array.from({ length: n }, (_, i) => 100 + Math.abs(i - pivot) * 0.8);
}

const CFG: FootprintConfig = { ...DEFAULT_FOOTPRINT_CONFIG, minLiq: 0 };

describe("anti-lookahead", () => {
  it("features at bar t are identical whether or not the future exists", () => {
    // Rich series: trend + dip + gap + volume spike, so every feature path runs.
    const closes = [...vShape(60, 30), ...Array.from({ length: 40 }, (_, i) => 124 + i * 0.5)];
    const vols = closes.map((_, i) => (i % 17 === 0 ? 3_000_000 : 1_000_000));
    const full = mk(closes, vols);
    full[70] = { ...full[70], open: full[69].close * 1.06, high: full[69].close * 1.07 }; // a gap bar
    const fullSnap = computeFootprint(full, CFG);
    for (const t of [35, 50, 69, 71, 85, full.length - 1]) {
      const prefixSnap = computeFootprint(full.slice(0, t + 1), CFG);
      expect(prefixSnap[t]).toEqual(fullSnap[t]); // no value at t may depend on t+1..
    }
  });

  it("pivot anchors activate only at pivot_bar + k, never retroactively", () => {
    const k = DEFAULT_FOOTPRINT_CONFIG.pivotK;
    const candles = mk(vShape(40, 20));
    const pivots = confirmedSwingAnchors(candles, k).filter((a) => a.kind === "pivot-low");
    const low = pivots.find((a) => a.anchorBar === 20);
    expect(low).toBeDefined();
    expect(low!.confirmedAtBar).toBe(20 + k);
    // And the snapshot exposes no active AVWAP from that pivot before then:
    // build a series with ONLY the pivot anchor family possible (no gaps, and
    // strip year-open by keeping all bars in one year — mk() does).
    const snaps = computeFootprint(candles, CFG);
    // At the pivot bar itself the pivot cannot be known: the anchor count must
    // not jump until confirmedAtBar. (Year-open contributes 1 from bar 0.)
    const countAt = (t: number) => snaps[t].activeAvwaps;
    expect(countAt(20 + k)).toBeGreaterThan(countAt(20 + k - 1));
  });

  it("volume ratio uses a trailing window that EXCLUDES the current bar", () => {
    const vols = Array.from({ length: 30 }, () => 1000);
    vols[25] = 5000; // spike
    const r = volRatioSeries(mk(vShape(30, 15), vols), 20);
    expect(r[25]).toBeCloseTo(5, 5); // 5000 / avg(1000×20) — spike NOT in its own MA
  });
});

describe("absorption", () => {
  it("fires bull absorption on heavy volume + compressed range + strong close at a level", () => {
    const closes = [...vShape(50, 25).map(() => 100), 100.1];
    const vols = closes.map(() => 1_000_000);
    vols[closes.length - 1] = 3_000_000; // 3× volume
    const candles = mk(closes, vols);
    const t = candles.length - 1;
    // Tight bar closing on its high, right at the 100 level.
    candles[t] = { ...candles[t], open: 100, high: 100.12, low: 99.95, close: 100.11 };
    const snaps = computeFootprint(candles, CFG, { levelsAt: () => [100] });
    expect(snaps[t].volRatio).toBeGreaterThanOrEqual(CFG.volMult);
    expect(snaps[t].rangeRatio).toBeLessThanOrEqual(CFG.rangeMax);
    expect(snaps[t].closeLoc).toBeGreaterThanOrEqual(CFG.closeLocMin);
    expect(snaps[t].absorptionBull).toBe(true);
    expect(snaps[t].absorptionScore).toBeGreaterThan(0);
    // Same bar, but the nearest level is far away → the gate must NOT fire.
    const far = computeFootprint(candles, CFG, { levelsAt: () => [90] });
    expect(far[t].absorptionBull).toBe(false);
  });

  it("returns false (never NaN/crash) on a zero-range bar and sets closeLoc 0.5", () => {
    const candles = mk(vShape(40, 20));
    const t = 30;
    candles[t] = { ...candles[t], open: 110, high: 110, low: 110, close: 110 };
    const snaps = computeFootprint(candles, CFG);
    expect(snaps[t].closeLoc).toBe(0.5);
    expect(snaps[t].absorptionBull).toBe(false);
    expect(snaps[t].absorptionBear).toBe(false);
  });

  it("gates off entirely on an illiquid symbol (avg volume below MIN_LIQ)", () => {
    const closes = vShape(50, 25);
    const vols = closes.map(() => 50_000); // thin
    vols[45] = 200_000; // even a 4× spike
    const candles = mk(closes, vols);
    candles[45] = { ...candles[45], open: 120, high: 120.2, low: 119.9, close: 120.19 };
    const snaps = computeFootprint(candles, { ...CFG, minLiq: 100_000 });
    expect(snaps[45].absorptionBull).toBe(false);
    expect(Number.isNaN(snaps[45].absorptionScore)).toBe(true);
  });
});

describe("AVWAP reclaim / defense", () => {
  /** Down into a pivot low, then a sharp recovery that crosses the AVWAPs. */
  function reclaimFixture(): Candle[] {
    const closes: number[] = [];
    for (let i = 0; i < 30; i++) closes.push(110 - i * 0.8); // decline
    for (let i = 0; i < 12; i++) closes.push(86 + i * 0.2); // basing below
    for (let i = 0; i < 10; i++) closes.push(88.4 + i * 2.2); // sharp recovery
    const vols = closes.map((_, i) => (i >= 42 ? 2_000_000 : 1_000_000)); // volume on recovery
    return mk(closes, vols);
  }

  it("fires a reclaim on the fresh cross, with barsBelowPrior recorded", () => {
    const snaps = computeFootprint(reclaimFixture(), CFG);
    const reclaimBars = snaps.map((s, i) => (s.reclaim ? i : -1)).filter((i) => i >= 0);
    expect(reclaimBars.length).toBeGreaterThan(0);
    const first = snaps[reclaimBars[0]];
    expect(first.barsBelowPrior).toBeGreaterThan(0); // spent time below before crossing
    expect(first.reclaimCount).toBeGreaterThanOrEqual(1);
  });

  it("reclaim-and-hold fires holdBars after the cross, not on it", () => {
    const snaps = computeFootprint(reclaimFixture(), { ...CFG, holdBars: 2, reclaimVolMult: 0 });
    const crossBar = snaps.findIndex((s) => s.reclaim);
    const holdBar = snaps.findIndex((s) => s.reclaimHold);
    expect(crossBar).toBeGreaterThan(0);
    expect(holdBar).toBeGreaterThan(crossBar); // strictly later
  });

  it("never reads an anchor's AVWAP before confirmedAtBar — crossings pre-confirmation are invisible", () => {
    // One synthetic anchor, accumulating from bar 0 but only KNOWABLE at 10.
    // Price crosses the AVWAP up at ~bar 5 (pre-confirmation) and again at ~15.
    const closes = [100, 99, 98, 97, 96, 103, 104, 103.5, 96, 95, 94, 93, 92, 91, 90, 108, 109, 110, 111, 112];
    const snaps = computeFootprint(mk(closes), { ...CFG, reclaimVolMult: 0 }, {
      anchors: [{ anchorBar: 0, confirmedAtBar: 10, kind: "event" }],
    });
    // Before confirmation: the anchor does not exist for the features.
    for (let t = 0; t < 10; t++) {
      expect(snaps[t].activeAvwaps).toBe(0);
      expect(snaps[t].reclaim || snaps[t].loss || snaps[t].defense).toBe(false);
      expect(Number.isNaN(snaps[t].distAtr)).toBe(true);
    }
    // At t=10 the anchor activates, but t−1 is pre-confirmation → unreadable
    // prior side → still no cross signal ON the activation bar.
    expect(snaps[10].activeAvwaps).toBe(1);
    expect(snaps[10].reclaim).toBe(false);
    // The post-confirmation cross (bar 15) IS seen.
    const later = snaps.slice(11).some((s) => s.reclaim);
    expect(later).toBe(true);
  });

  it("distAtr is NaN when no AVWAP is active yet", () => {
    // Empty candles edge: nothing active on bar 0 before year-open activates?
    // Year-open activates AT bar 0, so distAtr needs ATR warm-up instead.
    const snaps = computeFootprint(mk(vShape(6, 3)), CFG);
    expect(Number.isNaN(snaps[0].distAtr)).toBe(true); // ATR not warm — no fake number
  });

  it("defense fires on a successful test of a rising AVWAP, and is not a reclaim", () => {
    // Hold above a flat base AVWAP, dip the LOW to it intrabar, close back above.
    const closes = [...Array.from({ length: 40 }, () => 100), ...Array.from({ length: 10 }, () => 104)];
    const candles = mk(closes);
    const t = 45;
    candles[t] = { ...candles[t], open: 104, high: 104.5, low: 100.2, close: 104.2 };
    const snaps = computeFootprint(candles, { ...CFG, touchTol: 0.005 });
    expect(snaps[t].defense).toBe(true);
    expect(snaps[t].reclaim).toBe(false);
  });
});

describe("gap anchors", () => {
  it("registers a gap only when the open clears GAP_ATR × ATR", () => {
    const candles = mk(vShape(40, 20));
    const atr = atrSeries(candles, 14);
    candles[30] = { ...candles[30], open: candles[29].close + atr[29] * 2, high: candles[29].close + atr[29] * 2.2 };
    const gaps = gapAnchors(candles, atr, DEFAULT_FOOTPRINT_CONFIG.gapAtr);
    expect(gaps.some((g) => g.anchorBar === 30 && g.confirmedAtBar === 30)).toBe(true);
    // A normal bar is not a gap anchor.
    expect(gaps.some((g) => g.anchorBar === 15)).toBe(false);
  });
});
