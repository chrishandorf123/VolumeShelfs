import { describe, expect, it } from "vitest";
import type { Candle } from "./types";
import { anchoredVwapLast } from "./indicators";
import {
  avwapHandoff,
  buildAvwapMap,
  eventAnchors,
  indexBiggestGap,
  indexMonthOpen,
  indexQuarterOpen,
  mtfAlignment,
  stageOf,
} from "./shannon";

/**
 * Daily bars starting 2024-01-02, weekdays only, driven by a close series.
 * Bars are dojis (O=H=L=C) so swing pivots are unambiguous — carrying the
 * prior close as the open would tie neighbouring lows and suppress pivots.
 */
function candlesFrom(closes: number[], mutate?: (c: Candle, i: number) => void): Candle[] {
  const out: Candle[] = [];
  let t = Date.UTC(2024, 0, 2) / 1000;
  for (let i = 0; i < closes.length; i++) {
    // skip weekends
    while ([0, 6].includes(new Date(t * 1000).getUTCDay())) t += 86400;
    const close = closes[i];
    const c: Candle = { time: t, open: close, high: close, low: close, close, volume: 1_000_000 };
    mutate?.(c, i);
    out.push(c);
    t += 86400;
  }
  return out;
}

const rise = (n: number, start = 50, step = 0.25) =>
  Array.from({ length: n }, (_, i) => start + i * step);
const fall = (n: number, start = 200, step = 0.25) =>
  Array.from({ length: n }, (_, i) => start - i * step);

describe("calendar anchor indexes", () => {
  it("finds the first bar of the latest quarter and month", () => {
    const candles = candlesFrom(rise(400));
    const qi = indexQuarterOpen(candles);
    const mi = indexMonthOpen(candles);
    const last = new Date(candles[candles.length - 1].time * 1000);
    const q = new Date(candles[qi].time * 1000);
    const m = new Date(candles[mi].time * 1000);
    expect(q.getUTCMonth()).toBe(Math.floor(last.getUTCMonth() / 3) * 3);
    expect(m.getUTCMonth()).toBe(last.getUTCMonth());
    // and the bar before each belongs to an earlier period
    expect(new Date(candles[mi - 1].time * 1000).getUTCMonth()).not.toBe(last.getUTCMonth());
    expect(qi).toBeLessThanOrEqual(mi);
  });
});

describe("indexBiggestGap", () => {
  it("finds a deliberate gap and ignores sub-threshold noise", () => {
    const closes = rise(300, 100, 0.1);
    const candles = candlesFrom(closes, (c, i) => {
      if (i === 250) c.open = closes[249] * 1.12; // +12% gap
    });
    expect(indexBiggestGap(candles)).toBe(250);
    expect(indexBiggestGap(candlesFrom(rise(300, 100, 0.05)))).toBe(-1);
  });
});

describe("eventAnchors", () => {
  it("returns deduped anchors with valid indexes", () => {
    const candles = candlesFrom(rise(520), (c, i) => {
      if (i === 400) c.volume = 50_000_000;
    });
    const anchors = eventAnchors(candles);
    const kinds = anchors.map((a) => a.kind);
    expect(kinds).toContain("ytd");
    expect(kinds).toContain("high-volume");
    // Bar 0 is both the all-time low and the listing bar; the dedup keeps the
    // first (more specific) spec, so it surfaces as "atl", not "listing".
    expect(anchors.some((a) => a.index === 0)).toBe(true);
    expect(kinds).not.toContain("listing");
    // In a monotonic rise the 52w/ATH extremes sit at/near the end and are dropped.
    expect(kinds).not.toContain("52w-high");
    const idxs = anchors.map((a) => a.index);
    expect(new Set(idxs).size).toBe(idxs.length); // deduped
    for (const i of idxs) expect(i).toBeLessThan(candles.length - 5);
  });
});

describe("buildAvwapMap", () => {
  it("labels AVWAPs above price as supply and below as support, sorted top-down", () => {
    const candles = candlesFrom(rise(520));
    const map = buildAvwapMap(candles);
    expect(map.length).toBeGreaterThan(0);
    const price = candles[candles.length - 1].close;
    for (const row of map) {
      expect(row.state.value).toBeCloseTo(anchoredVwapLast(candles, row.anchor.index), 8);
      expect(row.role).toBe(row.state.value > price ? "supply" : "support");
    }
    for (let i = 1; i < map.length; i++)
      expect(map[i].state.value).toBeLessThanOrEqual(map[i - 1].state.value);
  });
});

describe("stageOf", () => {
  it("calls a steady uptrend Stage 2", () => {
    expect(stageOf(candlesFrom(rise(400)))?.stage).toBe(2);
  });
  it("calls a steady downtrend Stage 4", () => {
    expect(stageOf(candlesFrom(fall(400)))?.stage).toBe(4);
  });
  it("calls a flat base after a decline Stage 1", () => {
    // The flat stretch must exceed the 200-day window so the MA truly flattens;
    // a short pause below a still-falling 200-day is (correctly) Stage 4.
    const closes = [...fall(300, 200, 0.4), ...Array.from({ length: 240 }, () => 80)];
    expect(stageOf(candlesFrom(closes))?.stage).toBe(1);
  });
  it("returns null without enough history", () => {
    expect(stageOf(candlesFrom(rise(100)))).toBeNull();
  });
});

describe("mtfAlignment", () => {
  it("aligns up in an uptrend and down in a downtrend", () => {
    const up = mtfAlignment(candlesFrom(rise(500)));
    expect(up.weekly).toBe("up");
    expect(up.daily).toBe("up");
    expect(up.aligned).toBe(true);
    const dn = mtfAlignment(candlesFrom(fall(500)));
    expect(dn.aligned).toBe(true);
    expect(dn.weekly).toBe("down");
  });
});

describe("avwapHandoff", () => {
  it("is intact for stair-stepping higher lows with price on top", () => {
    // three rising legs with pullbacks -> higher swing lows
    const closes: number[] = [];
    let p = 100;
    for (let leg = 0; leg < 4; leg++) {
      for (let i = 0; i < 25; i++) closes.push((p += 1));
      for (let i = 0; i < 10; i++) closes.push((p -= 0.8));
    }
    for (let i = 0; i < 15; i++) closes.push((p += 1));
    const h = avwapHandoff(candlesFrom(closes));
    expect(h).not.toBeNull();
    expect(h!.intact).toBe(true);
    expect(h!.lows.length).toBeGreaterThanOrEqual(2);
  });

  it("is not intact when the lows step down", () => {
    const h = avwapHandoff(candlesFrom([...rise(60), ...fall(120, 65, 0.3)]));
    if (h) expect(h.intact).toBe(false);
  });
});
