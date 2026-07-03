import { describe, expect, it } from "vitest";
import type { Candle } from "./types";
import { earlySignal } from "./earlySignal";

/** Build daily bars from close/volume arrays (doji O=H=L=C unless spread). */
function bars(rows: Array<{ c: number; v: number; up?: boolean }>): Candle[] {
  let t = Date.UTC(2025, 0, 2) / 1000;
  return rows.map((r) => {
    // open below close = up day; above = down day (for pocket-pivot detection)
    const open = r.up === undefined ? r.c : r.up ? r.c * 0.99 : r.c * 1.01;
    const time = (t += 86400);
    return { time, open, high: Math.max(open, r.c) * 1.002, low: Math.min(open, r.c) * 0.998, close: r.c, volume: r.v };
  });
}

describe("earlySignal", () => {
  it("returns null on short history", () => {
    expect(earlySignal(bars(Array.from({ length: 30 }, () => ({ c: 100, v: 1e6 }))))).toBeNull();
  });

  it("scores a coiling, quietly-accumulated base as LOADING", () => {
    const rows: Array<{ c: number; v: number; up?: boolean }> = [];
    // 60 bars: noisy wide base on heavy volume...
    for (let i = 0; i < 60; i++) rows.push({ c: 95 + (i % 7), v: 2_000_000, up: i % 2 === 0 });
    // ...then 30 bars: tightening range, dried-up volume, rising lows under a 104 lid,
    // mostly up-days (OBV in), capped by a pocket-pivot volume up-day.
    for (let i = 0; i < 30; i++) {
      const base = 99 + i * 0.12; // rising floor
      rows.push({ c: Math.min(base + (i % 3) * 0.3, 103.0), v: 600_000, up: i % 4 !== 0 });
    }
    rows.push({ c: 103.0, v: 2_400_000, up: true }); // pocket pivot
    const sig = earlySignal(bars(rows))!;
    expect(sig).not.toBeNull();
    expect(sig.components.find((c) => c.id === "dryup")?.pass).toBe(true);
    expect(sig.components.find((c) => c.id === "pocket")?.pass).toBe(true);
    expect(sig.components.find((c) => c.id === "lid")?.pass).toBe(true);
    expect(sig.score).toBeGreaterThanOrEqual(60);
    expect(["LOADING", "WARMING"]).toContain(sig.grade);
  });

  it("stays QUIET on an expanding, heavy-volume downtrend", () => {
    const rows: Array<{ c: number; v: number; up?: boolean }> = [];
    for (let i = 0; i < 90; i++) rows.push({ c: 150 - i, v: 1_000_000 + i * 40_000, up: false });
    const sig = earlySignal(bars(rows))!;
    expect(sig.grade).toBe("QUIET");
    expect(sig.components.find((c) => c.id === "dryup")?.pass).toBe(false);
    expect(sig.components.find((c) => c.id === "hl")?.pass).toBe(false);
  });

  it("does not call an already-broken-out name early (the lid check)", () => {
    const rows: Array<{ c: number; v: number; up?: boolean }> = [];
    for (let i = 0; i < 80; i++) rows.push({ c: 100, v: 1_000_000 });
    for (let i = 0; i < 10; i++) rows.push({ c: 101 + i * 2, v: 900_000, up: true }); // ripping OVER the lid
    const sig = earlySignal(bars(rows))!;
    const lid = sig.components.find((c) => c.id === "lid")!;
    expect(lid.pass).toBe(false);
    expect(lid.detail).toMatch(/crowd's signal/i);
  });
});
