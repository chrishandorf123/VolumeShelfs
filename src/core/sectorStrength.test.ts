import { describe, expect, it } from "vitest";
import { sectorStrength, type SectorInput } from "./sectorStrength";

const mk = (ticker: string, sector: string, rs: number, trend: boolean, score = 50): SectorInput => ({
  ticker,
  sector,
  rsExcess: rs,
  trendPass: trend,
  score,
});

describe("sectorStrength", () => {
  it("ranks groups by breadth then relative strength, with leaders by score", () => {
    const rows = sectorStrength([
      mk("NVDA", "Semis", 0.12, true, 92),
      mk("AMD", "Semis", 0.08, true, 87),
      mk("INTC", "Semis", -0.05, false, 40),
      mk("XOM", "Energy", -0.02, false),
      mk("CVX", "Energy", -0.04, false),
      mk("JPM", "Financials", 0.03, true, 70),
      mk("GS", "Financials", 0.05, true, 75),
    ]);
    expect(rows[0].sector).toBe("Financials"); // 100% breadth beats Semis' 67%
    expect(rows[1].sector).toBe("Semis");
    expect(rows[2].sector).toBe("Energy");
    expect(rows[1].leaders).toEqual(["NVDA", "AMD", "INTC"]);
    expect(rows[0].breadth).toBe(1);
    expect(rows[2].breadth).toBe(0);
    expect(rows[1].avgRs).toBeCloseTo((0.12 + 0.08 - 0.05) / 3, 8);
  });

  it("drops singleton groups (no group read from one name)", () => {
    const rows = sectorStrength([
      mk("A", "Semis", 0.1, true),
      mk("B", "Semis", 0.2, true),
      mk("C", "Solo", 0.5, true),
    ]);
    expect(rows.map((r) => r.sector)).toEqual(["Semis"]);
  });
});
