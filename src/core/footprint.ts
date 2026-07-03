/**
 * Institutional-footprint features: ABSORPTION (large volume transacting with
 * suppressed range at a meaningful level) and AVWAP RECLAIM / DEFENSE (price
 * reclaiming or defending an anchored VWAP tied to a knowable event).
 *
 * These are CONDITIONING FEATURES for the probability tables consumed by
 * decide() — not standalone entry rules, and (per docs/ABLATION.md) not wired
 * in as always-on filters unless out-of-sample ablation shows edge.
 *
 * Anti-lookahead contract (see docs/FOOTPRINT_MAPPING.md):
 * - Every value at bar t uses data through the CLOSE of bar t only.
 * - Pivot-based AVWAP anchors carry { anchorBar, confirmedAtBar = anchorBar+k }
 *   and are readable only from confirmedAtBar onward; before that, signals are
 *   false and strengths NaN — never a stale or retroactive value.
 * - All rolling stats are trailing; no centered or full-sample windows.
 */
import type { Candle } from "./types";
import { atrSeries } from "./indicators";
import { detectSwings } from "./swings";

// ---- configuration (spec defaults; no magic numbers in the code below) ------
export interface FootprintConfig {
  /** Volume SMA window for vol_ratio (trailing, EXCLUDES bar t). */
  nVol: number;
  /** ATR window (trailing true range, gap-aware). */
  nAtr: number;
  /** Absorption: min volume multiple of the trailing average. */
  volMult: number;
  /** Absorption: max true-range / ATR (compression when < 1). */
  rangeMax: number;
  /** Absorption: min close-in-range for the bull case (bear mirrors). */
  closeLocMin: number;
  /** Absorption: max distance to a meaningful level, in ATR units. */
  levelAtrMax: number;
  /** Min trailing average share volume for absorption to be evaluable. */
  minLiq: number;
  /** Swing-pivot half-width k; pivot confirms k bars after it prints. */
  pivotK: number;
  /** Reclaim: min volume multiple on the trigger bar (0 disables the check). */
  reclaimVolMult: number;
  /** Reclaim-and-hold: consecutive closes above the AVWAP required. */
  holdBars: number;
  /** Defense: fractional tolerance for a "touch" of the AVWAP from above. */
  touchTol: number;
  /** Defense: bars back price must already have been above the AVWAP. */
  defenseLookback: number;
  /** Gap anchor: min |open − prior close| in ATR units. */
  gapAtr: number;
  /** AVWAP slope lookback (bars) for avwapSlopeUp. */
  slopeBars: number;
  /** Cap on simultaneously-evaluated anchors (most recent kept). */
  maxActiveAnchors: number;
  /** Absorption score weights (w1..w4 in the spec). */
  weights: { vol: number; compression: number; close: number; level: number };
}

export const DEFAULT_FOOTPRINT_CONFIG: FootprintConfig = {
  nVol: 20,
  nAtr: 14,
  volMult: 2.0,
  rangeMax: 0.7,
  closeLocMin: 0.6,
  levelAtrMax: 0.5,
  minLiq: 100_000,
  pivotK: 3,
  reclaimVolMult: 1.3,
  holdBars: 2,
  touchTol: 0.002,
  defenseLookback: 10,
  gapAtr: 0.5,
  slopeBars: 5,
  maxActiveAnchors: 24,
  weights: { vol: 1, compression: 1, close: 1, level: 1 },
};

// ---- anchors -----------------------------------------------------------------
export type AnchorKind = "gap" | "pivot-low" | "pivot-high" | "year-open" | "event";

export interface AnchorRef {
  /** Bar the AVWAP accumulates from. */
  anchorBar: number;
  /** First bar at which the anchor is KNOWABLE (≥ anchorBar). Signals may only
   * read this anchor's AVWAP from here on. */
  confirmedAtBar: number;
  kind: AnchorKind;
}

/** Gap anchors: |open[t] − close[t−1]| > gapAtr·ATR[t−1]. Knowable at t. */
export function gapAnchors(candles: Candle[], atr: number[], gapAtr: number): AnchorRef[] {
  const out: AnchorRef[] = [];
  for (let t = 1; t < candles.length; t++) {
    const a = atr[t - 1];
    if (!Number.isFinite(a) || a <= 0) continue;
    if (Math.abs(candles[t].open - candles[t - 1].close) > gapAtr * a) {
      out.push({ anchorBar: t, confirmedAtBar: t, kind: "gap" });
    }
  }
  return out;
}

/**
 * Swing-pivot anchors with the confirmation lag made explicit: a pivot of
 * half-width k printed at bar p is only knowable at p+k (its right side must
 * complete). detectSwings() stamps pivots at p — the +k here is the whole
 * anti-lookahead point.
 */
export function confirmedSwingAnchors(candles: Candle[], k: number): AnchorRef[] {
  return detectSwings(candles, k)
    .map((s) => ({
      anchorBar: s.index,
      confirmedAtBar: s.index + k,
      kind: (s.kind === "low" ? "pivot-low" : "pivot-high") as AnchorKind,
    }))
    .filter((a) => a.confirmedAtBar < candles.length);
}

/** Calendar year-open anchors — knowable the moment the bar exists. */
export function yearOpenAnchors(candles: Candle[]): AnchorRef[] {
  const out: AnchorRef[] = [];
  let lastYear = NaN;
  for (let i = 0; i < candles.length; i++) {
    const y = new Date(candles[i].time * 1000).getUTCFullYear();
    if (y !== lastYear) {
      out.push({ anchorBar: i, confirmedAtBar: i, kind: "year-open" });
      lastYear = y;
    }
  }
  return out;
}

// ---- per-bar snapshot ----------------------------------------------------------
export interface FootprintSnapshot {
  // Absorption
  absorptionBull: boolean;
  absorptionBear: boolean;
  /** Signed continuous score (bull positive, bear negative, 0 when neither
   * direction's close-location leans). NaN before warm-up. */
  absorptionScore: number;
  volRatio: number;
  rangeRatio: number;
  closeLoc: number;
  /** Distance to the nearest confirmed level in ATR units; NaN when no level
   * or not evaluated (cheap gates failed — engine convention). */
  levelProximityAtr: number;
  // AVWAP events (aggregated across active, confirmed anchors)
  reclaim: boolean;
  reclaimHold: boolean;
  loss: boolean;
  defense: boolean;
  /** How many active AVWAPs were reclaimed on this bar. */
  reclaimCount: number;
  activeAvwaps: number;
  /** Signed (close − nearest AVWAP)/ATR. NaN when no active AVWAP. */
  distAtr: number;
  /** Bars spent below the reclaimed AVWAP before this reclaim (max across
   * reclaimed anchors; 0 when no reclaim). */
  barsBelowPrior: number;
  /** Volume ratio on the trigger bar (= volRatio, kept for table binning). */
  reclaimVolRatio: number;
  /** Is the nearest AVWAP rising over the last slopeBars? null when unknown. */
  avwapSlopeUp: boolean | null;
}

const EMPTY: Omit<FootprintSnapshot, never> = {
  absorptionBull: false,
  absorptionBear: false,
  absorptionScore: NaN,
  volRatio: NaN,
  rangeRatio: NaN,
  closeLoc: 0.5,
  levelProximityAtr: NaN,
  reclaim: false,
  reclaimHold: false,
  loss: false,
  defense: false,
  reclaimCount: 0,
  activeAvwaps: 0,
  distAtr: NaN,
  barsBelowPrior: 0,
  reclaimVolRatio: NaN,
  avwapSlopeUp: null,
};

const clip = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Trailing volume ratio: volume[t] ÷ SMA(volume over [t−n, t−1]). Excludes
 * bar t from the average (same convention as the engine's avgVol). */
export function volRatioSeries(candles: Candle[], n: number): number[] {
  const out = new Array<number>(candles.length).fill(NaN);
  let sum = 0;
  for (let t = 0; t < candles.length; t++) {
    if (t >= n) {
      out[t] = sum > 0 ? candles[t].volume / (sum / n) : NaN;
      sum -= candles[t - n].volume;
    }
    sum += candles[t].volume;
  }
  return out;
}

/** True range (gap-aware: includes prior close). */
function trueRangeSeries(candles: Candle[]): number[] {
  return candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const pc = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  });
}

/** close-in-range; 0.5 on a zero-range bar (spec edge case). */
function closeLocOf(c: Candle): number {
  const r = c.high - c.low;
  return r > 0 ? (c.close - c.low) / r : 0.5;
}

export interface FootprintOptions {
  /**
   * Meaningful price levels visible at bar t (for absorption's
   * level_proximity). Default: prices of swing pivots CONFIRMED by bar t —
   * cheap and point-in-time. The backtest may substitute POC/HVN levels on
   * candidate bars; both satisfy the spec ("VBP level or swing level").
   */
  levelsAt?: (t: number) => number[];
  /** Extra event anchors (earnings etc.) — must already satisfy the
   * confirmed-at rule; merged with the built-in providers. */
  eventAnchors?: AnchorRef[];
  /** Replace ALL built-in anchor providers with exactly this set (tests /
   * research). Each entry must still satisfy confirmedAtBar ≥ anchorBar. */
  anchors?: AnchorRef[];
}

/**
 * Compute the full per-bar feature frame. O(bars × active anchors).
 * Every snapshot at index t is a pure function of candles[0..t].
 */
export function computeFootprint(
  candles: Candle[],
  config: FootprintConfig = DEFAULT_FOOTPRINT_CONFIG,
  opts: FootprintOptions = {},
): FootprintSnapshot[] {
  const n = candles.length;
  const atr = atrSeries(candles, config.nAtr);
  const volR = volRatioSeries(candles, config.nVol);
  const tr = trueRangeSeries(candles);

  // Prefix sums for O(1) AVWAP of any (anchor, t) — engine convention.
  const Pp = new Array<number>(n + 1).fill(0);
  const Vp = new Array<number>(n + 1).fill(0);
  for (let i = 0; i < n; i++) {
    const hlc3 = (candles[i].high + candles[i].low + candles[i].close) / 3;
    Pp[i + 1] = Pp[i] + hlc3 * candles[i].volume;
    Vp[i + 1] = Vp[i] + candles[i].volume;
  }
  const avwapAt = (a: number, t: number): number => {
    const dv = Vp[t + 1] - Vp[a];
    return dv > 0 ? (Pp[t + 1] - Pp[a]) / dv : (candles[t].high + candles[t].low + candles[t].close) / 3;
  };

  // Anchor set, sorted by confirmation time so activation is a moving cursor.
  const anchors: AnchorRef[] = (
    opts.anchors ?? [
      ...gapAnchors(candles, atr, config.gapAtr),
      ...confirmedSwingAnchors(candles, config.pivotK),
      ...yearOpenAnchors(candles),
      ...(opts.eventAnchors ?? []),
    ]
  ).sort((a, b) => a.confirmedAtBar - b.confirmedAtBar);

  // Default meaningful levels: swing pivots confirmed by t (cheap, honest).
  const pivotAnchors = anchors.filter((a) => a.kind === "pivot-low" || a.kind === "pivot-high");
  const defaultLevelsAt = (t: number): number[] =>
    pivotAnchors
      .filter((a) => a.confirmedAtBar <= t)
      .slice(-12)
      .map((a) => (a.kind === "pivot-low" ? candles[a.anchorBar].low : candles[a.anchorBar].high));
  const levelsAt = opts.levelsAt ?? defaultLevelsAt;

  // Per-anchor running state, keyed by anchor list index once active.
  interface ActiveAnchor {
    ref: AnchorRef;
    /** Consecutive closes above (+n) / below (−n) the AVWAP, through t−1. */
    sideRun: number;
    /** Bars spent below the AVWAP in the CURRENT below-stretch (for
     * barsBelowPrior at the moment of a reclaim). */
    belowStretch: number;
    /** belowStretch as it stood when the current above-run began — lets
     * reclaim-and-hold fire holdBars later, after belowStretch has reset. */
    priorBelow: number;
    /** Last bar (≤ t−1) where close was above the AVWAP. */
    lastAboveBar: number;
  }
  const active: ActiveAnchor[] = [];
  let cursor = 0;

  const out: FootprintSnapshot[] = [];
  for (let t = 0; t < n; t++) {
    // Activate anchors confirmed at t. Their history BEFORE t is never read.
    while (cursor < anchors.length && anchors[cursor].confirmedAtBar <= t) {
      active.push({ ref: anchors[cursor], sideRun: 0, belowStretch: 0, priorBelow: 0, lastAboveBar: -1 });
      cursor++;
    }
    while (active.length > config.maxActiveAnchors) active.shift();

    const snap: FootprintSnapshot = { ...EMPTY };
    const bar = candles[t];
    snap.volRatio = volR[t];
    snap.closeLoc = closeLocOf(bar);
    snap.rangeRatio = Number.isFinite(atr[t]) && atr[t] > 0 ? tr[t] / atr[t] : NaN;
    snap.reclaimVolRatio = volR[t];

    // ---- absorption ---------------------------------------------------------
    const liquid = Number.isFinite(volR[t]) && (Vp[t + 1] - Vp[Math.max(0, t - config.nVol + 1)]) / Math.min(t + 1, config.nVol) >= config.minLiq;
    const cheapPass =
      liquid &&
      Number.isFinite(snap.volRatio) &&
      Number.isFinite(snap.rangeRatio) &&
      snap.volRatio >= config.volMult &&
      snap.rangeRatio <= config.rangeMax;
    if (cheapPass) {
      // Level proximity only once the cheap gates pass (engine convention:
      // don't do level work on every bar).
      const levels = levelsAt(t);
      if (levels.length && Number.isFinite(atr[t]) && atr[t] > 0) {
        let best = Infinity;
        for (const lv of levels) best = Math.min(best, Math.abs(bar.close - lv));
        snap.levelProximityAtr = best / atr[t];
      }
      const nearLevel = Number.isFinite(snap.levelProximityAtr) && snap.levelProximityAtr <= config.levelAtrMax;
      snap.absorptionBull = nearLevel && snap.closeLoc >= config.closeLocMin;
      snap.absorptionBear = nearLevel && snap.closeLoc <= 1 - config.closeLocMin;
    }
    // Continuous score (monotone in each component; sign = direction).
    if (Number.isFinite(snap.volRatio) && Number.isFinite(snap.rangeRatio) && liquid) {
      const w = config.weights;
      const dir = snap.closeLoc - 0.5; // >0 leans bull, <0 leans bear
      const levelTerm = Number.isFinite(snap.levelProximityAtr)
        ? clip(1 - snap.levelProximityAtr / config.levelAtrMax, 0, 1)
        : 0;
      const magnitude =
        w.vol * clip(snap.volRatio / config.volMult, 0, 3) +
        w.compression * clip(config.rangeMax / Math.max(snap.rangeRatio, 1e-9), 0, 3) +
        w.close * Math.abs(dir) +
        w.level * levelTerm;
      snap.absorptionScore = Math.sign(dir) * magnitude;
    }

    // ---- AVWAP events -------------------------------------------------------
    let nearestDist = Infinity;
    let nearestVal = NaN;
    let nearestAnchor: ActiveAnchor | null = null;
    for (const a of active) {
      const v = avwapAt(a.ref.anchorBar, t);
      const prevReadable = t - 1 >= a.ref.confirmedAtBar;
      const vPrev = prevReadable ? avwapAt(a.ref.anchorBar, t - 1) : NaN;
      const above = bar.close > v;
      const abovePrev = prevReadable ? candles[t - 1].close > vPrev : null;

      // Fresh cross up with optional volume screen.
      const crossUp = above && abovePrev === false;
      const volOk =
        config.reclaimVolMult <= 0 ||
        (Number.isFinite(volR[t]) && volR[t] >= config.reclaimVolMult);
      if (crossUp && volOk) {
        snap.reclaim = true;
        snap.reclaimCount += 1;
        snap.barsBelowPrior = Math.max(snap.barsBelowPrior, a.belowStretch);
      }
      if (!above && abovePrev === true) snap.loss = true;

      // Reclaim-and-hold: fires once, on the bar completing holdBars
      // consecutive closes above — priorBelow remembers there WAS a below-
      // stretch to reclaim from (belowStretch itself resets on the first
      // above close).
      const runNow = above ? (a.sideRun >= 0 ? a.sideRun + 1 : 1) : a.sideRun <= 0 ? a.sideRun - 1 : -1;
      if (above && runNow === 1) a.priorBelow = a.belowStretch;
      if (above && runNow === config.holdBars && a.priorBelow > 0) snap.reclaimHold = true;

      // Defense: dipped to the AVWAP (within tolerance) and closed back above,
      // with price already above within the lookback — and NOT a fresh cross
      // (that's a reclaim, the separate signal).
      const wasAboveRecently = a.lastAboveBar >= 0 && t - a.lastAboveBar <= config.defenseLookback;
      if (above && !crossUp && abovePrev !== null && wasAboveRecently && bar.low <= v * (1 + config.touchTol)) {
        snap.defense = true;
      }

      const d = Math.abs(bar.close - v);
      if (d < nearestDist) {
        nearestDist = d;
        nearestVal = v;
        nearestAnchor = a;
      }

      // Roll state forward for t+1 (all trailing).
      a.sideRun = runNow;
      if (above) {
        a.lastAboveBar = t;
        a.belowStretch = 0;
      } else {
        a.belowStretch += 1;
      }
    }
    snap.activeAvwaps = active.length;
    if (nearestAnchor && Number.isFinite(atr[t]) && atr[t] > 0) {
      snap.distAtr = (bar.close - nearestVal) / atr[t];
      const back = t - config.slopeBars;
      snap.avwapSlopeUp =
        back >= nearestAnchor.ref.confirmedAtBar && back >= nearestAnchor.ref.anchorBar
          ? avwapAt(nearestAnchor.ref.anchorBar, t) > avwapAt(nearestAnchor.ref.anchorBar, back)
          : null;
    }
    out.push(snap);
  }
  return out;
}
