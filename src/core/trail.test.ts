import { describe, expect, it } from "vitest";
import { trailRead } from "./trail";
import { supertrendSeries } from "./traderSignals";
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

const downThenUp = (down = 60, up = 60): Candle[] =>
  mk([
    ...Array.from({ length: down }, (_, i) => ({ c: 200 - i })),
    ...Array.from({ length: up }, (_, i) => ({ c: 200 - down + 1 + i * 1.5 })),
  ]);

describe("supertrendSeries", () => {
  it("keeps the trail on the correct side of price in each regime", () => {
    const up = mk(Array.from({ length: 60 }, (_, i) => ({ c: 100 + i * 2 })));
    const { dirs, trail } = supertrendSeries(up);
    const last = up.length - 1;
    expect(dirs[last]).toBe(1);
    expect(trail[last]).toBeLessThan(up[last].close); // trailing stop UNDER price
    const down = mk(Array.from({ length: 60 }, (_, i) => ({ c: 220 - i * 2 })));
    const d = supertrendSeries(down);
    expect(d.dirs[down.length - 1]).toBe(-1);
    expect(d.trail[down.length - 1]).toBeGreaterThan(down[down.length - 1].close);
  });
});

describe("trailRead", () => {
  it("fires ONE long after a downtrend turns up, not one per bar", () => {
    const read = trailRead(downThenUp())!;
    const longs = read.signals.filter((s) => s.side === "long");
    expect(longs.length).toBe(1);
    expect(read.state).toBe("up");
    // The long fired after the turn, once both trails + gates agreed.
    expect(longs[0].index).toBeGreaterThan(60);
  });

  it("attaches a measurable plan: stop below entry, target exactly 2R above", () => {
    const read = trailRead(downThenUp())!;
    const s = read.signals.find((x) => x.side === "long")!;
    expect(s.stop).toBeLessThan(s.entry);
    expect(s.target - s.entry).toBeCloseTo(2 * (s.entry - s.stop), 8);
    // A steady climb after entry resolves the trade as a win (or leaves it open).
    expect(["win", "open"]).toContain(s.outcome.status);
  });

  it("flips short when the trend rolls over, and closes the long", () => {
    const specs = [
      ...Array.from({ length: 60 }, (_, i) => ({ c: 100 + i * 1.5 })), // up
      ...Array.from({ length: 60 }, (_, i) => ({ c: 190 - i * 1.5 })), // down
    ];
    const read = trailRead(mk(specs))!;
    expect(read.state).toBe("down");
    const shorts = read.signals.filter((s) => s.side === "short");
    expect(shorts.length).toBe(1);
    const priorLongs = read.signals.filter((s) => s.side === "long" && s.index < shorts[0].index);
    for (const l of priorLongs) expect(l.outcome.status).not.toBe("open");
  });

  it("stays quiet in chop — flat noise produces at most the initial signal", () => {
    const specs = Array.from({ length: 120 }, (_, i) => ({ c: 100 + (i % 2 === 0 ? 0.8 : -0.8) }));
    const read = trailRead(mk(specs))!;
    expect(read.signals.length).toBeLessThanOrEqual(1);
  });

  it("masks the dots to agreement bars only (no dots = stand aside)", () => {
    const read = trailRead(downThenUp())!;
    for (let i = 0; i < read.dotsUp.length; i++) {
      // A bar never carries both an up-dot and a down-dot.
      expect(Number.isFinite(read.dotsUp[i]) && Number.isFinite(read.dotsDown[i])).toBe(false);
    }
    const upDots = read.dotsUp.filter(Number.isFinite).length;
    expect(upDots).toBeGreaterThan(10); // the up leg carries dots
  });

  it("computes replay stats once trades close, and counts skipped flips", () => {
    const specs = [
      ...Array.from({ length: 60 }, (_, i) => ({ c: 100 + i * 1.5 })),
      ...Array.from({ length: 60 }, (_, i) => ({ c: 190 - i * 1.5 })),
      ...Array.from({ length: 60 }, (_, i) => ({ c: 100 + i * 1.5 })),
    ];
    const read = trailRead(mk(specs))!;
    expect(read.stats).not.toBeNull();
    expect(read.stats!.closed).toBeGreaterThan(0);
    expect(read.stats!.closed + read.stats!.open).toBe(read.signals.length);
    expect(read.skippedFlips).toBeGreaterThanOrEqual(0);
  });

  it("returns null on insufficient history", () => {
    expect(trailRead(mk(Array.from({ length: 30 }, () => ({ c: 100 }))))).toBeNull();
  });
});
