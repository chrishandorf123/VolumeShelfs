import type { Candle } from "../core/types";

export type Interval = "daily" | "weekly" | "monthly";

export interface DataRequest {
  symbol: string;
  interval: Interval;
}

/**
 * A pluggable market-data source. Add your own by implementing this interface
 * and registering it in `src/data/index.ts` — the UI will pick it up
 * automatically, including the API-key field when `requiresApiKey` is true.
 */
export interface DataProvider {
  /** Stable id used in the UI selector and persisted settings. */
  readonly id: string;
  /** Human-friendly name shown in the provider dropdown. */
  readonly label: string;
  /** When true, the UI shows an API-key input bound to this provider. */
  readonly requiresApiKey: boolean;
  /** Optional link to where a user can obtain a key. */
  readonly keyUrl?: string;
  /** Short note rendered under the provider in the UI. */
  readonly note?: string;
  fetchCandles(req: DataRequest, apiKey?: string): Promise<Candle[]>;
}

export class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataError";
  }
}

/** Sort ascending by time and drop any rows with non-finite values. */
export function normalizeCandles(candles: Candle[]): Candle[] {
  return candles
    .filter(
      (c) =>
        Number.isFinite(c.time) &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close) &&
        Number.isFinite(c.volume) &&
        c.high >= c.low,
    )
    .sort((a, b) => a.time - b.time);
}
