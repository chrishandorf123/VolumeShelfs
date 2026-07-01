import { describe, expect, it } from "vitest";
import { Pacer, minIntervalMs } from "./rateLimit";

describe("minIntervalMs", () => {
  it("spaces 75 calls/min at ~800ms", () => {
    expect(minIntervalMs(75)).toBe(800);
  });
  it("spaces 60 calls/min at 1000ms and falls back for bad input", () => {
    expect(minIntervalMs(60)).toBe(1000);
    expect(minIntervalMs(0)).toBe(1000);
    expect(minIntervalMs(NaN)).toBe(1000);
  });
});

describe("Pacer", () => {
  it("holds the second call for at least the interval", async () => {
    const pacer = new Pacer(60);
    const t0 = Date.now();
    await pacer.wait(); // first is immediate
    await pacer.wait(); // second waits ~60ms
    expect(Date.now() - t0).toBeGreaterThanOrEqual(55);
  });
});
