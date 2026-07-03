import { describe, expect, it } from "vitest";
import { quadrantOf, rotationRead, rrgSeries } from "./rotation";
import type { Candle } from "./types";

/** Weekly candles from a close series. */
function weekly(closes: number[]): Candle[] {
  return closes.map((c, i) => ({
    time: 1_600_000_000 + i * 7 * 86400,
    open: c,
    high: c * 1.01,
    low: c * 0.99,
    close: c,
    volume: 1_000_000,
  }));
}

const N = 90;
const bench = weekly(Array.from({ length: N }, (_, i) => 100 * 1.002 ** i));

/** Accelerating outperformer: growth rate rises in the back half. */
const accel = weekly(
  Array.from({ length: N }, (_, i) => {
    let p = 100;
    for (let k = 0; k < i; k++) p *= k < N / 2 ? 1.002 : 1.007;
    return p;
  }),
);
/** Accelerating underperformer: decay steepens in the back half. */
const decel = weekly(
  Array.from({ length: N }, (_, i) => {
    let p = 100;
    for (let k = 0; k < i; k++) p *= k < N / 2 ? 1.002 : 0.997;
    return p;
  }),
);

describe("quadrantOf", () => {
  it("maps the four RRG quadrants", () => {
    expect(quadrantOf({ ratio: 101, momentum: 101 })).toBe("leading");
    expect(quadrantOf({ ratio: 101, momentum: 99 })).toBe("weakening");
    expect(quadrantOf({ ratio: 99, momentum: 99 })).toBe("lagging");
    expect(quadrantOf({ ratio: 99, momentum: 101 })).toBe("improving");
  });
});

describe("rrgSeries", () => {
  it("puts a strengthening sector above 100 and a weakening one below", () => {
    const up = rrgSeries(accel, bench);
    const down = rrgSeries(decel, bench);
    expect(up.length).toBeGreaterThan(10);
    expect(up[up.length - 1].ratio).toBeGreaterThan(100);
    expect(down[down.length - 1].ratio).toBeLessThan(100);
    expect(up[up.length - 1].ratio).toBeGreaterThan(down[down.length - 1].ratio);
  });

  it("reads a sector that tracks the benchmark exactly as neutral (100)", () => {
    const flat = rrgSeries(bench, bench);
    expect(flat[flat.length - 1].ratio).toBe(100);
  });

  it("returns empty (not garbage) when history is too short", () => {
    expect(rrgSeries(weekly([1, 2, 3]), weekly([1, 2, 3]))).toEqual([]);
  });
});

describe("rotationRead", () => {
  const input = [
    { symbol: "UP", label: "Tech", weekly: accel },
    { symbol: "DN", label: "Staples", weekly: decel },
  ];

  it("classifies the accelerating outperformer as leading, the fader as lagging", () => {
    const read = rotationRead(input, bench);
    const up = read.sectors.find((s) => s.symbol === "UP")!;
    const dn = read.sectors.find((s) => s.symbol === "DN")!;
    expect(up.quadrant).toBe("leading");
    expect(dn.quadrant).toBe("lagging");
    expect(up.rel3m).toBeGreaterThan(0);
    expect(dn.rel3m).toBeLessThan(0);
  });

  it("ranks leaders before laggards and always produces a digest", () => {
    const read = rotationRead(input, bench);
    expect(read.sectors[0].symbol).toBe("UP");
    expect(read.digest.length).toBeGreaterThan(0);
    expect(read.digest.join(" ")).toMatch(/Tech/);
  });

  it("keeps a trail of at most trailLen points ending at the current one", () => {
    const read = rotationRead(input, bench, 6);
    const up = read.sectors.find((s) => s.symbol === "UP")!;
    expect(up.trail.length).toBeLessThanOrEqual(6);
    expect(up.trail[up.trail.length - 1]).toEqual(up.point);
  });

  it("marks the read thin (and skips the sector) when history is too short", () => {
    const read = rotationRead(
      [...input, { symbol: "NEW", label: "New listing", weekly: weekly([1, 2, 3, 4]) }],
      bench,
    );
    expect(read.thin).toBe(true);
    expect(read.sectors.find((s) => s.symbol === "NEW")).toBeUndefined();
  });
});
