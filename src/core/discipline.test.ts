import { describe, expect, it } from "vitest";
import { checkDiscipline, currentLossStreak, journalDrawdownR, type DisciplineInput } from "./discipline";
import { closePosition, openPosition, type Position } from "./journal";
import type { MarketRegime } from "./regime";

const GREEN: MarketRegime = { light: "green", stage: 2, weekly: "up", detail: "bull" };
const RED: MarketRegime = { light: "red", stage: 4, weekly: "down", detail: "bear" };
const PLAN = { entry: 100, stop: 94, t1: 110, t2: 120 };
const T0 = 1_700_000_000_000;

function base(over: Partial<DisciplineInput> = {}): DisciplineInput {
  return {
    accountSize: 10_000,
    tradeRiskFrac: 0.01,
    symbol: "NEW",
    side: "long",
    rMultipleT1: 1.6,
    positions: [],
    regime: GREEN,
    ...over,
  };
}

function loss(sym: string, at: number): Position {
  return closePosition(openPosition(sym, PLAN, 10, at), 94, at + 1);
}
function win(sym: string, at: number): Position {
  return closePosition(openPosition(sym, PLAN, 10, at), 112, at + 1);
}

describe("checkDiscipline", () => {
  it("passes a clean 1% trade in a green regime", () => {
    const rep = checkDiscipline(base());
    expect(rep.verdict).toBe("go");
    expect(rep.sizeFactor).toBe(1);
    expect(rep.checks.every((c) => c.level === "pass")).toBe(true);
  });

  it("blocks risk over the 2% ceiling", () => {
    const rep = checkDiscipline(base({ tradeRiskFrac: 0.03 }));
    expect(rep.verdict).toBe("blocked");
    expect(rep.checks.find((c) => c.id === "risk")?.level).toBe("fail");
    expect(rep.sizeFactor).toBe(0);
  });

  it("blocks when portfolio heat would exceed 6%", () => {
    // 6 open positions x $100 risk = $600 open + $100 new = 7% of $10k.
    const open = Array.from({ length: 6 }, (_, i) => openPosition(`P${i}`, PLAN, 17, T0 + i)); // ~$102 each
    const rep = checkDiscipline(base({ positions: open }));
    expect(rep.checks.find((c) => c.id === "heat")?.level).toBe("fail");
    expect(rep.verdict).toBe("blocked");
  });

  it("blocks doubling into a symbol already held", () => {
    const rep = checkDiscipline(base({ positions: [openPosition("NEW", PLAN, 5, T0)] }));
    expect(rep.checks.find((c) => c.id === "dup")?.level).toBe("fail");
  });

  it("vetoes new longs in a red regime but passes shorts", () => {
    expect(checkDiscipline(base({ regime: RED })).verdict).toBe("blocked");
    const short = checkDiscipline(base({ regime: RED, side: "short" }));
    expect(short.checks.find((c) => c.id === "regime")?.level).toBe("pass");
  });

  it("halves size on a 3-loss streak (anti-martingale)", () => {
    const rep = checkDiscipline(base({ positions: [loss("A", T0), loss("B", T0 + 10), loss("C", T0 + 20)] }));
    expect(rep.verdict).toBe("caution");
    expect(rep.sizeFactor).toBe(0.5);
  });

  it("fails a trade whose first target pays under 1R", () => {
    const rep = checkDiscipline(base({ rMultipleT1: 0.7 }));
    expect(rep.checks.find((c) => c.id === "rr")?.level).toBe("fail");
    expect(rep.verdict).toBe("blocked");
  });
});

describe("tape-quality check (manipulation, both kinds)", () => {
  it("blocks predatory tape outright", () => {
    const rep = checkDiscipline(base({ tape: { level: "SKETCHY", character: "predatory" } }));
    expect(rep.checks.find((c) => c.id === "tape")?.level).toBe("fail");
    expect(rep.verdict).toBe("blocked");
  });

  it("treats accumulative games as a tell FOR a long, and against a short", () => {
    const long = checkDiscipline(base({ tape: { level: "WATCH", character: "games-accumulation" } }));
    expect(long.checks.find((c) => c.id === "tape")?.level).toBe("pass");
    const short = checkDiscipline(base({ side: "short", regime: RED, tape: { level: "WATCH", character: "games-accumulation" } }));
    expect(short.checks.find((c) => c.id === "tape")?.level).toBe("warn");
  });

  it("distribution games favor shorts and warn longs into half size", () => {
    const short = checkDiscipline(base({ side: "short", regime: RED, tape: { level: "WATCH", character: "games-distribution" } }));
    expect(short.checks.find((c) => c.id === "tape")?.level).toBe("pass");
    const long = checkDiscipline(base({ tape: { level: "WATCH", character: "games-distribution" } }));
    expect(long.checks.find((c) => c.id === "tape")?.level).toBe("warn");
    expect(long.sizeFactor).toBe(0.5);
  });

  it("skips the check entirely when no tape read is available", () => {
    expect(checkDiscipline(base()).checks.some((c) => c.id === "tape")).toBe(false);
  });
});

describe("sector-concentration check", () => {
  it("passes with room, warns at 2, blocks at 3 in the same group", () => {
    const at = (n: number) => checkDiscipline(base({ sectorExposure: { sector: "Semis", openInSector: n } }));
    expect(at(0).checks.find((c) => c.id === "sector")?.level).toBe("pass");
    expect(at(2).checks.find((c) => c.id === "sector")?.level).toBe("warn");
    const blocked = at(3);
    expect(blocked.checks.find((c) => c.id === "sector")?.level).toBe("fail");
    expect(blocked.verdict).toBe("blocked");
  });

  it("skips when sector is unknown", () => {
    const rep = checkDiscipline(base({ sectorExposure: { sector: "Other", openInSector: 5 } }));
    expect(rep.checks.some((c) => c.id === "sector")).toBe(false);
  });
});

describe("streak + drawdown helpers", () => {
  it("counts only the current tail of losses", () => {
    const ps = [win("A", T0), loss("B", T0 + 10), loss("C", T0 + 20)];
    expect(currentLossStreak(ps)).toBe(2);
    expect(currentLossStreak([loss("B", T0), win("A", T0 + 10)])).toBe(0);
  });

  it("measures peak-to-trough drawdown of cumulative R", () => {
    // +2R, +2R (peak 4R), then -1R, -1R, -1R -> 3R off the peak.
    const ps = [win("A", T0), win("B", T0 + 1), loss("C", T0 + 2), loss("D", T0 + 3), loss("E", T0 + 4)];
    expect(journalDrawdownR(ps)).toBeCloseTo(3, 6);
  });
});
