import type { AnchoredVolumeProfile, Candle, PriceScale } from "./types";
import { atrSeries, avgDollarVolume, slopeOf, smaLast, smaSeries } from "./indicators";
import { computeAnchoredProfile } from "./volumeProfile";
import {
  detectHvnShelves,
  nearestShelves,
  type NearestShelves,
  type ScoredShelf,
} from "./shelves";
import { computeRelativeStrength, type RelativeStrength } from "./relativeStrength";
import { computeAvwapAnchors, detectPinch, type AvwapAnchor, type AvwapPinch } from "./avwap";
import { chooseScanAnchor, type ChosenAnchor } from "./anchor";

export interface ScanWeights {
  shelf: number;
  rs: number;
  pinch: number;
  proximity: number;
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
  rows: 50,
  scale: "log",
  valueAreaFraction: 0.7,
  atrLookback: 10,
  weights: { shelf: 1, rs: 1, pinch: 1, proximity: 1, contraction: 1 },
};

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

export interface ScanFactors {
  shelfStrength: number;
  rsExcess: number;
  pinchSpread: number; // lower is better; NaN when no pinch
  proximity: number; // lower is better; NaN when no support shelf
  contraction: number; // atrNow / atrPrior; lower is better
}

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
  profile: AnchoredVolumeProfile;
  shelves: ScoredShelf[];
  nearest: NearestShelves;
  supportShelf: ScoredShelf | null;
  supportMid: number | null;
  proximityPct: number | null;
  pocBelowPrice: boolean;
  avwapAnchors: AvwapAnchor[];
  pinch: AvwapPinch | null;
  atrNow: number;
  atrPrior: number;
  atrContracting: boolean;
  pullbackVolumeDrying: boolean;
  noBreakdownBar: boolean;
  gates: Record<"liquidity" | "trend" | "rs" | "shelf" | "pinch" | "contraction", GateResult>;
  passedAll: boolean;
  /** Number of gates passed (0..6), used for ranking. */
  gatesPassed: number;
  factors: ScanFactors;
  /** 0..100 ranking score, filled by `scanUniverse`. */
  score: number;
}

function shelfMid(s: ScoredShelf): number {
  return (s.priceLow + s.priceHigh) / 2;
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

/** Compute every metric and gate for a single ticker (score set later). */
export function scanTicker(
  input: ScanInput,
  benchmark: Candle[],
  config: ScanConfig = DEFAULT_SCAN_CONFIG,
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

  const anchor = chooseScanAnchor(candles, { earningsTime: input.earningsTime });
  const profile = computeAnchoredProfile(candles, anchor.index, {
    rowCount: config.rows,
    scale: config.scale,
    valueAreaFraction: config.valueAreaFraction,
  });
  const shelves = detectHvnShelves(profile, price, config.shelfK, config.shelfMinBins);
  const nearest = nearestShelves(shelves, price);
  const supportShelf = nearest.inside ?? nearest.below;
  const supportMid = supportShelf ? shelfMid(supportShelf) : null;
  const proximityPct = supportMid !== null ? Math.abs(price - supportMid) / price : null;
  const pocBelowPrice = profile.poc.mid <= price;

  const avwapAnchors = computeAvwapAnchors(candles, { earningsTime: input.earningsTime });
  const pinch = detectPinch(avwapAnchors, price, config.pinchTolerance);

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
  const rsPass =
    rs.outperform1mo && rs.outperform3mo && (rs.rsLineNearHigh || rs.rsLineAboveMa);
  const shelfPass =
    supportShelf !== null &&
    pocBelowPrice &&
    proximityPct !== null &&
    proximityPct <= config.proximityPct &&
    supportShelf.strength >= config.shelfK;
  const pinchPass = pinch !== null && pinch.spread <= config.pinchTolerance && pinch.priceInside;
  const contractionPass = atrContracting && noBreakdownBar;

  const gates: ScanResult["gates"] = {
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
        ? `support ${supportShelf.priceLow.toFixed(2)}–${supportShelf.priceHigh.toFixed(2)} · ${supportShelf.strength.toFixed(1)}× · ${proximityPct !== null ? (proximityPct * 100).toFixed(1) : "—"}% away`
        : "no support shelf at price",
    },
    pinch: {
      pass: pinchPass,
      label: "AVWAP pinch",
      detail: pinch
        ? `${pinch.members.length} AVWAPs · ${(pinch.spread * 100).toFixed(1)}% spread${pinch.priceInside ? " · price inside" : ""}`
        : "no pinch",
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
    shelfStrength: supportShelf ? supportShelf.strength : 0,
    rsExcess: (safe(rs.excess1mo) + safe(rs.excess3mo)) / 2,
    pinchSpread: pinch ? pinch.spread : NaN,
    proximity: proximityPct ?? NaN,
    contraction: Number.isFinite(atrNow) && Number.isFinite(atrPrior) && atrPrior > 0 ? atrNow / atrPrior : NaN,
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
    profile,
    shelves,
    nearest,
    supportShelf,
    supportMid,
    proximityPct,
    pocBelowPrice,
    avwapAnchors,
    pinch,
    atrNow,
    atrPrior,
    atrContracting,
    pullbackVolumeDrying,
    noBreakdownBar,
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

  const shelfN = normalize(results.map((r) => r.factors.shelfStrength), false);
  const rsN = normalize(results.map((r) => r.factors.rsExcess), false);
  const pinchN = normalize(results.map((r) => r.factors.pinchSpread), true);
  const proxN = normalize(results.map((r) => r.factors.proximity), true);
  const contractN = normalize(results.map((r) => r.factors.contraction), true);

  const w = config.weights;
  const wSum = w.shelf + w.rs + w.pinch + w.proximity + w.contraction || 1;

  results.forEach((r, i) => {
    const raw =
      shelfN[i] * w.shelf +
      rsN[i] * w.rs +
      pinchN[i] * w.pinch +
      proxN[i] * w.proximity +
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
