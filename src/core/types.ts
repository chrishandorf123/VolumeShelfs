/**
 * Core domain types for the VolumeShelfs analysis engine.
 *
 * The engine is intentionally DOM-free and dependency-free so it can be unit
 * tested in isolation and reused in a CLI/server context.
 */

/** A single OHLCV bar. `time` is epoch seconds (UTC). */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type PriceScale = "linear" | "log";

/** One horizontal row of the volume profile histogram. */
export interface ProfileBin {
  /** Lower price edge of the row (inclusive). */
  low: number;
  /** Upper price edge of the row (exclusive, except the top row). */
  high: number;
  /** Geometric/arithmetic midpoint used for labelling. */
  mid: number;
  /** Total volume attributed to this price row. */
  volume: number;
  /** Volume as a fraction (0..1) of the profile's total volume. */
  fraction: number;
}

export interface ValueArea {
  /** Lower price bound of the value area. */
  low: number;
  /** Upper price bound of the value area. */
  high: number;
  /** Volume contained within the value area. */
  volume: number;
  /** Index range (inclusive) into the bins array. */
  lowIndex: number;
  highIndex: number;
}

export interface AnchoredVolumeProfile {
  /** Index into the source candle array where the anchor sits. */
  anchorIndex: number;
  /** Index of the last candle included (usually the most recent). */
  endIndex: number;
  scale: PriceScale;
  priceLow: number;
  priceHigh: number;
  rowSize: number;
  totalVolume: number;
  bins: ProfileBin[];
  /** Point of Control — the single highest-volume row. */
  poc: ProfileBin;
  pocIndex: number;
  valueArea: ValueArea;
}

export type ZoneKind = "break-even-demand" | "break-even-supply" | "at-price";

/**
 * A volume shelf: a contiguous cluster of high-volume rows that tends to act
 * as support (when price sits above it) or resistance (below it).
 */
export interface VolumeShelf {
  priceLow: number;
  priceHigh: number;
  /** Highest-volume row within the shelf (the shelf's local POC). */
  peakPrice: number;
  volume: number;
  /** Share (0..1) of the profile's total volume held by this shelf. */
  fraction: number;
  lowIndex: number;
  highIndex: number;
  /**
   * Relationship to the current price:
   *  - shelf below price  -> break-even demand (support)
   *  - shelf above price  -> break-even supply (resistance)
   *  - shelf straddles price -> at-price
   */
  zone: ZoneKind;
}

/**
 * A volume gap: a contiguous run of low-volume rows that price can move
 * through quickly because there is little traded supply/demand as friction.
 */
export interface VolumeGap {
  priceLow: number;
  priceHigh: number;
  volume: number;
  fraction: number;
  lowIndex: number;
  highIndex: number;
}

export interface AnalysisOptions {
  /** Number of histogram rows. The video author favours 50. */
  rowCount: number;
  scale: PriceScale;
  /** Fraction (0..1) of volume defining the value area. */
  valueAreaFraction: number;
  /**
   * A row counts as "high volume" (shelf material) when its volume is at least
   * this fraction of the POC row's volume.
   */
  shelfThreshold: number;
  /**
   * A row counts as a gap when its volume is at most this fraction of the POC
   * row's volume.
   */
  gapThreshold: number;
}

export const DEFAULT_OPTIONS: AnalysisOptions = {
  rowCount: 50,
  scale: "log",
  valueAreaFraction: 0.7,
  shelfThreshold: 0.55,
  gapThreshold: 0.12,
};
