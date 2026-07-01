import { describe, expect, it } from "vitest";
import { buildThesis } from "./thesis";
import { scanTicker } from "./scanner";
import { buildPhasedSeries } from "../data/universe";

describe("buildThesis", () => {
  const series = buildPhasedSeries(4, 12, [
    { bars: 40, drift: 0.0, vol: 0.015, volume: 2_000_000 },
    { bars: 120, drift: 0.006, vol: 0.02, volume: 2_000_000 },
    { bars: 30, drift: -0.003, vol: 0.02, volume: 2_000_000 },
  ]);
  const r = scanTicker({ ticker: "TEST", candles: series }, series);

  it("produces both a bull and a bear case with triggers, targets and invalidation", () => {
    const { bull, bear } = buildThesis(r);
    expect(bull.direction).toBe("bull");
    expect(bear.direction).toBe("bear");
    expect(bull.targets.length).toBeGreaterThanOrEqual(1);
    expect(bear.targets.length).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(bull.trigger)).toBe(true);
    expect(Number.isFinite(bear.trigger)).toBe(true);
  });

  it("orders bull targets above the trigger and bear targets below it", () => {
    const { bull, bear } = buildThesis(r);
    expect(bull.targets[0]).toBeGreaterThan(bull.trigger);
    expect(bull.targets[1]).toBeGreaterThan(bull.targets[0]);
    expect(bull.invalidation).toBeLessThan(bull.trigger);

    expect(bear.targets[0]).toBeLessThan(bear.trigger);
    expect(bear.targets[1]).toBeLessThan(bear.targets[0]);
    expect(bear.invalidation).toBeGreaterThan(bear.trigger);
  });

  it("writes plain-English detail for each side", () => {
    const { bull, bear } = buildThesis(r);
    expect(bull.detail.toLowerCase()).toContain("bull case");
    expect(bear.detail.toLowerCase()).toContain("bear case");
  });
});

describe("scanTicker confirmation", () => {
  const up = buildPhasedSeries(9, 10, [
    { bars: 60, drift: 0.0, vol: 0.015, volume: 2_000_000 },
    { bars: 180, drift: 0.006, vol: 0.02, volume: 2_000_000 },
  ]);
  const r = scanTicker({ ticker: "UP", candles: up }, up);

  it("attaches a confirmation read with MACD / RSI / %-range and notes", () => {
    expect(r.confirmation).toBeDefined();
    expect(Number.isFinite(r.confirmation.rsi.value)).toBe(true);
    expect(r.confirmation.pctRange).toBeGreaterThanOrEqual(0);
    expect(r.confirmation.pctRange).toBeLessThanOrEqual(1);
    expect(r.confirmation.notes.length).toBeGreaterThan(0);
  });
});
