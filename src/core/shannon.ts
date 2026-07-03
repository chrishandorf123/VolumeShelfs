import type { Candle } from "./types";
import { anchoredVwapLast, resampleWeekly, slopeOf, smaSeries } from "./indicators";
import { avwapState, indexHighVolumeDay, type AvwapState } from "./avwapStrategy";
import { BARS_52W, index52wHigh, index52wLow, indexYtdOpen } from "./avwap";
import { detectSwings } from "./swings";

/**
 * Brian Shannon's "where to anchor" playbook (Maximum Trading Gains With
 * Anchored VWAP): anchor where a meaningful population of traders established
 * positions — calendar starts institutions benchmark from, the extremes
 * everyone remembers, the news day that changed the story, the day the most
 * shares changed hands, and the first traded bar.
 */
export type EventAnchorKind =
  | "ytd"
  | "quarter"
  | "month"
  | "ath"
  | "atl"
  | "52w-high"
  | "52w-low"
  | "gap"
  | "high-volume"
  | "listing";

export interface EventAnchor {
  kind: EventAnchorKind;
  label: string;
  index: number;
  /** The book's rationale for this anchor — shown as guidance in the UI. */
  why: string;
}

const WHY: Record<EventAnchorKind, string> = {
  ytd: "Institutional benchmark — where this year's average buyer sits.",
  quarter: "Quarter-to-date average price — funds mark performance from here.",
  month: "Month-to-date average — the read for shorter swings.",
  ath: "Everyone who ever bought the top — overhead supply until reclaimed.",
  atl: "The all-time washout — the average bottom-fisher's cost, support while above.",
  "52w-high": "Buyers of the 52-week high are trapped above — resistance until reclaimed.",
  "52w-low": "The 52-week low washout — support while price holds above it.",
  gap: "The reaction day — who's been committed (or trapped) since the news.",
  "high-volume": "Highest-volume day of the year — the biggest single transfer of shares.",
  listing: "First traded bar — every share's volume-weighted cost since listing.",
};

/** Index of the first bar of the latest calendar quarter in the data. */
export function indexQuarterOpen(candles: Candle[]): number {
  if (candles.length === 0) return 0;
  const last = new Date(candles[candles.length - 1].time * 1000);
  const qMonth = Math.floor(last.getUTCMonth() / 3) * 3;
  for (let i = candles.length - 1; i >= 0; i--) {
    const d = new Date(candles[i].time * 1000);
    if (d.getUTCFullYear() !== last.getUTCFullYear() || d.getUTCMonth() < qMonth) return i + 1;
  }
  return 0;
}

/** Index of the first bar of the latest calendar month in the data. */
export function indexMonthOpen(candles: Candle[]): number {
  if (candles.length === 0) return 0;
  const last = new Date(candles[candles.length - 1].time * 1000);
  for (let i = candles.length - 1; i >= 0; i--) {
    const d = new Date(candles[i].time * 1000);
    if (d.getUTCFullYear() !== last.getUTCFullYear() || d.getUTCMonth() !== last.getUTCMonth()) return i + 1;
  }
  return 0;
}

/**
 * Index of the biggest overnight gap (|open vs prior close|) within `window`
 * bars, or -1 when no gap clears `minGap` (fraction) — small gaps are noise,
 * not events worth anchoring to.
 */
export function indexBiggestGap(candles: Candle[], window = BARS_52W, minGap = 0.03): number {
  const n = candles.length;
  const start = Math.max(1, n - window);
  let idx = -1;
  let best = minGap;
  for (let i = start; i < n; i++) {
    const prev = candles[i - 1].close;
    if (prev <= 0) continue;
    const gap = Math.abs(candles[i].open - prev) / prev;
    if (gap >= best) {
      best = gap;
      idx = i;
    }
  }
  return idx;
}

/**
 * The full event-anchor set for the current chart. Anchors that resolve to the
 * same bar are deduped (first spec wins, so the more specific label sticks),
 * and anchors too close to the last bar are dropped (an AVWAP needs bars after
 * its anchor to mean anything).
 */
export function eventAnchors(candles: Candle[]): EventAnchor[] {
  const n = candles.length;
  if (n < 30) return [];
  const specs: Array<{ kind: EventAnchorKind; label: string; index: number }> = [
    { kind: "ath", label: "All-time high", index: index52wHigh(candles, n) },
    { kind: "atl", label: "All-time low", index: index52wLow(candles, n) },
    { kind: "52w-high", label: "52-week high", index: index52wHigh(candles) },
    { kind: "52w-low", label: "52-week low", index: index52wLow(candles) },
    { kind: "ytd", label: "Year start", index: indexYtdOpen(candles) },
    { kind: "quarter", label: "Quarter start", index: indexQuarterOpen(candles) },
    { kind: "month", label: "Month start", index: indexMonthOpen(candles) },
    { kind: "gap", label: "Biggest gap (1y)", index: indexBiggestGap(candles) },
    { kind: "high-volume", label: "Highest volume (1y)", index: indexHighVolumeDay(candles) },
    { kind: "listing", label: "First bar", index: 0 },
  ];
  const seen = new Set<number>();
  const out: EventAnchor[] = [];
  for (const s of specs) {
    if (s.index < 0 || s.index >= n - 5) continue; // need bars after the anchor
    if (seen.has(s.index)) continue;
    seen.add(s.index);
    out.push({ kind: s.kind, label: s.label, index: s.index, why: WHY[s.kind] });
  }
  return out;
}

/**
 * One rung of the AVWAP ladder: an event anchor, its current AVWAP state, and
 * its role — an AVWAP above price is supply (sellers' break-even overhead), one
 * below is support (holders are green and defend it). Shannon's core read.
 */
export interface AvwapMapRow {
  anchor: EventAnchor;
  state: AvwapState;
  role: "supply" | "support";
}

/** Ladder of all event AVWAPs sorted top-down around the current price. */
export function buildAvwapMap(candles: Candle[]): AvwapMapRow[] {
  return eventAnchors(candles)
    .map((anchor) => {
      const state = avwapState(candles, anchor.index);
      return { anchor, state, role: (state.priceAbove ? "support" : "supply") as AvwapMapRow["role"] };
    })
    .filter((r) => Number.isFinite(r.state.value))
    .sort((a, b) => b.state.value - a.state.value);
}

/** Shannon/Weinstein market stage: 1 base · 2 markup · 3 distribution · 4 decline. */
export interface MarketStage {
  stage: 1 | 2 | 3 | 4;
  name: string;
  /** What the book says to do in this stage. */
  guidance: string;
  detail: string;
}

/**
 * Classify the market stage from price vs the 200-day and its slope now vs two
 * quarters ago. Returns null when there isn't enough history (needs ~1 year of
 * dailies plus slope lookback).
 */
export function stageOf(candles: Candle[]): MarketStage | null {
  const closes = candles.map((c) => c.close);
  if (closes.length < 260) return null;
  const ma200 = smaSeries(closes, 200);
  const price = closes[closes.length - 1];
  const ma = ma200[ma200.length - 1];
  if (!Number.isFinite(ma)) return null;
  const slopeNow = slopeOf(ma200, 40, 0.005);
  // The 200-day's direction two quarters back disambiguates a flat line today:
  // flat after decline = a base forming; flat after advance = a possible top.
  const priorWindow = ma200.slice(0, Math.max(0, ma200.length - 60));
  const slopePrior = slopeOf(priorWindow, 40, 0.005);
  const above = price >= ma;

  if (slopeNow === "rising" && above) {
    return {
      stage: 2,
      name: "Stage 2 · Markup",
      guidance: "The only stage to be long. Buy pullbacks to rising AVWAPs; let winners run.",
      detail: "Price above a rising 200-day — trend and time both working for you.",
    };
  }
  if (slopeNow === "falling" && !above) {
    return {
      stage: 4,
      name: "Stage 4 · Decline",
      guidance: "Don't fish for bottoms. Overhead AVWAPs are supply — stand aside until a base forms.",
      detail: "Price below a falling 200-day — every rally starts underneath sellers' break-even.",
    };
  }
  if (slopePrior === "falling" || (slopePrior === "unknown" && !above)) {
    return {
      stage: 1,
      name: "Stage 1 · Base",
      guidance: "Watch, don't buy yet. Wait for the 200-day to turn up and price to reclaim it — that's the stage-2 handoff.",
      detail: "The decline has flattened; accumulation may be starting but isn't proven.",
    };
  }
  return {
    stage: 3,
    name: "Stage 3 · Distribution",
    guidance: "Tighten stops and take profits into strength — the easy trend money has been made.",
    detail: "The advance has stalled; the 200-day is flattening after a markup.",
  };
}

/** Higher-timeframe agreement — Shannon: trade in the weekly's direction. */
export interface MtfAlignment {
  weekly: "up" | "down" | "neutral";
  daily: "up" | "down" | "neutral";
  aligned: boolean;
  detail: string;
}

function biasOf(closes: number[], maPeriod: number, lookback: number): "up" | "down" | "neutral" {
  if (closes.length < maPeriod + lookback) return "neutral";
  const ma = smaSeries(closes, maPeriod);
  const slope = slopeOf(ma, lookback, 0.005);
  const above = closes[closes.length - 1] >= ma[ma.length - 1];
  if (above && slope !== "falling") return "up";
  if (!above && slope !== "rising") return "down";
  return "neutral";
}

/** Weekly bias (30-week MA) vs daily bias (50-day MA), and whether they agree. */
export function mtfAlignment(candles: Candle[]): MtfAlignment {
  const weeklyCloses = resampleWeekly(candles).map((c) => c.close);
  const weekly = biasOf(weeklyCloses, 30, 6);
  const daily = biasOf(candles.map((c) => c.close), 50, 10);
  const aligned = weekly === daily && weekly !== "neutral";
  const detail = aligned
    ? weekly === "up"
      ? "Weekly and daily agree to the upside — pullback buys have the wind behind them."
      : "Weekly and daily agree to the downside — long setups are counter-trend here."
    : "Timeframes disagree — trade smaller and take profits quicker until they line up.";
  return { weekly, daily, aligned, detail };
}

/**
 * The AVWAP handoff: in a healthy uptrend, each pullback makes a higher low and
 * the AVWAP anchored to the NEWEST low takes over as the working support. The
 * handoff is intact while the low-anchored AVWAPs stack upward and price holds
 * the newest one.
 */
export interface AvwapHandoff {
  /** Newest-last: the swing-low anchors the ladder is built from (max 3). */
  lows: Array<{ index: number; price: number; avwap: number }>;
  intact: boolean;
  detail: string;
}

export function avwapHandoff(candles: Candle[], lookback = 5): AvwapHandoff | null {
  const lows = detectSwings(candles, lookback)
    .filter((s) => s.kind === "low")
    .slice(-3);
  if (lows.length < 2) return null;
  const rungs = lows.map((s) => ({
    index: s.index,
    price: s.price,
    avwap: anchoredVwapLast(candles, s.index),
  }));
  const higherLows = rungs.every((r, i) => i === 0 || r.price > rungs[i - 1].price);
  const stacked = rungs.every((r, i) => i === 0 || r.avwap >= rungs[i - 1].avwap);
  const price = candles[candles.length - 1].close;
  const holdingNewest = price >= rungs[rungs.length - 1].avwap;
  const intact = higherLows && stacked && holdingNewest;
  const detail = intact
    ? `Handoff intact: ${rungs.length} rising low-anchored AVWAPs and price holding the newest (${rungs[rungs.length - 1].avwap.toFixed(2)}).`
    : !higherLows
      ? "No handoff — the swing lows aren't stepping higher yet."
      : !holdingNewest
        ? `Handoff broken — price lost the newest low's AVWAP (${rungs[rungs.length - 1].avwap.toFixed(2)}); the older anchors are the next tests below.`
        : "Handoff not stacked — the newer low's AVWAP hasn't taken over above the older one yet.";
  return { lows: rungs, intact, detail };
}

/** Everything the Shannon panel needs, computed in one pass. */
export interface ShannonRead {
  stage: MarketStage | null;
  mtf: MtfAlignment;
  map: AvwapMapRow[];
  handoff: AvwapHandoff | null;
}

export function shannonRead(candles: Candle[]): ShannonRead {
  return {
    stage: stageOf(candles),
    mtf: mtfAlignment(candles),
    map: buildAvwapMap(candles),
    handoff: avwapHandoff(candles),
  };
}
