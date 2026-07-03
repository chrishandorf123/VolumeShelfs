import { describe, expect, it } from "vitest";
import type { Candle } from "./types";
import { anomalyScan } from "./anomaly";
import { institutionalRead } from "./institutional";

/** Bars from {c, v, o?, h?, l?}; defaults to near-doji around the close. */
function bars(rows: Array<{ c: number; v: number; o?: number; h?: number; l?: number }>): Candle[] {
  let t = Date.UTC(2025, 0, 2) / 1000;
  return rows.map((r) => {
    const open = r.o ?? r.c;
    return {
      time: (t += 86400),
      open,
      high: r.h ?? Math.max(open, r.c) * 1.003,
      low: r.l ?? Math.min(open, r.c) * 0.997,
      close: r.c,
      volume: r.v,
    };
  });
}

type Row = { c: number; v: number; o?: number; h?: number; l?: number };
const flat = (n: number, c = 100, v = 1_000_000): Row[] => Array.from({ length: n }, () => ({ c, v }));

describe("anomalyScan — predatory tape", () => {
  it("flags a pump-shaped parabola as SKETCHY/predatory", () => {
    const rows = [...flat(80)];
    for (let i = 0; i < 10; i++) rows.push({ c: 100 * Math.pow(1.05, i + 1), v: 4_000_000, o: 100 * Math.pow(1.05, i) });
    const rep = anomalyScan(bars(rows))!;
    expect(rep.flags.find((f) => f.id === "pump")?.hit).toBe(true);
    expect(rep.level).toBe("SKETCHY");
    expect(rep.character).toBe("predatory");
  });

  it("flags big moves on no volume (thin-tape mark-up)", () => {
    const rows = [...flat(80)];
    rows.push({ c: 107, v: 300_000, o: 100 });
    rows.push(...flat(5, 107));
    rows.push({ c: 114.5, v: 300_000, o: 107 });
    const rep = anomalyScan(bars(rows))!;
    expect(rep.flags.find((f) => f.id === "thin")?.hit).toBe(true);
    expect(rep.character).toBe("predatory");
  });

  it("calls a boring clean tape CLEAN", () => {
    const rep = anomalyScan(bars(flat(120)))!;
    expect(rep.level).toBe("CLEAN");
    expect(rep.character).toBe("none");
  });
});

describe("anomalyScan — smart-money games (the difference!)", () => {
  it("reads a spring (sweep + reclaim) as games-accumulation, not predatory", () => {
    const rows = [...flat(90, 100)];
    // sweep: undercuts the 100-lows to 96 intraday but closes back at 100.5
    rows.push({ c: 100.5, v: 2_500_000, o: 100, l: 96, h: 101 });
    rows.push({ c: 101, v: 1_200_000 });
    rows.push({ c: 101.5, v: 1_100_000 });
    const rep = anomalyScan(bars(rows))!;
    expect(rep.games.find((g) => g.id === "spring")?.hit).toBe(true);
    expect(rep.character).toBe("games-accumulation");
    expect(rep.level).not.toBe("SKETCHY");
    expect(rep.headline).toMatch(/worth joining/i);
  });

  it("reads heavy churn at the lows as absorption (bullish)", () => {
    const rows = [...flat(60, 120)];
    // decline to the lows...
    for (let i = 0; i < 25; i++) rows.push({ c: 120 - i * 0.8, v: 1_000_000, o: 120 - i * 0.8 + 0.5 });
    // ...then huge-volume days that go nowhere at the bottom
    rows.push({ c: 100.2, v: 2_600_000 });
    rows.push({ c: 100.1, v: 2_700_000 });
    rows.push({ c: 100.3, v: 2_500_000 });
    const rep = anomalyScan(bars(rows))!;
    expect(rep.games.find((g) => g.id === "absorb")?.hit).toBe(true);
    expect(rep.character).toBe("games-accumulation");
  });

  it("reads a failed poke above resistance as games-distribution", () => {
    const rows = [...flat(90, 100)];
    rows.push({ c: 99.4, v: 2_200_000, o: 100, h: 102.5, l: 99 }); // upthrust over the 100.3 highs
    rows.push({ c: 99.2, v: 1_000_000 });
    const rep = anomalyScan(bars(rows))!;
    expect(rep.games.find((g) => g.id === "upthrust")?.hit).toBe(true);
    expect(rep.character).toBe("games-distribution");
  });
});

describe("institutionalRead", () => {
  it("calls heavy-volume up-days with strong closes accumulation", () => {
    const rows: Array<{ c: number; v: number; o?: number; h?: number; l?: number }> = [...flat(50, 100, 1_000_000)];
    let p = 100;
    for (let i = 0; i < 25; i++) {
      const up = i % 3 !== 2;
      const c = up ? (p += 0.6) : (p -= 0.2);
      rows.push(up ? { c, v: 1_900_000, o: c - 0.6, h: c * 1.001, l: (c - 0.6) * 0.999 } : { c, v: 600_000, o: c + 0.2 });
    }
    const read = institutionalRead(bars(rows))!;
    expect(read.verdict).toBe("accumulating");
    expect(["A", "B"]).toContain(read.rating);
  });

  it("calls heavy-volume down-days distribution", () => {
    const rows: Array<{ c: number; v: number; o?: number }> = [...flat(50, 100, 1_000_000)];
    let p = 100;
    for (let i = 0; i < 25; i++) {
      const down = i % 3 !== 2;
      const c = down ? (p -= 0.6) : (p += 0.2);
      rows.push(down ? { c, v: 2_000_000, o: c + 0.6 } : { c, v: 600_000, o: c - 0.2 });
    }
    const read = institutionalRead(bars(rows))!;
    expect(read.verdict).toBe("distributing");
    expect(["D", "E"]).toContain(read.rating);
  });

  it("returns null on short history", () => {
    expect(institutionalRead(bars(flat(30)))).toBeNull();
  });
});
