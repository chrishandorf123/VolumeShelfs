import { describe, expect, it } from "vitest";
import { monitorRow, sortMonitorRows, type MonitorRow } from "./monitor";
import type { TradePlan } from "./tradePlan";
import type { Quote } from "../data/types";

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

function quote(price: number, changePct = 0): Quote {
  return { symbol: "TEST", price, prevClose: price / (1 + changePct), changePct };
}

describe("monitorRow status classification", () => {
  it("flags WATCH when price is well below the entry trigger", () => {
    const r = monitorRow(quote(96), plan());
    expect(r.status).toBe("WATCH");
    expect(r.toEntry).toBeCloseTo((100 - 96) / 96, 6);
  });

  it("flags APPROACHING within the proximity band", () => {
    const r = monitorRow(quote(99), plan()); // ~1.0% under 100 < 1.5% band
    expect(r.status).toBe("APPROACHING");
  });

  it("flags TRIGGERED once at/above entry but under T1", () => {
    expect(monitorRow(quote(100), plan()).status).toBe("TRIGGERED");
    expect(monitorRow(quote(105), plan()).status).toBe("TRIGGERED");
  });

  it("flags T1 and T2 at the targets", () => {
    expect(monitorRow(quote(110), plan()).status).toBe("T1");
    expect(monitorRow(quote(115), plan()).status).toBe("T1");
    expect(monitorRow(quote(120), plan()).status).toBe("T2");
    expect(monitorRow(quote(130), plan()).status).toBe("T2");
  });

  it("flags STOPPED at/below invalidation — even if that overlaps nothing else", () => {
    expect(monitorRow(quote(94), plan()).status).toBe("STOPPED");
    expect(monitorRow(quote(90), plan()).status).toBe("STOPPED");
  });

  it("carries the quote's change and day through", () => {
    const q: Quote = { symbol: "AAPL", price: 100, prevClose: 98, changePct: 0.0204, day: "2026-07-01" };
    const r = monitorRow(q, plan());
    expect(r.symbol).toBe("AAPL");
    expect(r.changePct).toBeCloseTo(0.0204, 6);
    expect(r.day).toBe("2026-07-01");
  });
});

describe("sortMonitorRows", () => {
  it("floats triggered/approaching to the top and stopped to the bottom", () => {
    const rows: MonitorRow[] = [
      monitorRow(quote(90), plan()), // STOPPED
      monitorRow(quote(96), plan()), // WATCH
      monitorRow(quote(105), plan()), // TRIGGERED
      monitorRow(quote(99), plan()), // APPROACHING
    ];
    const sorted = sortMonitorRows(rows);
    expect(sorted.map((r) => r.status)).toEqual([
      "TRIGGERED",
      "APPROACHING",
      "WATCH",
      "STOPPED",
    ]);
  });

  it("does not mutate the input array", () => {
    const rows = [monitorRow(quote(90), plan()), monitorRow(quote(105), plan())];
    const before = rows.map((r) => r.status);
    sortMonitorRows(rows);
    expect(rows.map((r) => r.status)).toEqual(before);
  });
});
