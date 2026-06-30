import type {
  AnchoredVolumeProfile,
  ProfileBin,
  VolumeGap,
  VolumeShelf,
  ZoneKind,
} from "./types";

export interface DetectParams {
  shelfThreshold: number;
  gapThreshold: number;
}

interface Run {
  lowIndex: number;
  highIndex: number;
}

/** Group consecutive indices for which `predicate` holds into runs. */
function findRuns(bins: ProfileBin[], predicate: (b: ProfileBin) => boolean): Run[] {
  const runs: Run[] = [];
  let current: Run | null = null;
  for (let i = 0; i < bins.length; i++) {
    if (predicate(bins[i])) {
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
 * Detect volume gaps — contiguous runs of low-volume rows (<= `gapThreshold`
 * of the POC). These are the "vacuums" through which price can travel quickly.
 *
 * Gaps that sit at the very top or bottom edge of the profile are typically the
 * thin tails of the distribution rather than true interior vacuums, so a gap is
 * only reported when it is bounded by traded volume on at least one side.
 */
export function detectGaps(
  profile: AnchoredVolumeProfile,
  params: DetectParams,
): VolumeGap[] {
  const { bins, poc, totalVolume } = profile;
  if (poc.volume <= 0) return [];
  const cutoff = poc.volume * params.gapThreshold;
  const runs = findRuns(bins, (b) => b.volume <= cutoff);

  const gaps: VolumeGap[] = [];
  for (const run of runs) {
    const touchesBottom = run.lowIndex === 0;
    const touchesTop = run.highIndex === bins.length - 1;
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
