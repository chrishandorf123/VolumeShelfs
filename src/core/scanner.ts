import type { AnchoredVolumeProfile, Candle, PriceScale } from "./types";
import { atrSeries, avgDollarVolume, slopeOf, smaLast, smaSeries } from "./indicators";
import { computeAnchoredProfile } from "./volumeProfile";
import {
  detectHvnShelves,
  nearestShelves,
  shelfOverlapsValueArea,
  type NearestShelves,
  type ScoredShelf,
} from "./shelves";
import { computeRelativeStrength, type RelativeStrength } from "./relativeStrength";
import {
  computeAvwapAnchors,
  detectPinch,
  index52wLow,
  indexAtTime,
  indexYtdOpen,
  type AvwapAnchor,
  type AvwapPinch,
} from "./avwap";
import { avwapCross, avwapState, type AvwapEvent, type AvwapState } from "./avwapStrategy";
import { defaultAnchorIndex } from "./swings";
import {
  chooseScanAnchor,
  electBestShelfAnchor,
  isHighAnchor,
  significance,
  type ChosenAnchor,
} from "./anchor";
import { detectGapPlays, selectPrimaryGapPlay, type GapPlay } from "./gapPlay";
import { computeConfirmation, type Confirmation } from "./confirmation";
import { computeConfluence, type ConfluenceScore } from "./confluence";

/** Ranking weights. The volume-profile play (ideal shelf-at-price + gap) leads. */
export interface ScanWeights {
  ideal: number;
  gap: number;
  rs: number;
  avwap: number;
  pinch: number;
  contraction: number;
}

export interface ScanConfig {
  minPrice: number;
  minDollarVol: number;
  near50maPct: number;
  shelfK: number;
  shelfMinBins: number;
  proximityPct: number;
  pinchTolerance: number;
  gapThreshold: number;
  /** Minimum reward-to-risk for the gap-play gate. */
  minGapRR: number;
  /** Minimum air-pocket size (fraction of price) for the gap-play gate. */
  minGapPct: number;
  rows: number;
  scale: PriceScale;
  valueAreaFraction: number;
  atrLookback: number;
  weights: ScanWeights;
}

export const DEFAULT_SCAN_CONFIG: ScanConfig = {
  minPrice: 5,
  minDollarVol: 5_000_000,
  near50maPct: 0.03,
  shelfK: 1.5,
  shelfMinBins: 2,
  proximityPct: 0.03,
  pinchTolerance: 0.03,
  gapThreshold: 0.15,
  minGapRR: 1.5,
  minGapPct: 0.03,
  rows: 50,
  scale: "log",
  valueAreaFraction: 0.7,
  atrLookback: 10,
  // The gap/shelf volume-profile play is the main signal, so it carries the
  // most weight; AVWAP, RS, pinch and contraction confirm it.
  weights: { ideal: 1.5, gap: 1.5, rs: 1, avwap: 1, pinch: 0.75, contraction: 0.75 },
};

const FAT_REF = 3.0;

export interface GateResult {
  pass: boolean;
  label: string;
  detail: string;
}

export interface ScanInput {
  ticker: string;
  candles: Candle[];
  /** Optional earnings date (epoch seconds) for anchor + AVWAP. */
  earningsTime?: number;
}

export interface AvwapSummary {
  /** State of the AVWAP anchored at the elected profile anchor (the break-even line). */
  keyState: AvwapState;
  /** Price above a rising long-side AVWAP somewhere (Shannon's bullish regime). */
  bullish: boolean;
  /** A recent reclaim of a long-side AVWAP. */
  reclaim: boolean;
  event: AvwapEvent;
}

export interface ScanFactors {
  /** Shelf-at-price ideal-setup quality. */
  ideal: number;
  /** Volume-gap play quality (the main play). */
  gapQuality: number;
  rsExcess: number;
  /** AVWAP constructiveness (above rising AVWAP / reclaim). */
  avwap: number;
  pinchSpread: number; // lower is better; NaN when no pinch
  contraction: number; // atrNow / atrPrior; lower is better
}

export type GateKey = "liquidity" | "trend" | "rs" | "shelf" | "gap" | "avwap" | "contraction";

export interface ScanResult {
  ticker: string;
  price: number;
  avgDollarVol: number;
  ma50: number;
  ma200: number;
  ma200Slope: ReturnType<typeof slopeOf>;
  aboveMa200: boolean;
  near50ma: boolean;
  rs: RelativeStrength;
  anchor: ChosenAnchor;
  anchoredFromHigh: boolean;
  profile: AnchoredVolumeProfile;
  shelves: ScoredShelf[];
  nearest: NearestShelves;
  /** The decision shelf price is interacting with (inside / below / above). */
  supportShelf: ScoredShelf | null;
  supportMid: number | null;
  proximityPct: number | null;
  pocBelowPrice: boolean;
  /** 0..1 quality of the shelf-at-price ideal setup. */
  idealScore: number;
  /** The primary volume-gap play (the main play), if any. */
  gapPlay: GapPlay | null;
  avwapAnchors: AvwapAnchor[];
  pinch: AvwapPinch | null;
  avwap: AvwapSummary;
  atrNow: number;
  atrPrior: number;
  atrContracting: boolean;
  pullbackVolumeDrying: boolean;
  noBreakdownBar: boolean;
  /** Secondary confirmation layer (MACD / RSI / %-range / 5 SMA + his filter). */
  confirmation: Confirmation;
  /** The full 10-item confluence scorecard (Wujastyk's tiered confirmation gate). */
  confluence: ConfluenceScore;
  gates: Record<GateKey, GateResult>;
  passedAll: boolean;
  /** Number of gates passed (0..7), used for ranking. */
  gatesPassed: number;
  factors: ScanFactors;
  /** 0..100 ranking score, filled by `scanUniverse`. */
  score: number;
}

function shelfMid(s: ScoredShelf): number {
  return (s.priceLow + s.priceHigh) / 2;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/** Mean volume over `n` bars ending at (and excluding) index `end`. */
function meanVolume(candles: Candle[], end: number, n: number): number {
  const start = Math.max(0, end - n);
  let sum = 0;
  let count = 0;
  for (let i = start; i < end; i++) {
    sum += candles[i].volume;
    count += 1;
  }
  return count > 0 ? sum / count : NaN;
}

/**
 * Compute every metric and gate for a single ticker (score set later).
 * Pass `forceAnchor` to analyze the ticker from a specific anchor instead of the
 * auto-elected one (used by the Scanner's "try the other anchor" toggle).
 */
export function scanTicker(
  input: ScanInput,
  benchmark: Candle[],
  config: ScanConfig = DEFAULT_SCAN_CONFIG,
  forceAnchor?: ChosenAnchor,
): ScanResult {
  const { ticker, candles } = input;
  const n = candles.length;
  const price = n > 0 ? candles[n - 1].close : NaN;
  const closes = candles.map((c) => c.close);

  const avgDollarVol = avgDollarVolume(candles, 20);
  const ma50 = smaLast(closes, 50);
  const ma200 = smaLast(closes, 200);
  const ma200Slope = slopeOf(smaSeries(closes, 200), 21, 0.005);
  const aboveMa200 = Number.isFinite(ma200) && price > ma200;
  const near50ma =
    Number.isFinite(ma50) && (price > ma50 || Math.abs(price - ma50) / price <= config.near50maPct);

  const rs = computeRelativeStrength(candles, benchmark);

  // ---- anchor election (significant pivot: high OR low) -------------------
  const anchor =
    forceAnchor ?? electBestShelfAnchor(candles, price, config, { earningsTime: input.earningsTime });
  const anchoredFromHigh = isHighAnchor(anchor.label);
  const profile = computeAnchoredProfile(candles, anchor.index, {
    rowCount: config.rows,
    scale: config.scale,
    valueAreaFraction: config.valueAreaFraction,
  });
  const shelves = detectHvnShelves(profile, price, config.shelfK, config.shelfMinBins);
  const nearest = nearestShelves(shelves, price);
  // Support is always the shelf at/below price — inside it, or just beneath it
  // (the reclaim band, where the election may have flipped to a high anchor
  // precisely because that shelf is at price). A shelf ABOVE price is overhead
  // resistance, not support, so it is never the support shelf.
  const supportShelf = nearest.inside ?? nearest.below;
  const supportMid = supportShelf ? shelfMid(supportShelf) : null;
  // Proximity is edge-based: 0 when price sits inside the shelf, otherwise the
  // distance to the nearest edge (so a wide shelf price is inside still counts
  // as "at the shelf" rather than failing on midpoint distance).
  const supportInside =
    supportShelf !== null && price >= supportShelf.priceLow && price <= supportShelf.priceHigh;
  const proximityPct = supportShelf
    ? supportInside
      ? 0
      : Math.min(Math.abs(price - supportShelf.priceLow), Math.abs(price - supportShelf.priceHigh)) /
        price
    : null;
  const pocBelowPrice = profile.poc.mid <= price;

  // ---- ideal shelf-at-price score ----------------------------------------
  let idealScore = 0;
  if (supportShelf && proximityPct !== null) {
    const fatness = clamp01((supportShelf.strength - config.shelfK) / (FAT_REF - config.shelfK));
    const atPrice = supportInside ? 1 : clamp01(1 - proximityPct / config.proximityPct);
    const dominance = significance(candles, anchor.index, anchoredFromHigh ? "high" : "low");
    const massVA =
      clamp01(supportShelf.fraction / 0.25) *
      (shelfOverlapsValueArea(supportShelf, profile.valueArea) ? 1 : 0.6);
    idealScore = fatness * atPrice * dominance * massVA;
  }

  // ---- the main play: volume-gap traverse --------------------------------
  const gapPlays = detectGapPlays(profile, price, {
    shelfThreshold: 0.55,
    gapThreshold: config.gapThreshold,
    shelfK: config.shelfK,
    shelfMinBins: config.shelfMinBins,
    proximityPct: config.proximityPct,
  });
  const gapPlay = selectPrimaryGapPlay(gapPlays, price);

  // ---- AVWAP layer (Brian Shannon) ---------------------------------------
  const avwapAnchors = computeAvwapAnchors(candles, { earningsTime: input.earningsTime });
  const pinch = detectPinch(avwapAnchors, price, config.pinchTolerance);

  const longAnchorIdx = Array.from(
    new Set(
      [
        defaultAnchorIndex(candles, 5, 20),
        index52wLow(candles),
        indexYtdOpen(candles),
        ...(input.earningsTime !== undefined ? [indexAtTime(candles, input.earningsTime)] : []),
      ].filter((i) => i >= 0 && i <= n - 1 - 5),
    ),
  );
  let avwapBullish = false;
  let avwapReclaim = false;
  for (const idx of longAnchorIdx) {
    const st = avwapState(candles, idx);
    // Constructive = price above a long AVWAP that isn't falling (rising or
    // flat). A long cumulative AVWAP is nearly flat late in a base, so requiring
    // a strictly rising slope here would miss healthy "holding above" setups.
    if (st.priceAbove && st.slope !== "falling" && st.slope !== "unknown") avwapBullish = true;
    if (avwapCross(candles, idx, 5).event === "reclaim") avwapReclaim = true;
  }
  const keyState = avwapState(candles, anchor.index);
  const keyCross = avwapCross(candles, anchor.index, 5);
  const avwap: AvwapSummary = {
    keyState,
    bullish: avwapBullish,
    reclaim: avwapReclaim,
    event: keyCross.event,
  };
  const avwapScore = (avwapBullish ? 0.6 : 0) + (avwapReclaim ? 0.4 : 0);

  // ---- secondary confirmation (MACD / RSI / %-range / 5-SMA + his filter) --
  const confirmation = computeConfirmation({
    candles,
    profile,
    price,
    keyAvwap: keyState.value,
    ma200,
  });

  // ---- the full confluence scorecard (his tiered confirmation checklist) ---
  const onShelf =
    supportShelf !== null && proximityPct !== null && proximityPct <= config.proximityPct;
  const overheadTarget = nearest.above
    ? (nearest.above.priceLow + nearest.above.priceHigh) / 2
    : profile.valueArea.high;
  const confluence = computeConfluence({
    candles,
    benchmark,
    price,
    anchorIndex: anchor.index,
    onShelf,
    pinchActive: pinch?.priceInside ?? false,
    valueAreaLow: profile.valueArea.low,
    valueAreaHigh: profile.valueArea.high,
    ma200,
    aboveMa200,
    ma5Rising: confirmation.ma5Rising,
    rsi: confirmation.rsi.value,
    macdHistRising: confirmation.macd.histRising,
    avwapReclaim,
    keyAvwap: keyState.value,
    rsOutperform: rs.outperform1mo && rs.outperform3mo,
    supportLow: supportShelf ? supportShelf.priceLow : null,
    overheadTarget,
  });

  // ---- ATR contraction & breakdown ---------------------------------------
  const atr = atrSeries(candles, 14);
  const atrNow = atr[n - 1] ?? NaN;
  const atrPrior = atr[n - 1 - config.atrLookback] ?? NaN;
  const atrContracting = Number.isFinite(atrNow) && Number.isFinite(atrPrior) && atrNow < atrPrior;

  const recentVol = meanVolume(candles, n, 5);
  const priorVol = meanVolume(candles, Math.max(0, n - 5), 10);
  const pullbackVolumeDrying =
    Number.isFinite(recentVol) && Number.isFinite(priorVol) && recentVol < priorVol;

  const avg20 = meanVolume(candles, n, 20);
  let noBreakdownBar = true;
  if (supportShelf) {
    for (let i = Math.max(0, n - 5); i < n; i++) {
      if (candles[i].close < supportShelf.priceLow && candles[i].volume > avg20) {
        noBreakdownBar = false;
        break;
      }
    }
  }

  // ---- gates --------------------------------------------------------------
  const liquidityPass =
    Number.isFinite(price) && price >= config.minPrice && avgDollarVol >= config.minDollarVol;
  const trendPass = aboveMa200 && ma200Slope !== "falling" && ma200Slope !== "unknown" && near50ma;
  const rsPass = rs.outperform1mo && rs.outperform3mo && (rs.rsLineNearHigh || rs.rsLineAboveMa);
  const shelfPass =
    supportShelf !== null &&
    (anchoredFromHigh ? true : pocBelowPrice) &&
    proximityPct !== null &&
    proximityPct <= config.proximityPct &&
    supportShelf.strength >= config.shelfK;
  const gapPass =
    gapPlay !== null &&
    gapPlay.active &&
    gapPlay.rr >= config.minGapRR &&
    gapPlay.airPocketPct >= config.minGapPct;
  const avwapPass = avwapBullish || avwapReclaim;
  const contractionPass = atrContracting && noBreakdownBar;

  const gates: Record<GateKey, GateResult> = {
    liquidity: {
      pass: liquidityPass,
      label: "Liquidity",
      detail: `${fmtUsd(price)} · ${fmtUsd(avgDollarVol)}/day`,
    },
    trend: {
      pass: trendPass,
      label: "Trend & MA",
      detail: aboveMa200
        ? `>200MA, 200MA ${ma200Slope}${near50ma ? ", near/above 50MA" : ""}`
        : "below 200MA",
    },
    rs: {
      pass: rsPass,
      label: "Relative strength",
      detail: `1mo ${fmtPct(rs.excess1mo)} · 3mo ${fmtPct(rs.excess3mo)} vs bench`,
    },
    shelf: {
      pass: shelfPass,
      label: "Volume shelf",
      detail: supportShelf
        ? `${supportShelf.priceLow.toFixed(2)}–${supportShelf.priceHigh.toFixed(2)} · ${supportShelf.strength.toFixed(1)}× · ${proximityPct !== null ? (proximityPct * 100).toFixed(1) : "—"}% away${anchoredFromHigh ? " (pullback into shelf)" : ""}`
        : "no shelf at price",
    },
    gap: {
      pass: gapPass,
      label: "Volume gap play",
      detail: gapPlay
        ? `air pocket ${(gapPlay.airPocketPct * 100).toFixed(1)}% → ${gapPlay.target.toFixed(2)} · ${gapPlay.rr.toFixed(1)}R${gapPlay.active ? " · active" : " · watch"}`
        : "no gap above support",
    },
    avwap: {
      pass: avwapPass,
      label: "AVWAP",
      detail: `${avwapBullish ? "above rising AVWAP" : "below/!rising AVWAP"}${avwapReclaim ? " · reclaim" : ""}${pinch?.priceInside ? ` · pinch ${(pinch.spread * 100).toFixed(1)}%` : ""}`,
    },
    contraction: {
      pass: contractionPass,
      label: "Contraction",
      detail: `ATR ${atrContracting ? "contracting" : "expanding"}${pullbackVolumeDrying ? ", vol drying" : ""}${noBreakdownBar ? "" : ", breakdown bar!"}`,
    },
  };
  const gateList = Object.values(gates);
  const passedAll = gateList.every((g) => g.pass);
  const gatesPassed = gateList.filter((g) => g.pass).length;

  const factors: ScanFactors = {
    ideal: idealScore,
    gapQuality: gapPlay ? gapPlay.quality : 0,
    rsExcess: (safe(rs.excess1mo) + safe(rs.excess3mo)) / 2,
    avwap: avwapScore,
    pinchSpread: pinch ? pinch.spread : NaN,
    contraction:
      Number.isFinite(atrNow) && Number.isFinite(atrPrior) && atrPrior > 0 ? atrNow / atrPrior : NaN,
  };

  return {
    ticker,
    price,
    avgDollarVol,
    ma50,
    ma200,
    ma200Slope,
    aboveMa200,
    near50ma,
    rs,
    anchor,
    anchoredFromHigh,
    profile,
    shelves,
    nearest,
    supportShelf,
    supportMid,
    proximityPct,
    pocBelowPrice,
    idealScore,
    gapPlay,
    avwapAnchors,
    pinch,
    avwap,
    atrNow,
    atrPrior,
    atrContracting,
    pullbackVolumeDrying,
    noBreakdownBar,
    confirmation,
    confluence,
    gates,
    passedAll,
    gatesPassed,
    factors,
    score: 0,
  };
}

/** Min-max normalize to 0..1; `invert` for "lower is better" factors. */
function normalize(values: number[], invert: boolean): number[] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return values.map(() => 0);
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min;
  return values.map((v) => {
    if (!Number.isFinite(v)) return 0; // missing factor => worst
    if (span === 0) return 0.5;
    const t = (v - min) / span;
    return invert ? 1 - t : t;
  });
}

/**
 * Score and rank a universe. Each factor is min-max normalized across the
 * scanned set, then combined with the configured weights into a 0..100 score.
 * Results are returned sorted best-first.
 */
export function scanUniverse(
  inputs: ScanInput[],
  benchmark: Candle[],
  config: ScanConfig = DEFAULT_SCAN_CONFIG,
): ScanResult[] {
  const results = inputs.map((input) => scanTicker(input, benchmark, config));
  if (results.length === 0) return results;

  const idealN = normalize(results.map((r) => r.factors.ideal), false);
  const gapN = normalize(results.map((r) => r.factors.gapQuality), false);
  const rsN = normalize(results.map((r) => r.factors.rsExcess), false);
  const avwapN = normalize(results.map((r) => r.factors.avwap), false);
  const pinchN = normalize(results.map((r) => r.factors.pinchSpread), true);
  const contractN = normalize(results.map((r) => r.factors.contraction), true);

  const w = config.weights;
  const wSum = w.ideal + w.gap + w.rs + w.avwap + w.pinch + w.contraction || 1;

  results.forEach((r, i) => {
    const raw =
      idealN[i] * w.ideal +
      gapN[i] * w.gap +
      rsN[i] * w.rs +
      avwapN[i] * w.avwap +
      pinchN[i] * w.pinch +
      contractN[i] * w.contraction;
    r.score = (raw / wSum) * 100;
  });

  // Rank by the hard-gate count first (so a clean downtrend with a tight pinch
  // can't outrank a genuine leader), then by the continuous factor score.
  const hardGates = (r: ScanResult) =>
    (r.gates.liquidity.pass ? 1 : 0) +
    (r.gates.trend.pass ? 1 : 0) +
    (r.gates.rs.pass ? 1 : 0);
  return results.sort((a, b) => {
    if (a.passedAll !== b.passedAll) return a.passedAll ? -1 : 1;
    const ha = hardGates(a);
    const hb = hardGates(b);
    if (ha !== hb) return hb - ha;
    return b.score - a.score;
  });
}

// `chooseScanAnchor` retained as the election fallback; re-exported for callers.
export { chooseScanAnchor };

// ---- formatting helpers used in gate details ------------------------------
function safe(v: number): number {
  return Number.isFinite(v) ? v : 0;
}
function fmtPct(v: number): string {
  return Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%` : "—";
}
function fmtUsd(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(2)}`;
}
