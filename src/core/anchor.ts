import type { Candle, PriceScale } from "./types";
import { defaultAnchorHighIndex, defaultAnchorIndex } from "./swings";
import { BARS_52W, index52wHigh, index52wLow, indexAtTime } from "./avwap";
import { computeAnchoredProfile } from "./volumeProfile";
import { bestShelfAtPrice, detectHvnShelves } from "./shelves";

export type AnchorLabel =
  | "earnings"
  | "breakout"
  | "swing-low"
  | "52w-low"
  | "swing-high"
  | "52w-high";

export interface ChosenAnchor {
  index: number;
  label: AnchorLabel;
}

/** Election tuning constants (calibrated to the leader + ASST fixtures). */
const MAX_EDGE_PCT = 0.05;
const PROX_K = 20;
const MIN_SPAN_BARS = 40;
const RECLAIM = 0.02;

export function isHighAnchor(label: AnchorLabel): boolean {
  return label === "swing-high" || label === "52w-high";
}

/**
 * Find the most recent breakout bar: a close that clears the highest high of
 * the prior `lookback` bars after a consolidation. Returns -1 when none is
 * found within `searchWindow` bars of the end (or when it is too recent to
 * build a profile, i.e. fewer than `minAfter` bars follow it).
 */
export function findRecentBreakout(
  candles: Candle[],
  lookback = 50,
  searchWindow = 120,
  minAfter = 20,
): number {
  const n = candles.length;
  const lastAllowed = n - 1 - minAfter;
  const earliest = Math.max(lookback, n - searchWindow);
  for (let i = lastAllowed; i >= earliest; i--) {
    let priorHigh = -Infinity;
    for (let j = i - lookback; j < i; j++) if (candles[j].high > priorHigh) priorHigh = candles[j].high;
    const brokeOut = candles[i].close > priorHigh && candles[i - 1].close <= priorHigh;
    if (brokeOut) return i;
  }
  return -1;
}

export interface AnchorOptions {
  earningsTime?: number;
  minBars?: number;
  swingLookback?: number;
}

/**
 * Choose a per-ticker anchor following the scanner's priority: a recent
 * earnings gap (if supplied) → the major swing low that started the leg → the
 * breakout that began the advance → the 52-week low as a fallback. This is the
 * conservative fallback used when the shelf election finds nothing at price.
 */
export function chooseScanAnchor(candles: Candle[], opts: AnchorOptions = {}): ChosenAnchor {
  const minBars = opts.minBars ?? 20;
  const n = candles.length;

  if (opts.earningsTime !== undefined) {
    const idx = indexAtTime(candles, opts.earningsTime);
    if (idx <= n - 1 - minBars && idx >= 0) return { index: idx, label: "earnings" };
  }

  const swing = defaultAnchorIndex(candles, 5, minBars);
  if (swing > 0) return { index: swing, label: "swing-low" };

  const breakout = findRecentBreakout(candles, opts.swingLookback ?? 50, 120, minBars);
  if (breakout >= 0) return { index: breakout, label: "breakout" };

  return { index: index52wLow(candles), label: "52w-low" };
}

/**
 * How dominant an extreme is as the *origin* of the current structure (~[0,1]).
 * A high is a dominant origin only when price trades in the LOWER part of the
 * range (structure hangs down from it); a low is dominant when price trades in
 * the UPPER part. A high that price has since reclaimed is heavily discounted.
 */
export function significance(candles: Candle[], idx: number, kind: "high" | "low"): number {
  const n = candles.length;
  if (n === 0 || idx < 0 || idx >= n) return 0;
  const price = candles[n - 1].close;
  const barsSince = n - 1 - idx;
  const ext = kind === "high" ? candles[idx].high : candles[idx].low;
  const move = Math.abs(price - ext) / Math.max(ext, 1e-9);
  const magTerm = Math.min(1, Math.max(0, move / 0.6));
  const recTerm = Math.exp(-barsSince / 126);

  const start = Math.max(0, n - BARS_52W);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = start; i < n; i++) {
    if (candles[i].low < lo) lo = candles[i].low;
    if (candles[i].high > hi) hi = candles[i].high;
  }
  const pos = (price - lo) / Math.max(hi - lo, 1e-9);
  let sideTerm = kind === "high" ? 1 - pos : pos;

  if (kind === "high") {
    for (let i = idx; i < n; i++) {
      if (candles[i].close > ext * (1 + RECLAIM)) {
        sideTerm *= 0.25;
        break;
      }
    }
  }
  return 0.55 * sideTerm + 0.3 * magTerm + 0.15 * recTerm;
}

/** Profile/shelf parameters the anchor election needs (a subset of ScanConfig). */
export interface AnchorElectionConfig {
  rows: number;
  scale: PriceScale;
  valueAreaFraction: number;
  shelfK: number;
  shelfMinBins: number;
}

interface Candidate {
  index: number;
  label: AnchorLabel;
  priority: number;
}

/**
 * Elect the anchor whose profile best "explains" where price trades: build a
 * small candidate set {earnings, swing-low, swing-high, 52w-high, 52w-low},
 * anchor a profile from each, and pick the one whose fattest shelf sits AT
 * current price. This makes a leader (price near highs) keep its major-swing-low
 * anchor while a pullback-from-a-high (e.g. ASST) flips to the dominant high
 * whose shelf the price has fallen into. Falls back to {@link chooseScanAnchor}
 * when no candidate has a qualifying at-price shelf.
 */
export function electBestShelfAnchor(
  candles: Candle[],
  price: number,
  config: AnchorElectionConfig,
  opts: AnchorOptions = {},
): ChosenAnchor {
  const n = candles.length;
  if (n === 0) return { index: 0, label: "swing-low" };
  const minBars = opts.minBars ?? 20;
  const lookback = opts.swingLookback ?? 5;

  const raw: Candidate[] = [];
  let priority = 0;
  const add = (index: number, label: AnchorLabel) => {
    if (index >= 0) raw.push({ index, label, priority: priority++ });
  };
  if (opts.earningsTime !== undefined) add(indexAtTime(candles, opts.earningsTime), "earnings");
  add(defaultAnchorIndex(candles, lookback, minBars), "swing-low");
  add(defaultAnchorHighIndex(candles, lookback, minBars), "swing-high");
  add(index52wHigh(candles), "52w-high");
  add(index52wLow(candles), "52w-low");

  // De-dupe by index (keep highest priority) and drop too-recent anchors.
  const seen = new Set<number>();
  const candidates = raw.filter((c) => {
    if (seen.has(c.index)) return false;
    seen.add(c.index);
    const barsAfter = n - 1 - c.index;
    return barsAfter >= minBars && barsAfter >= MIN_SPAN_BARS;
  });

  let best: { index: number; label: AnchorLabel; score: number; inside: boolean; sig: number; priority: number } | null =
    null;
  for (const c of candidates) {
    const profile = computeAnchoredProfile(candles, c.index, {
      rowCount: config.rows,
      scale: config.scale,
      valueAreaFraction: config.valueAreaFraction,
    });
    const shelves = detectHvnShelves(profile, price, config.shelfK, config.shelfMinBins);
    const bs = bestShelfAtPrice(shelves, price, MAX_EDGE_PCT, PROX_K, config.shelfK);
    const score = bs ? bs.score : 0;
    const inside = bs ? bs.inside : false;
    const sig = significance(candles, c.index, isHighAnchor(c.label) ? "high" : "low");
    if (!best || isBetter({ score, inside, sig, priority: c.priority }, best)) {
      best = { index: c.index, label: c.label, score, inside, sig, priority: c.priority };
    }
  }

  if (!best || best.score <= 0) return chooseScanAnchor(candles, opts);
  return { index: best.index, label: best.label };
}

/** Election comparison: higher score, then inside, then significance, then priority. */
function isBetter(
  a: { score: number; inside: boolean; sig: number; priority: number },
  b: { score: number; inside: boolean; sig: number; priority: number },
): boolean {
  if (Math.abs(a.score - b.score) > 1e-6) return a.score > b.score;
  if (a.inside !== b.inside) return a.inside;
  if (Math.abs(a.sig - b.sig) > 1e-6) return a.sig > b.sig;
  return a.priority < b.priority;
}
