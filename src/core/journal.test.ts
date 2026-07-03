import { describe, expect, it } from "vitest";
import {
  closePosition,
  journalStats,
  markToMarket,
  openPosition,
  outcomeOf,
  positionAdvice,
  realizedR,
  type Position,
} from "./journal";

const PLAN = { entry: 100, stop: 94, t1: 110, t2: 120 };
const T0 = 1_700_000_000_000;

function opened(shares = 10): Position {
  return openPosition("test", PLAN, shares, T0);
}

describe("openPosition", () => {
  it("uppercases the symbol, floors shares and never sizes below 1", () => {
    const p = openPosition("aapl", PLAN, 12.7, T0);
    expect(p.symbol).toBe("AAPL");
    expect(p.shares).toBe(12);
    expect(openPosition("X", PLAN, 0, T0).shares).toBe(1);
    expect(p.status).toBe("open");
  });
});

describe("markToMarket", () => {
  it("computes P&L in dollars, percent and R", () => {
    const m = markToMarket(opened(10), 103);
    expect(m.pnl).toBeCloseTo(30, 8);
    expect(m.pnlPct).toBeCloseTo(0.03, 8);
    expect(m.r).toBeCloseTo(3 / 6, 8); // risk = 6/share -> +0.5R
  });

  it("a stop-out is exactly −1R", () => {
    expect(markToMarket(opened(), 94).r).toBeCloseTo(-1, 8);
  });
});

describe("close/realized/outcome", () => {
  it("classifies win, loss and scratch by realized R", () => {
    const win = closePosition(opened(), 110, T0 + 1);
    const loss = closePosition(opened(), 94, T0 + 1);
    const scratch = closePosition(opened(), 100.1, T0 + 1);
    expect(realizedR(win)).toBeCloseTo(10 / 6, 8);
    expect(outcomeOf(win)).toBe("win");
    expect(outcomeOf(loss)).toBe("loss");
    expect(outcomeOf(scratch)).toBe("scratch");
    expect(outcomeOf(opened())).toBeNull(); // still open
  });
});

describe("positionAdvice", () => {
  const p = opened();
  it("orders the reads: stop -> T2 -> T1 -> nearing stop -> hold", () => {
    expect(positionAdvice(p, 93)).toMatch(/exit now/i);
    expect(positionAdvice(p, 121)).toMatch(/T2/);
    expect(positionAdvice(p, 111)).toMatch(/break-even/);
    expect(positionAdvice(p, 96.9)).toMatch(/nearing the stop/i);
    expect(positionAdvice(p, 102)).toMatch(/hold/i);
  });
});

describe("short positions", () => {
  const SHORT_PLAN = { entry: 100, stop: 106, t1: 90, t2: 80 };
  const short = () => openPosition("bear", SHORT_PLAN, 10, T0, SHORT_PLAN.entry, "short");

  it("profits when price falls and is −1R at the cover-stop", () => {
    const p = short();
    expect(markToMarket(p, 94).r).toBeCloseTo(1, 8); // risk 6/share
    expect(markToMarket(p, 94).pnl).toBeCloseTo(60, 8);
    expect(markToMarket(p, 106).r).toBeCloseTo(-1, 8);
  });

  it("classifies a covered short win/loss correctly", () => {
    expect(outcomeOf(closePosition(short(), 90, T0 + 1))).toBe("win");
    expect(outcomeOf(closePosition(short(), 106, T0 + 1))).toBe("loss");
  });

  it("mirrors the advice thresholds", () => {
    const p = short();
    expect(positionAdvice(p, 107)).toMatch(/cover now/i);
    expect(positionAdvice(p, 89)).toMatch(/break-even/);
    expect(positionAdvice(p, 79)).toMatch(/T2/);
    expect(positionAdvice(p, 101)).toMatch(/hold/i);
  });
});

describe("journalStats", () => {
  it("aggregates open risk, win rate and expectancy in R", () => {
    const positions = [
      opened(10), // open: risk 6 * 10 = $60
      closePosition(opened(), 110, T0), // +10/6 R  win
      closePosition(opened(), 112, T0), // +2R      win
      closePosition(opened(), 94, T0), // −1R       loss
      closePosition(opened(), 100, T0), // 0R       scratch
    ];
    const s = journalStats(positions);
    expect(s.open).toBe(1);
    expect(s.openRisk).toBeCloseTo(60, 8);
    expect(s.closed).toBe(4);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(1);
    expect(s.scratches).toBe(1);
    expect(s.winRate).toBeCloseTo(2 / 3, 8);
    const rWin1 = 10 / 6;
    expect(s.avgWinR).toBeCloseTo((rWin1 + 2) / 2, 8);
    expect(s.avgLossR).toBeCloseTo(-1, 8);
    expect(s.expectancyR).toBeCloseTo((rWin1 + 2 - 1 + 0) / 4, 8);
    expect(s.totalR).toBeCloseTo(rWin1 + 2 - 1, 8);
  });

  it("reports NaN win rate with no decided trades", () => {
    expect(Number.isNaN(journalStats([opened()]).winRate)).toBe(true);
  });
});
