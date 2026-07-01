import type {
  AnchoredVolumeProfile,
  ProfileBin,
  ValueArea,
  VolumeGap,
  VolumeShelf,
  ZoneKind,
} from "./types";

export interface DetectParams {
  shelfThreshold: number;
  gapThreshold: number;
  /**
   * How deep a valley between two shelves must dip to count as a volume gap,
   * as a fraction of the *smaller bounding shelf* (not the global POC). This is
   * the faithful Wujastyk "gap between shelves" rule: an air pocket is thin
   * *relative to the shelves that wall it in*, even when the global POC (a
   * distant, much fatter shelf) makes it look busy on an absolute scale.
   * Defaults to 0.4.
   */
  gapWallFraction?: number;
}

interface Run {
  lowIndex: number;
  highIndex: number;
}

/** Group consecutive indices for which `predicate` holds into runs. */
function findRuns(bins: ProfileBin[], predicate: (b: ProfileBin, i: number) => boolean): Run[] {
  const runs: Run[] = [];
  let current: Run | null = null;
  for (let i = 0; i < bins.length; i++) {
    if (predicate(bins[i], i)) {
      if (current) current.highIndex = i;
      else current = { lowIndex: i, highIndex: i };
    } else if (current) {
      runs.push(current);
      current = null;
    }
  }
  if (current) runs.push(current);
  return runs;
}

/**
 * Classify a shelf's relationship to the current price.
 *
 * Per the system: when price trades *above* a high-volume shelf, that shelf is
 * break-even *demand* (it tends to support price — buyers who are back to
 * break-even stop selling). When price trades *below* the shelf, the same
 * volume becomes break-even *supply* (holders sell to get out at break-even,
 * creating resistance).
 */
export function classifyZone(
  shelf: Pick<VolumeShelf, "priceLow" | "priceHigh">,
  currentPrice: number,
): ZoneKind {
  if (currentPrice >= shelf.priceHigh) return "break-even-demand";
  if (currentPrice <= shelf.priceLow) return "break-even-supply";
  return "at-price";
}

/**
 * Detect volume shelves — contiguous clusters of rows whose volume is at least
 * `shelfThreshold` of the POC row's volume.
 */
export function detectShelves(
  profile: AnchoredVolumeProfile,
  currentPrice: number,
  params: DetectParams,
): VolumeShelf[] {
  const { bins, poc, totalVolume } = profile;
  if (poc.volume <= 0) return [];
  const cutoff = poc.volume * params.shelfThreshold;
  const runs = findRuns(bins, (b) => b.volume >= cutoff);

  return runs.map((run) => {
    let volume = 0;
    let peakIndex = run.lowIndex;
    for (let i = run.lowIndex; i <= run.highIndex; i++) {
      volume += bins[i].volume;
      if (bins[i].volume > bins[peakIndex].volume) peakIndex = i;
    }
    const priceLow = bins[run.lowIndex].low;
    const priceHigh = bins[run.highIndex].high;
    return {
      priceLow,
      priceHigh,
      peakPrice: bins[peakIndex].mid,
      volume,
      fraction: totalVolume > 0 ? volume / totalVolume : 0,
      lowIndex: run.lowIndex,
      highIndex: run.highIndex,
      zone: classifyZone({ priceLow, priceHigh }, currentPrice),
    };
  });
}

/**
 * Detect volume gaps — the low-volume "air pockets" price travels through fast.
 *
 * Two complementary rules, the way Wujastyk actually reads a profile:
 *  1. Absolute vacuum — a run of rows at/below `gapThreshold` of the global POC
 *     (a near-dead band anywhere in the profile).
 *  2. Between-shelf valley — a valley between two shelf *peaks* (local maxima)
 *     whose floor dips to at most `gapWallFraction` of the *smaller bounding
 *     peak*. This is the case his charts show and an absolute-POC cutoff misses:
 *     a genuine gap between two mid-height shelves, while a distant, much fatter
 *     shelf owns the global POC and makes the area look "busy" on an absolute
 *     scale. Using local peaks (not a % of the POC) means a lower shelf is still
 *     recognised as a wall even when the top cluster dwarfs it.
 *
 * Overlapping detections are merged, so a valley that also clears the absolute
 * cutoff is reported once. Gaps that span the entire profile (no traded volume
 * anywhere) are ignored.
 */
export function detectGaps(
  profile: AnchoredVolumeProfile,
  params: DetectParams,
): VolumeGap[] {
  const { bins, poc, totalVolume } = profile;
  if (poc.volume <= 0) return [];
  const n = bins.length;

  // Mark every row that belongs to a gap by either rule, then coalesce.
  const isGap = new Array<boolean>(n).fill(false);

  // Rule 1: absolute vacuum vs the global POC.
  const absCutoff = poc.volume * params.gapThreshold;
  for (let i = 0; i < n; i++) {
    if (bins[i].volume <= absCutoff) isGap[i] = true;
  }

  // Rule 2: relative valley between two shelf peaks (local maxima).
  const wallFraction = params.gapWallFraction ?? 0.4;
  // The visible band grows out from the valley floor until rows climb back near
  // the shelves; keep it at least as wide as the vacuum itself.
  const bandFraction = Math.max(0.6, wallFraction);
  const mean = totalVolume / n;
  const win = Math.max(2, Math.round(n * 0.06));
  const peaks = shelfPeaks(bins, mean, win);
  for (let k = 0; k + 1 < peaks.length; k++) {
    const a = peaks[k];
    const b = peaks[k + 1];
    if (b - a < 2) continue; // adjacent peaks — no valley between them
    let valleyIdx = a + 1;
    for (let i = a + 1; i < b; i++) {
      if (bins[i].volume < bins[valleyIdx].volume) valleyIdx = i;
    }
    const wall = Math.min(bins[a].volume, bins[b].volume);
    if (bins[valleyIdx].volume > wall * wallFraction) continue; // not a real vacuum
    const level = wall * bandFraction;
    let lo = valleyIdx;
    while (lo - 1 > a && bins[lo - 1].volume <= level) lo--;
    let hi = valleyIdx;
    while (hi + 1 < b && bins[hi + 1].volume <= level) hi++;
    for (let i = lo; i <= hi; i++) isGap[i] = true;
  }

  const runs = findRuns(bins, (_b, i) => isGap[i]);
  const gaps: VolumeGap[] = [];
  for (const run of runs) {
    const touchesBottom = run.lowIndex === 0;
    const touchesTop = run.highIndex === n - 1;
    if (touchesBottom && touchesTop) continue; // entire profile is empty
    let volume = 0;
    for (let i = run.lowIndex; i <= run.highIndex; i++) volume += bins[i].volume;
    gaps.push({
      priceLow: bins[run.lowIndex].low,
      priceHigh: bins[run.highIndex].high,
      volume,
      fraction: totalVolume > 0 ? volume / totalVolume : 0,
      lowIndex: run.lowIndex,
      highIndex: run.highIndex,
    });
  }
  return gaps;
}

/**
 * Indices of shelf peaks — above-average rows that are a local maximum within
 * ±`win` rows. These are the "walls" a volume gap sits between.
 */
function shelfPeaks(bins: ProfileBin[], peakFloor: number, win: number): number[] {
  const n = bins.length;
  const peaks: number[] = [];
  for (let i = 0; i < n; i++) {
    if (bins[i].volume < peakFloor) continue;
    let isPeak = true;
    for (let j = Math.max(0, i - win); j <= Math.min(n - 1, i + win); j++) {
      if (bins[j].volume > bins[i].volume) {
        isPeak = false;
        break;
      }
    }
    if (isPeak) peaks.push(i);
  }
  return peaks;
}

/** Mean volume per histogram row (`total_volume / N`). */
export function meanBinVolume(profile: AnchoredVolumeProfile): number {
  return profile.bins.length > 0 ? profile.totalVolume / profile.bins.length : 0;
}

/** A shelf with a strength score = peak row volume ÷ mean row volume. */
export interface ScoredShelf extends VolumeShelf {
  /** Peak HVN row volume divided by mean bin volume (≥ k by construction). */
  strength: number;
}

/**
 * Detect shelves the way the Volume Shelf Scanner spec defines them: a row is a
 * High Volume Node when its volume ≥ `k` × mean bin volume, and a shelf is a
 * run of ≥ `minBins` adjacent HVN rows. Each shelf carries a strength score.
 */
export function detectHvnShelves(
  profile: AnchoredVolumeProfile,
  currentPrice: number,
  k = 1.5,
  minBins = 2,
): ScoredShelf[] {
  const mean = meanBinVolume(profile);
  if (mean <= 0) return [];
  const cutoff = mean * k;
  const bins = profile.bins;

  const shelves: ScoredShelf[] = [];
  let runLow = -1;
  const flush = (lowIdx: number, highIdx: number) => {
    if (highIdx - lowIdx + 1 < minBins) return;
    let volume = 0;
    let peak = lowIdx;
    for (let i = lowIdx; i <= highIdx; i++) {
      volume += bins[i].volume;
      if (bins[i].volume > bins[peak].volume) peak = i;
    }
    const priceLow = bins[lowIdx].low;
    const priceHigh = bins[highIdx].high;
    shelves.push({
      priceLow,
      priceHigh,
      peakPrice: bins[peak].mid,
      volume,
      fraction: profile.totalVolume > 0 ? volume / profile.totalVolume : 0,
      lowIndex: lowIdx,
      highIndex: highIdx,
      zone: classifyZone({ priceLow, priceHigh }, currentPrice),
      strength: bins[peak].volume / mean,
    });
  };
  for (let i = 0; i < bins.length; i++) {
    if (bins[i].volume >= cutoff) {
      if (runLow < 0) runLow = i;
    } else if (runLow >= 0) {
      flush(runLow, i - 1);
      runLow = -1;
    }
  }
  if (runLow >= 0) flush(runLow, bins.length - 1);
  return shelves;
}

export interface ShelfAtPrice {
  shelf: ScoredShelf;
  /** Distance from price to the nearest shelf edge, as a fraction (0 if inside). */
  edgePct: number;
  inside: boolean;
  /** strength ÷ (1 + edgePct·proxK) — fat shelves at price score highest. */
  score: number;
}

/**
 * Find the fattest shelf sitting AT the current price (inside it, or within
 * `maxEdgePct` of an edge). Used to elect the anchor whose profile best
 * "explains" where price is trading. Returns null when no qualifying shelf
 * exists.
 */
export function bestShelfAtPrice(
  shelves: ScoredShelf[],
  price: number,
  maxEdgePct = 0.05,
  proxK = 20,
  shelfK = 1.5,
): ShelfAtPrice | null {
  let best: ShelfAtPrice | null = null;
  for (const s of shelves) {
    if (s.strength < shelfK) continue;
    const inside = price >= s.priceLow && price <= s.priceHigh;
    const edge = inside ? 0 : Math.min(Math.abs(price - s.priceLow), Math.abs(price - s.priceHigh));
    const edgePct = price > 0 ? edge / price : Infinity;
    if (edgePct > maxEdgePct) continue;
    const score = s.strength / (1 + edgePct * proxK);
    if (!best || score > best.score) best = { shelf: s, edgePct, inside, score };
  }
  return best;
}

/** Whether a shelf's row span overlaps the profile's value area. */
export function shelfOverlapsValueArea(shelf: VolumeShelf, valueArea: ValueArea): boolean {
  return !(shelf.highIndex < valueArea.lowIndex || shelf.lowIndex > valueArea.highIndex);
}

export interface NearestShelves {
  /** Closest shelf whose high is at/below price. */
  below: ScoredShelf | null;
  /** Closest shelf whose low is at/above price. */
  above: ScoredShelf | null;
  /** Shelf the price currently sits inside, if any. */
  inside: ScoredShelf | null;
}

/** Find the nearest shelves above/below (and any straddling) the current price. */
export function nearestShelves(shelves: ScoredShelf[], currentPrice: number): NearestShelves {
  let below: ScoredShelf | null = null;
  let above: ScoredShelf | null = null;
  let inside: ScoredShelf | null = null;
  for (const s of shelves) {
    if (currentPrice >= s.priceLow && currentPrice <= s.priceHigh) {
      inside = s;
    } else if (s.priceHigh < currentPrice) {
      if (!below || s.priceHigh > below.priceHigh) below = s;
    } else if (s.priceLow > currentPrice) {
      if (!above || s.priceLow < above.priceLow) above = s;
    }
  }
  return { below, above, inside };
}

export interface ProfileAnalysis {
  shelves: VolumeShelf[];
  gaps: VolumeGap[];
  /** The most significant shelf below price (nearest break-even demand). */
  nearestDemand: VolumeShelf | null;
  /** The most significant shelf above price (nearest break-even supply). */
  nearestSupply: VolumeShelf | null;
}

export function analyzeProfile(
  profile: AnchoredVolumeProfile,
  currentPrice: number,
  params: DetectParams,
): ProfileAnalysis {
  const shelves = detectShelves(profile, currentPrice, params);
  const gaps = detectGaps(profile, params);

  let nearestDemand: VolumeShelf | null = null;
  let nearestSupply: VolumeShelf | null = null;
  for (const shelf of shelves) {
    if (shelf.zone === "break-even-demand") {
      if (!nearestDemand || shelf.priceHigh > nearestDemand.priceHigh) nearestDemand = shelf;
    } else if (shelf.zone === "break-even-supply") {
      if (!nearestSupply || shelf.priceLow < nearestSupply.priceLow) nearestSupply = shelf;
    }
  }
  return { shelves, gaps, nearestDemand, nearestSupply };
}
