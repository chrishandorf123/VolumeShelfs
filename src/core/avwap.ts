import type { Candle } from "./types";
import { anchoredVwapLast } from "./indicators";

/** Approx. trading bars in 52 weeks. */
export const BARS_52W = 252;

/** Index of the highest high within the last `window` bars. */
export function index52wHigh(candles: Candle[], window = BARS_52W): number {
  const n = candles.length;
  const start = Math.max(0, n - window);
  let idx = start;
  for (let i = start; i < n; i++) if (candles[i].high > candles[idx].high) idx = i;
  return idx;
}

/** Index of the lowest low within the last `window` bars. */
export function index52wLow(candles: Candle[], window = BARS_52W): number {
  const n = candles.length;
  const start = Math.max(0, n - window);
  let idx = start;
  for (let i = start; i < n; i++) if (candles[i].low < candles[idx].low) idx = i;
  return idx;
}

/** Index of the first bar of the latest calendar year present in the data. */
export function indexYtdOpen(candles: Candle[]): number {
  if (candles.length === 0) return 0;
  const lastYear = new Date(candles[candles.length - 1].time * 1000).getUTCFullYear();
  for (let i = 0; i < candles.length; i++) {
    if (new Date(candles[i].time * 1000).getUTCFullYear() === lastYear) return i;
  }
  return 0;
}

/** Nearest bar index to an epoch-seconds timestamp (e.g. an earnings date). */
export function indexAtTime(candles: Candle[], epochSeconds: number): number {
  if (candles.length === 0) return 0;
  let idx = 0;
  let best = Infinity;
  for (let i = 0; i < candles.length; i++) {
    const d = Math.abs(candles[i].time - epochSeconds);
    if (d < best) {
      best = d;
      idx = i;
    }
  }
  return idx;
}

export interface AvwapAnchor {
  label: string;
  index: number;
  value: number;
}

export interface AvwapInputs {
  /** Optional earnings date (epoch seconds) to add an earnings AVWAP. */
  earningsTime?: number;
  /** 52-week window length in bars. */
  window?: number;
}

/**
 * Compute the standard anchored-VWAP set the checklist calls for: 52-week high,
 * 52-week low, YTD open and (when supplied) last earnings. Anchors that resolve
 * to the same/last bar or produce non-finite values are dropped.
 */
export function computeAvwapAnchors(candles: Candle[], inputs: AvwapInputs = {}): AvwapAnchor[] {
  const window = inputs.window ?? BARS_52W;
  // The full anchor set Wujastyk stacks for the pinch: the all-time high/low
  // (over the loaded history), the 52-week high/low, the year open, and — when
  // supplied — last earnings. Duplicates (e.g. ATH == 52w high) are dropped
  // below, so a fresh high just collapses to one line.
  const specs: Array<{ label: string; index: number }> = [
    { label: "All-time high", index: index52wHigh(candles, candles.length) },
    { label: "All-time low", index: index52wLow(candles, candles.length) },
    { label: "52w high", index: index52wHigh(candles, window) },
    { label: "52w low", index: index52wLow(candles, window) },
    { label: "YTD open", index: indexYtdOpen(candles) },
  ];
  if (inputs.earningsTime !== undefined) {
    specs.push({ label: "Earnings", index: indexAtTime(candles, inputs.earningsTime) });
  }
  const anchors: AvwapAnchor[] = [];
  const seen = new Set<number>();
  for (const s of specs) {
    if (s.index >= candles.length - 1) continue; // not enough bars after anchor
    if (seen.has(s.index)) continue;
    seen.add(s.index);
    const value = anchoredVwapLast(candles, s.index);
    if (Number.isFinite(value)) anchors.push({ label: s.label, index: s.index, value });
  }
  return anchors;
}

export interface AvwapPinch {
  members: AvwapAnchor[];
  center: number;
  /** (max − min) / center, as a fraction. */
  spread: number;
  /** True when the current price sits within the pinch band. */
  priceInside: boolean;
}

/**
 * Detect an AVWAP "pinch": the largest cluster of AVWAPs that all sit within
 * `tolerance` (fraction) of the cluster centre. Ties broken toward the tighter
 * spread. Returns null when no two AVWAPs cluster.
 */
export function detectPinch(
  anchors: AvwapAnchor[],
  currentPrice: number,
  tolerance = 0.03,
): AvwapPinch | null {
  if (anchors.length < 2) return null;
  const sorted = [...anchors].sort((a, b) => a.value - b.value);
  let best: AvwapPinch | null = null;

  for (let i = 0; i < sorted.length; i++) {
    const group = [sorted[i]];
    for (let j = i + 1; j < sorted.length; j++) {
      const candidate = [...group, sorted[j]];
      const min = candidate[0].value;
      const max = candidate[candidate.length - 1].value;
      const center = (min + max) / 2;
      if (center > 0 && (max - min) / center <= tolerance) group.push(sorted[j]);
    }
    if (group.length < 2) continue;
    const min = group[0].value;
    const max = group[group.length - 1].value;
    const center = (min + max) / 2;
    const spread = center > 0 ? (max - min) / center : Infinity;
    const pinch: AvwapPinch = {
      members: group,
      center,
      spread,
      priceInside: currentPrice >= min * (1 - tolerance) && currentPrice <= max * (1 + tolerance),
    };
    if (!best || group.length > best.members.length || spread < best.spread) {
      if (!best || group.length > best.members.length || (group.length === best.members.length && spread < best.spread))
        best = pinch;
    }
  }
  return best;
}
