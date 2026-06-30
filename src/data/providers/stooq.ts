import type { Candle } from "../../core/types";
import { parseCsv } from "../csv";
import { DataError, type DataProvider, type DataRequest } from "../types";

const INTERVALS: Record<DataRequest["interval"], string> = {
  daily: "d",
  weekly: "w",
  monthly: "m",
};

/**
 * Stooq — keyless CSV endpoint. Handy when you have no API key, but the host
 * does not always send permissive CORS headers, so a browser request can be
 * blocked. Use a provider with an API key (Alpha Vantage / Twelve Data) if a
 * CORS error appears.
 */
export const stooq: DataProvider = {
  id: "stooq",
  label: "Stooq (no key)",
  requiresApiKey: false,
  keyUrl: "https://stooq.com",
  note: "No key needed. US tickers map to e.g. AAPL.US. May be CORS-blocked in some browsers.",

  async fetchCandles(req: DataRequest): Promise<Candle[]> {
    const symbol = normalizeSymbol(req.symbol);
    const url = new URL("https://stooq.com/q/d/l/");
    url.searchParams.set("s", symbol);
    url.searchParams.set("i", INTERVALS[req.interval]);

    let res: Response;
    try {
      res = await fetch(url.toString());
    } catch {
      throw new DataError(
        "Stooq request failed (likely CORS). Try Alpha Vantage or Twelve Data with a key.",
      );
    }
    if (!res.ok) throw new DataError(`Stooq HTTP ${res.status}`);
    const text = await res.text();
    if (!text.includes(",") || /no data|not found/i.test(text))
      throw new DataError(`No data for "${req.symbol}"`);
    return parseCsv(text);
  },
};

/** Stooq expects a market suffix; default bare US tickers to `.us`. */
function normalizeSymbol(symbol: string): string {
  const s = symbol.trim().toLowerCase();
  return s.includes(".") ? s : `${s}.us`;
}
