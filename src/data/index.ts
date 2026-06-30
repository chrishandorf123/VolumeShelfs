import { sampleProvider } from "./sample";
import { alphaVantage } from "./providers/alphaVantage";
import { twelveData } from "./providers/twelveData";
import { stooq } from "./providers/stooq";
import type { DataProvider } from "./types";

/**
 * Registry of available data providers. Order controls the dropdown order; the
 * first entry is the default. To wire in your own API, implement `DataProvider`
 * and add it to this array.
 */
export const PROVIDERS: DataProvider[] = [sampleProvider, alphaVantage, twelveData, stooq];

export function getProvider(id: string): DataProvider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export * from "./types";
export { parseCsv } from "./csv";
export { SAMPLE_DATASETS } from "./sample";
