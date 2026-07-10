import { describe, expect, it } from "vitest";
import type { Candle } from "./types";
import {
  computeSignals,
  detectRoundtrip,
  heisenbergRead,
  nearestRoundNumber,
  unfilledGaps,
} from "./heisenberg";

const DAY = 86_400;

function bar(i: number, open: number, high: number, low: number, close: number, volume = 1_000_000): Candle {
  return { time: 1_600_000_000 + i * DAY, open, high, low, close, volume };
}

/** Flat tape around `price` with tiny noise — a neutral base to build scenarios on. */
function flatTape(bars: number, price = 100): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < bars; i++) {
    const wiggle = Math.sin(i * 1.7) * 0.4;
    const o = price + wiggle;
    const c = price - wiggle;
    out.push(bar(i, o, Math.max(o, c) + 0.5, Math.min(o, c) - 0.5, c));
  }
  return out;
}

describe("nearestRoundNumber", () => {
  it("picks magnitude-appropriate psychological levels", () => {
    expect(nearestRoundNumber(198.4).level).toBe(200);
    expect(nearestRoundNumber(1012).level).toBe(1000);
    expect(nearestRoundNumber(9.7).level).toBe(10);
  });
});

describe("unfilledGaps", () => {
  it("finds an unfilled gap-down and quotes the fill level at the prior day's low", () => {
    const c = flatTape(80, 100);
    // Gap down: yesterday low ~99.1, today high 95 < that. Never trades back up.
    const n = c.length;
    c.push(bar(n, 94, 95, 92, 93));
    c.push(bar(n + 1, 93, 94, 92, 92.5));
    const gaps = unfilledGaps(c);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].dir).toBe("down");
    expect(gaps[0].fillLevel).toBeGreaterThan(98); // prior day's low
  });

  it("drops gaps that later fill", () => {
    const c = flatTape(80, 100);
    const n = c.length;
    c.push(bar(n, 94, 95, 92, 93)); // gap down
    c.push(bar(n + 1, 93, 100.5, 92, 99.5)); // rallies through the fill level
    expect(unfilledGaps(c)).toHaveLength(0);
  });
});

describe("detectRoundtrip", () => {
  it("flags a big run that round-trips to the prior breakout level", () => {
    const c: Candle[] = [];
    // 140 bars of base under resistance 100.
    for (let i = 0; i < 140; i++) c.push(bar(i, 96, 100, 94, 97));
    // Breakout run to 125…
    for (let i = 0; i < 20; i++) {
      const p = 100 + (i + 1) * 1.25;
      c.push(bar(140 + i, p - 1, p + 1, p - 2, p));
    }
    // …then a full roundtrip back to the breakout point.
    for (let i = 0; i < 20; i++) {
      const p = 125 - (i + 1) * 1.2;
      c.push(bar(160 + i, p + 1, p + 2, p - 1, p));
    }
    const rt = detectRoundtrip(c);
    expect(rt).not.toBeNull();
    expect(rt!.level).toBeCloseTo(100, 0);
    expect(rt!.runupPct).toBeGreaterThan(0.08);
  });

  it("returns null when there was no breakout run", () => {
    expect(detectRoundtrip(flatTape(220, 100))).toBeNull();
  });
});

describe("heisenbergRead — scenario verdicts", () => {
  it("takes (or waits on) the oversold bounce after a brutal red streak into support", () => {
    const c = flatTape(240, 100);
    // 9 straight red closes, ~18% washout to the round number 80.
    let px = 100;
    for (let i = 0; i < 9; i++) {
      const drop = 2.2;
      const o = px;
      px -= drop;
      c.push(bar(c.length, o, o + 0.3, px - 1.2, px));
    }
    const read = heisenbergRead(c);
    expect(["TAKE-LONG", "WAIT"]).toContain(read.call);
    const bounce = read.setups.find((s) => s.key === "oversold-bounce");
    expect(bounce?.triggered).toBe(true);
    expect(read.signals.redStreak).toBeGreaterThanOrEqual(9);
    expect(read.signals.rsi).toBeLessThan(32);
    // A hammer close should upgrade WAIT → TAKE-LONG.
    const last = c[c.length - 1];
    c[c.length - 1] = { ...last, open: last.close - 0.2, low: last.close - 4, close: last.close + 0.4, high: last.close + 0.6 };
    const confirmed = heisenbergRead(c);
    expect(confirmed.call).toBe("TAKE-LONG");
    expect(confirmed.plan?.side).toBe("long");
    expect(confirmed.plan!.stop).toBeLessThan(confirmed.signals.price);
  });

  it("fades a parabolic melt-up — short, subway-sandwich sized", () => {
    const c = flatTape(240, 100);
    let px = 100;
    for (let i = 0; i < 9; i++) {
      const o = px;
      px *= 1.06; // +6%/day, 9 days straight — his blow-off screen
      c.push(bar(c.length, o, px + 1, o - 0.5, px));
    }
    const read = heisenbergRead(c);
    expect(read.call).toBe("TAKE-SHORT");
    expect(read.sizing.toLowerCase()).toContain("subway");
    expect(read.signals.parabolic).toBe(true);
  });

  it("blocks a fresh short when VIX is elevated (his regime rule)", () => {
    const c = flatTape(240, 100);
    let px = 100;
    for (let i = 0; i < 9; i++) {
      const o = px;
      px *= 1.06;
      c.push(bar(c.length, o, px + 1, o - 0.5, px));
    }
    const read = heisenbergRead(c, { vix: 34 });
    expect(read.call).toBe("WAIT");
    expect(read.vixGate?.blocksCall).toBe(true);
  });

  it("passes on a mid-range chart — no man's land", () => {
    const read = heisenbergRead(flatTape(240, 100));
    expect(["PASS", "STRANGLE"]).toContain(read.call);
    if (read.call === "PASS") expect(read.headline.toLowerCase()).toContain("middle");
  });

  it("flags the DARING SOULS note on a big opening gap", () => {
    const c = flatTape(240, 100);
    c.push(bar(c.length, 103.5, 104, 102.5, 103.2)); // +3.5% gap-up open
    const read = heisenbergRead(c);
    expect(read.daringSouls).toBeTruthy();
    expect(read.daringSouls!).toContain("fade");
  });

  it("throws below the 60-bar minimum", () => {
    expect(() => heisenbergRead(flatTape(30))).toThrow(/60/);
  });
});

describe("computeSignals", () => {
  it("counts streaks off closes and computes RSI analogs on the oversold side", () => {
    const c = flatTape(150, 100);
    // First oversold episode: 8 red days, then a +12% bounce.
    let px = 100;
    for (let i = 0; i < 8; i++) {
      const o = px;
      px -= 2;
      c.push(bar(c.length, o, o + 0.2, px - 0.5, px));
    }
    for (let i = 0; i < 10; i++) {
      const o = px;
      px += 1.1;
      c.push(bar(c.length, o, px + 0.5, o - 0.2, px));
    }
    // Cool-off back to neutral (wiggling, so RSI normalizes), then the CURRENT
    // oversold episode — shallower than the first so the analog can match.
    for (let i = 0; i < 30; i++) {
      const w = i % 2 === 0 ? 0.5 : -0.5;
      c.push(bar(c.length, px - w, px + 0.8, px - 0.8, px + w));
    }
    for (let i = 0; i < 8; i++) {
      const o = px;
      px -= 1.2;
      c.push(bar(c.length, o, o + 0.2, px - 0.5, px));
    }
    const s = computeSignals(c);
    expect(s.redStreak).toBeGreaterThanOrEqual(7);
    expect(s.rsi).toBeLessThan(35);
    expect(s.rsiAnalogs.length).toBeGreaterThanOrEqual(1);
    expect(s.rsiAnalogs[0].movePct).toBeGreaterThan(0.05);
  });
});
