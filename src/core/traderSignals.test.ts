import { describe, expect, it } from "vitest";
import { athRead, doubleSupertrendUp, obvRead, supertrendDirs } from "./traderSignals";
import type { Candle } from "./types";

function mk(specs: Array<{ c: number; v?: number }>): Candle[] {
  return specs.map((s, i) => ({
    time: 1_600_000_000 + i * 86400,
    open: i > 0 ? specs[i - 1].c : s.c,
    high: s.c * 1.01,
    low: s.c * 0.99,
    close: s.c,
    volume: s.v ?? 1_000_000,
  }));
}

describe("obvRead", () => {
  it("flags accumulation when volume flows in while price goes nowhere", () => {
    // Price oscillates flat, but up-days carry 3× the volume of down-days.
    const specs: Array<{ c: number; v: number }> = [];
    for (let i = 0; i < 80; i++) {
      const up = i % 2 === 0;
      specs.push({ c: 100 + (up ? 0.5 : -0.5), v: up ? 3_000_000 : 1_000_000 });
    }
    const read = obvRead(mk(specs))!;
    expect(read.state).toBe("accumulation");
    expect(read.obvDir).toBeGreaterThan(0.18);
    expect(Math.abs(read.priceDir)).toBeLessThanOrEqual(0.5);
  });

  it("flags a volume-less rally as a bearish divergence (the de-risk tell)", () => {
    // Price grinds up; down-days carry heavier volume (OBV bleeds).
    const specs: Array<{ c: number; v: number }> = [];
    let p = 100;
    for (let i = 0; i < 80; i++) {
      const up = i % 3 !== 0;
      p += up ? 0.8 : -0.4;
      specs.push({ c: p, v: up ? 700_000 : 2_500_000 });
    }
    const read = obvRead(mk(specs))!;
    expect(read.state).toBe("divergence");
  });

  it("confirms a healthy trend when OBV and price rise together", () => {
    const specs = Array.from({ length: 80 }, (_, i) => ({ c: 100 + i, v: 1_500_000 }));
    const read = obvRead(mk(specs))!;
    expect(read.state).toBe("confirmed");
  });

  it("returns null on insufficient history", () => {
    expect(obvRead(mk(Array.from({ length: 20 }, () => ({ c: 100 }))))).toBeNull();
  });
});

describe("supertrend", () => {
  it("reads a steady uptrend as +1 and a steady downtrend as −1", () => {
    const up = mk(Array.from({ length: 60 }, (_, i) => ({ c: 100 + i * 2 })));
    const down = mk(Array.from({ length: 60 }, (_, i) => ({ c: 220 - i * 2 })));
    const upDirs = supertrendDirs(up);
    const downDirs = supertrendDirs(down);
    expect(upDirs[upDirs.length - 1]).toBe(1);
    expect(downDirs[downDirs.length - 1]).toBe(-1);
  });

  it("double supertrend requires BOTH settings to agree up", () => {
    const up = mk(Array.from({ length: 60 }, (_, i) => ({ c: 100 + i * 2 })));
    const down = mk(Array.from({ length: 60 }, (_, i) => ({ c: 220 - i * 2 })));
    expect(doubleSupertrendUp(up)).toBe(true);
    expect(doubleSupertrendUp(down)).toBe(false);
    expect(doubleSupertrendUp(up.slice(0, 10))).toBeNull(); // too short
  });
});

describe("athRead", () => {
  it("marks strength near the all-time high and distance below it", () => {
    const near = mk(Array.from({ length: 60 }, (_, i) => ({ c: 100 + i })));
    const farSpecs = [...Array.from({ length: 60 }, (_, i) => ({ c: 100 + i })), ...Array.from({ length: 20 }, () => ({ c: 110 }))];
    const nearRead = athRead(near)!;
    const farRead = athRead(mk(farSpecs))!;
    expect(nearRead.nearAth).toBe(true);
    expect(farRead.nearAth).toBe(false);
    expect(farRead.pctFromAth).toBeGreaterThan(0.25);
  });
});
