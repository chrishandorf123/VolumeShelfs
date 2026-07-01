import { describe, expect, it } from "vitest";
import { confirmationPanelHtml, confluencePanelHtml, thesisPanelHtml } from "./thesis-view";
import { buildThesis, scanTicker } from "./core";
import { buildPhasedSeries } from "./data/universe";

const series = buildPhasedSeries(9, 15, [
  { bars: 60, drift: 0.0, vol: 0.015, volume: 2_000_000 },
  { bars: 180, drift: 0.006, vol: 0.02, volume: 2_000_000 },
]);
const r = scanTicker({ ticker: "V", candles: series }, series);

describe("confluencePanelHtml", () => {
  const html = confluencePanelHtml(r.confluence);
  it("shows the scorecard title, a grade, and all ten items across six tiers", () => {
    expect(html).toContain("Confluence scorecard");
    expect(html).toMatch(/grade-(Aplus|A|B|C)/);
    expect(html.match(/cf-item/g)?.length).toBe(10);
    for (const t of ["T1", "T2", "T3", "T4", "T5", "T6"]) expect(html).toContain(t);
  });
  it("shows the reversion or chasing flag consistently with the data", () => {
    if (r.confluence.chasing) expect(html).toContain("chasing");
    else if (r.confluence.reversionIntoStrength) expect(html).toContain("reversion-into-strength");
  });
});

describe("thesisPanelHtml", () => {
  const html = thesisPanelHtml(buildThesis(r));
  it("renders both directional cases with trigger / targets / invalidation", () => {
    expect(html).toContain("Bull case");
    expect(html).toContain("Bear case");
    expect(html).toContain("Trigger");
    expect(html).toContain("Targets");
    expect(html).toContain("Invalid");
  });
});

describe("confirmationPanelHtml", () => {
  const html = confirmationPanelHtml(r.confirmation);
  it("shows MACD, RSI, % range, the 5-day MA and OBV", () => {
    expect(html).toContain("MACD");
    expect(html).toContain("RSI");
    expect(html).toContain("% range");
    expect(html).toContain("5-day MA");
    expect(html).toContain("OBV");
  });
});
