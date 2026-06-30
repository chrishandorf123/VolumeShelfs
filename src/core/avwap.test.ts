import { describe, expect, it } from "vitest";
import {
  computeAvwapAnchors,
  detectPinch,
  index52wHigh,
  index52wLow,
  indexAtTime,
  type AvwapAnchor,
} from "./avwap";
import type { Candle } from "./types";

const DAY = 86400;
const bar = (i: number, close: number, high = close + 1, low = close - 1): Candle => ({
  time: i * DAY,
  open: close,
  high,
  low,
  close,
  volume: 100,
});

describe("index helpers", () => {
  const candles = [bar(0, 10), bar(1, 20), bar(2, 5), bar(3, 12)];
  it("finds the highest high and lowest low", () => {
    expect(index52wHigh(candles)).toBe(1);
    expect(index52wLow(candles)).toBe(2);
  });
  it("finds the nearest bar to a timestamp", () => {
    expect(indexAtTime(candles, 2 * DAY + 100)).toBe(2);
  });
});

describe("computeAvwapAnchors", () => {
  it("produces distinct, finite anchors and drops last-bar anchors", () => {
    const candles = Array.from({ length: 60 }, (_, i) => bar(i, 10 + Math.sin(i) * 3));
    const anchors = computeAvwapAnchors(candles);
    expect(anchors.length).toBeGreaterThanOrEqual(1);
    for (const a of anchors) {
      expect(Number.isFinite(a.value)).toBe(true);
      expect(a.index).toBeLessThan(candles.length - 1);
    }
  });
});

describe("detectPinch", () => {
  const mk = (label: string, value: number): AvwapAnchor => ({ label, index: 0, value });

  it("clusters AVWAPs within tolerance and flags price inside", () => {
    const anchors = [mk("a", 100), mk("b", 101), mk("c", 130)];
    const pinch = detectPinch(anchors, 100.5, 0.03);
    expect(pinch).not.toBeNull();
    expect(pinch!.members.map((m) => m.label).sort()).toEqual(["a", "b"]);
    expect(pinch!.priceInside).toBe(true);
    expect(pinch!.spread).toBeLessThan(0.03);
  });

  it("returns null when nothing clusters", () => {
    const anchors = [mk("a", 100), mk("b", 130), mk("c", 170)];
    expect(detectPinch(anchors, 100, 0.03)).toBeNull();
  });

  it("prefers the larger cluster", () => {
    const anchors = [mk("a", 100), mk("b", 101), mk("c", 101.5), mk("d", 160)];
    const pinch = detectPinch(anchors, 101, 0.03);
    expect(pinch!.members.length).toBe(3);
  });
});
