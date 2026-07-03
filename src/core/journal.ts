/**
 * The trade journal closes the loop the rest of the app opens: scan → plan →
 * TRACK the trade you actually take → measure the outcome in R. Everything
 * here is pure (timestamps passed in) so the math is unit-testable; the UI
 * layer owns persistence.
 */
export interface PlanLevels {
  entry: number;
  stop: number;
  t1: number;
  t2: number;
}

export type Side = "long" | "short";

export interface Position {
  id: string;
  symbol: string;
  /** "long" profits when price rises; "short" when it falls. Old saved
   * positions without the field are treated as long. */
  side?: Side;
  /** Epoch ms when tracked. */
  openedAt: number;
  /** Actual fill (defaults to the plan's trigger). */
  entry: number;
  stop: number;
  t1: number;
  t2: number;
  shares: number;
  status: "open" | "closed";
  exitPrice?: number;
  closedAt?: number;
}

export function sideOf(p: Position): Side {
  return p.side === "short" ? "short" : "long";
}

/** Per-share risk the position was opened with (the definition of 1R). */
export function riskPerShare(p: Position): number {
  return sideOf(p) === "short" ? p.stop - p.entry : p.entry - p.stop;
}

export function openPosition(
  symbol: string,
  plan: PlanLevels,
  shares: number,
  now: number,
  fillPrice = plan.entry,
  side: Side = "long",
): Position {
  return {
    id: `${symbol}-${now}`,
    symbol: symbol.toUpperCase(),
    side,
    openedAt: now,
    entry: fillPrice,
    stop: plan.stop,
    t1: plan.t1,
    t2: plan.t2,
    shares: Math.max(1, Math.floor(shares) || 1),
    status: "open",
  };
}

export function closePosition(p: Position, exitPrice: number, now: number): Position {
  return { ...p, status: "closed", exitPrice, closedAt: now };
}

export interface Mark {
  /** Open (or realized) P&L in dollars. */
  pnl: number;
  /** P&L as a fraction of entry. */
  pnlPct: number;
  /** P&L in R — units of the position's own initial risk. */
  r: number;
}

/** Mark a position to a price (live for open, exit for closed). */
export function markToMarket(p: Position, price: number): Mark {
  const risk = riskPerShare(p);
  // A short profits when price falls: flip the per-share P&L sign.
  const perShare = sideOf(p) === "short" ? p.entry - price : price - p.entry;
  return {
    pnl: perShare * p.shares,
    pnlPct: p.entry > 0 ? perShare / p.entry : 0,
    r: risk > 0 ? perShare / risk : NaN,
  };
}

/** Realized R of a closed position, or null while it's open. */
export function realizedR(p: Position): number | null {
  if (p.status !== "closed" || p.exitPrice === undefined) return null;
  return markToMarket(p, p.exitPrice).r;
}

export type Outcome = "win" | "loss" | "scratch";

/** Small moves either side of flat are scratches, not signal. */
export function outcomeOf(p: Position): Outcome | null {
  const r = realizedR(p);
  if (r === null || !Number.isFinite(r)) return null;
  if (r > 0.05) return "win";
  if (r < -0.05) return "loss";
  return "scratch";
}

/** What to do with an open position at this price — the coach, post-entry. */
export function positionAdvice(p: Position, price: number): string {
  const short = sideOf(p) === "short";
  const hitStop = short ? price >= p.stop : price <= p.stop;
  const hitT2 = short ? price <= p.t2 : price >= p.t2;
  const hitT1 = short ? price <= p.t1 : price >= p.t1;
  if (hitStop) return `Stop violated (${p.stop.toFixed(2)}) — ${short ? "cover" : "exit"} now, no averaging ${short ? "up" : "down"}.`;
  if (hitT2) return `Through T2 (${p.t2.toFixed(2)}) — take the rest or trail tight.`;
  if (hitT1) return `At T1 (${p.t1.toFixed(2)}) — ${short ? "cover part" : "trim"} and move the stop to break-even.`;
  const m = markToMarket(p, price);
  if (Number.isFinite(m.r) && m.r <= -0.5) return `Down ${Math.abs(m.r).toFixed(1)}R — nearing the stop; no adds.`;
  return `Hold — stop ${p.stop.toFixed(2)}, next objective ${p.t1.toFixed(2)}.`;
}

export interface JournalStats {
  open: number;
  /** Dollars at risk across open positions (entry→stop, before any trailing). */
  openRisk: number;
  closed: number;
  wins: number;
  losses: number;
  scratches: number;
  /** Wins / (wins + losses); scratches excluded. NaN with no decided trades. */
  winRate: number;
  avgWinR: number;
  avgLossR: number;
  /** Mean realized R across ALL closed trades — the number that must be > 0. */
  expectancyR: number;
  totalR: number;
}

export function journalStats(positions: Position[]): JournalStats {
  const open = positions.filter((p) => p.status === "open");
  const closed = positions.filter((p) => p.status === "closed");
  const rs = closed
    .map((p) => realizedR(p))
    .filter((r): r is number => r !== null && Number.isFinite(r));
  const winsR = rs.filter((r) => r > 0.05);
  const lossesR = rs.filter((r) => r < -0.05);
  const scratches = rs.length - winsR.length - lossesR.length;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    open: open.length,
    openRisk: open.reduce((sum, p) => sum + Math.max(0, riskPerShare(p)) * p.shares, 0),
    closed: closed.length,
    wins: winsR.length,
    losses: lossesR.length,
    scratches,
    winRate: winsR.length + lossesR.length > 0 ? winsR.length / (winsR.length + lossesR.length) : NaN,
    avgWinR: mean(winsR),
    avgLossR: mean(lossesR),
    expectancyR: mean(rs),
    totalR: rs.reduce((a, b) => a + b, 0),
  };
}
