import { describe, expect, it } from "vitest";
import { monitorRow, sortMonitorRows, sortMonitorRowsBy, type MonitorRow } from "./monitor";
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

  it("expresses distance-to-entry in R units of the plan's risk", () => {
    const r = monitorRow(quote(97), plan()); // ~3.09% below entry, risk 6%
    expect(r.toEntryR).toBeCloseTo(r.toEntry / 0.06, 8);
    const noRisk = monitorRow(quote(97), plan({ riskPct: 0 }));
    expect(Number.isNaN(noRisk.toEntryR)).toBe(true);
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

describe("sortMonitorRowsBy (clickable columns)", () => {
  const named = (symbol: string, price: number, changePct = 0): MonitorRow =>
    monitorRow({ symbol, price, prevClose: price / (1 + changePct), changePct }, plan());

  it("sorts a numeric column descending (highest first) and ascending", () => {
    const rows = [named("A", 96, 0.01), named("B", 105, -0.02), named("C", 99, 0.03)];
    expect(sortMonitorRowsBy(rows, "changePct", -1).map((r) => r.symbol)).toEqual(["C", "A", "B"]);
    expect(sortMonitorRowsBy(rows, "changePct", 1).map((r) => r.symbol)).toEqual(["B", "A", "C"]);
    expect(sortMonitorRowsBy(rows, "price", -1).map((r) => r.symbol)).toEqual(["B", "C", "A"]);
  });

  it("sorts by ticker alphabetically both ways", () => {
    const rows = [named("MSFT", 96), named("AAPL", 97), named("NVDA", 98)];
    expect(sortMonitorRowsBy(rows, "symbol", 1).map((r) => r.symbol)).toEqual(["AAPL", "MSFT", "NVDA"]);
    expect(sortMonitorRowsBy(rows, "symbol", -1).map((r) => r.symbol)).toEqual(["NVDA", "MSFT", "AAPL"]);
  });

  it("sorts by status rank (most actionable first when ascending)", () => {
    const rows = [named("W", 96), named("T", 105), named("S", 90)];
    expect(sortMonitorRowsBy(rows, "status", 1).map((r) => r.status)).toEqual([
      "TRIGGERED",
      "WATCH",
      "STOPPED",
    ]);
  });

  it("sinks unknown (NaN) values to the bottom in either direction", () => {
    const noRisk = monitorRow({ symbol: "NR", price: 96, prevClose: 96, changePct: 0 }, plan({ riskPct: 0 }));
    expect(Number.isNaN(noRisk.toEntryR)).toBe(true);
    const rows = [noRisk, named("A", 96), named("B", 99)];
    // toEntry itself is finite for all three; use a synthetic NaN column instead.
    const withNaN = [{ ...named("A", 96), toT1: NaN }, named("B", 99), named("C", 105)];
    expect(sortMonitorRowsBy(withNaN, "toT1", -1).map((r) => r.symbol)).toEqual(["B", "C", "A"]);
    expect(sortMonitorRowsBy(withNaN, "toT1", 1).map((r) => r.symbol)).toEqual(["C", "B", "A"]);
    expect(rows).toHaveLength(3); // fixture used
  });

  it("does not mutate the input order", () => {
    const rows = [named("B", 105), named("A", 96)];
    sortMonitorRowsBy(rows, "symbol", 1);
    expect(rows.map((r) => r.symbol)).toEqual(["B", "A"]);
  });
});
