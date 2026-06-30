import type {
  AnchoredVolumeProfile,
  Candle,
  PriceScale,
  ProfileBin,
  ValueArea,
} from "./types";

export interface ProfileParams {
  rowCount: number;
  scale: PriceScale;
  valueAreaFraction: number;
}

/**
 * Build a set of `rowCount` price-row edges spanning [low, high].
 *
 * For a log scale the edges are equally spaced in log-price space, which is how
 * TradingView renders an anchored volume profile when the chart is logarithmic
 * (rows look thicker at the bottom in linear pixels but represent equal % moves).
 */
export function buildEdges(
  low: number,
  high: number,
  rowCount: number,
  scale: PriceScale,
): number[] {
  if (rowCount < 1) throw new Error("rowCount must be >= 1");
  if (!(high > low)) {
    // Degenerate range — return a single tiny band so callers don't divide by 0.
    return [low, low + Math.max(1e-9, Math.abs(low) * 1e-6)];
  }
  const edges = new Array<number>(rowCount + 1);
  const canLog = scale === "log" && low > 0;
  if (canLog) {
    const lo = Math.log(low);
    const hi = Math.log(high);
    const step = (hi - lo) / rowCount;
    for (let i = 0; i <= rowCount; i++) edges[i] = Math.exp(lo + step * i);
  } else {
    const step = (high - low) / rowCount;
    for (let i = 0; i <= rowCount; i++) edges[i] = low + step * i;
  }
  // Guard against float drift at the extremes.
  edges[0] = low;
  edges[rowCount] = high;
  return edges;
}

/** Locate the row index whose [low, high) band contains `price`. */
function rowIndexFor(edges: number[], price: number): number {
  const n = edges.length - 1;
  if (price <= edges[0]) return 0;
  if (price >= edges[n]) return n - 1;
  // Binary search over monotonically increasing edges.
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (edges[mid] <= price) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Spread a single candle's volume across every row its [low, high] range
 * overlaps, weighted by the linear price overlap. This mirrors how a real
 * volume profile attributes a bar that spans several price rows rather than
 * dumping all of its volume into one bucket.
 */
function distributeCandle(
  candle: Candle,
  edges: number[],
  rowVolume: number[],
): void {
  const span = candle.high - candle.low;
  if (span <= 0) {
    rowVolume[rowIndexFor(edges, candle.close)] += candle.volume;
    return;
  }
  const first = rowIndexFor(edges, candle.low);
  const last = rowIndexFor(edges, candle.high);
  if (first === last) {
    rowVolume[first] += candle.volume;
    return;
  }
  for (let i = first; i <= last; i++) {
    const overlap = Math.min(candle.high, edges[i + 1]) - Math.max(candle.low, edges[i]);
    if (overlap > 0) rowVolume[i] += candle.volume * (overlap / span);
  }
}

/**
 * Compute the value area: the smallest contiguous band of rows around the POC
 * that accounts for `fraction` of the total traded volume. Expansion greedily
 * grows toward whichever neighbouring row holds more volume — the standard
 * market-profile value-area rule.
 */
export function computeValueArea(
  bins: ProfileBin[],
  pocIndex: number,
  totalVolume: number,
  fraction: number,
): ValueArea {
  const target = totalVolume * Math.min(Math.max(fraction, 0), 1);
  let lo = pocIndex;
  let hi = pocIndex;
  let acc = bins[pocIndex].volume;
  while (acc < target && (lo > 0 || hi < bins.length - 1)) {
    const below = lo > 0 ? bins[lo - 1].volume : -1;
    const above = hi < bins.length - 1 ? bins[hi + 1].volume : -1;
    if (above >= below) {
      hi += 1;
      acc += bins[hi].volume;
    } else {
      lo -= 1;
      acc += bins[lo].volume;
    }
  }
  return {
    low: bins[lo].low,
    high: bins[hi].high,
    volume: acc,
    lowIndex: lo,
    highIndex: hi,
  };
}

/**
 * Compute an anchored volume profile from `candles[anchorIndex .. endIndex]`.
 *
 * The price range is taken from the lowest low to the highest high inside the
 * anchored window, exactly like dragging an Anchored Volume Profile from a swing
 * low (or swing high) to the latest candle in TradingView.
 */
export function computeAnchoredProfile(
  candles: Candle[],
  anchorIndex: number,
  params: ProfileParams,
  endIndex: number = candles.length - 1,
): AnchoredVolumeProfile {
  if (candles.length === 0) throw new Error("no candles");
  const a = clampIndex(anchorIndex, candles.length);
  const e = clampIndex(endIndex, candles.length);
  const start = Math.min(a, e);
  const stop = Math.max(a, e);

  let priceLow = Infinity;
  let priceHigh = -Infinity;
  for (let i = start; i <= stop; i++) {
    if (candles[i].low < priceLow) priceLow = candles[i].low;
    if (candles[i].high > priceHigh) priceHigh = candles[i].high;
  }

  const edges = buildEdges(priceLow, priceHigh, params.rowCount, params.scale);
  const rowCount = edges.length - 1;
  const rowVolume = new Array<number>(rowCount).fill(0);
  for (let i = start; i <= stop; i++) distributeCandle(candles[i], edges, rowVolume);

  let totalVolume = 0;
  for (const v of rowVolume) totalVolume += v;

  const useLogMid = params.scale === "log" && priceLow > 0;
  const bins: ProfileBin[] = rowVolume.map((volume, i) => {
    const low = edges[i];
    const high = edges[i + 1];
    return {
      low,
      high,
      mid: useLogMid ? Math.sqrt(low * high) : (low + high) / 2,
      volume,
      fraction: totalVolume > 0 ? volume / totalVolume : 0,
    };
  });

  let pocIndex = 0;
  for (let i = 1; i < bins.length; i++) {
    if (bins[i].volume > bins[pocIndex].volume) pocIndex = i;
  }

  const valueArea = computeValueArea(bins, pocIndex, totalVolume, params.valueAreaFraction);

  return {
    anchorIndex: start,
    endIndex: stop,
    scale: params.scale,
    priceLow,
    priceHigh,
    rowSize: rowCount,
    totalVolume,
    bins,
    poc: bins[pocIndex],
    pocIndex,
    valueArea,
  };
}

function clampIndex(i: number, length: number): number {
  if (!Number.isFinite(i)) return length - 1;
  return Math.min(Math.max(Math.trunc(i), 0), length - 1);
}
