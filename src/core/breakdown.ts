import type { Position } from "./journal";
import { realizedR } from "./journal";

/**
 * The learning loop: every tracked trade snapshots WHICH signals fired at
 * entry (final call, verdict, early grade, institutional rating, tape
 * character, regime). Grouping closed trades by each dimension shows which
 * signals actually pay THIS trader on THEIR names — turning the journal from
 * a scoreboard into a coach that says "your LOADING entries earn +0.9R, your
 * yellow-regime entries lose money; trade more of the first."
 */
export interface TradeContext {
  call?: string; // GO / GO-HALF / WAIT / NO-GO (overridden)
  verdict?: string; // buy / buy-dip / wait / watch
  early?: string; // LOADING / WARMING / QUIET
  inst?: string; // A..E
  tape?: string; // predatory / games-accumulation / games-distribution / none
  regime?: string; // green / yellow / red / unknown
  side?: string; // long / short
}

const DIM_LABELS: Record<keyof TradeContext, string> = {
  call: "Final call",
  verdict: "Verdict",
  early: "Early signal",
  inst: "Institutional",
  tape: "Tape",
  regime: "Regime",
  side: "Side",
};

export interface EdgeBucket {
  dim: keyof TradeContext;
  dimLabel: string;
  bucket: string;
  n: number;
  avgR: number;
  totalR: number;
}

/** Group closed, context-tagged trades by each signal dimension. */
export function edgeBreakdown(positions: Position[]): EdgeBucket[] {
  const closed = positions.filter(
    (p): p is Position & { context: TradeContext } =>
      p.status === "closed" && !!(p as Position & { context?: TradeContext }).context,
  );
  const out: EdgeBucket[] = [];
  for (const dim of Object.keys(DIM_LABELS) as Array<keyof TradeContext>) {
    const groups = new Map<string, number[]>();
    for (const p of closed) {
      const bucket = (p.context as TradeContext)[dim];
      if (!bucket) continue;
      const r = realizedR(p);
      if (r === null || !Number.isFinite(r)) continue;
      const arr = groups.get(bucket) ?? [];
      arr.push(r);
      groups.set(bucket, arr);
    }
    for (const [bucket, rs] of groups) {
      const totalR = rs.reduce((a, b) => a + b, 0);
      out.push({ dim, dimLabel: DIM_LABELS[dim], bucket, n: rs.length, avgR: totalR / rs.length, totalR });
    }
  }
  // Within each dimension, best buckets first; dimensions keep declaration order.
  const dimOrder = Object.keys(DIM_LABELS);
  return out.sort((a, b) => {
    const d = dimOrder.indexOf(a.dim) - dimOrder.indexOf(b.dim);
    if (d !== 0) return d;
    return b.avgR - a.avgR;
  });
}
