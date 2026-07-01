import type { Candle } from "../../core/types";
import {
  DataError,
  normalizeCandles,
  type DataProvider,
  type DataRequest,
  type Quote,
} from "../types";

const FUNCTIONS: Record<DataRequest["interval"], { fn: string; key: string }> = {
  daily: { fn: "TIME_SERIES_DAILY", key: "Time Series (Daily)" },
  weekly: { fn: "TIME_SERIES_WEEKLY", key: "Weekly Time Series" },
  monthly: { fn: "TIME_SERIES_MONTHLY", key: "Monthly Time Series" },
};

/** Alpha Vantage — generous free tier, CORS-enabled, good for daily history. */
export const alphaVantage: DataProvider = {
  id: "alphavantage",
  label: "Alpha Vantage",
  requiresApiKey: true,
  keyUrl: "https://www.alphavantage.co/support/#api-key",
  note: "Free key. Daily/weekly/monthly equities. ~25 req/day on the free tier.",

  async fetchCandles(req: DataRequest, apiKey?: string): Promise<Candle[]> {
    if (!apiKey) throw new DataError("Alpha Vantage requires an API key");
    const { fn, key } = FUNCTIONS[req.interval];
    const url = new URL("https://www.alphavantage.co/query");
    url.searchParams.set("function", fn);
    url.searchParams.set("symbol", req.symbol.trim().toUpperCase());
    url.searchParams.set("outputsize", "full");
    url.searchParams.set("apikey", apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) throw new DataError(`Alpha Vantage HTTP ${res.status}`);
    const json: Record<string, unknown> = await res.json();

    if (json["Error Message"]) throw new DataError(`Unknown symbol "${req.symbol}"`);
    if (json["Note"] || json["Information"])
      throw new DataError(String(json["Note"] ?? json["Information"]));

    const series = json[key] as Record<string, Record<string, string>> | undefined;
    if (!series) throw new DataError("Alpha Vantage returned no time series");

    const candles: Candle[] = Object.entries(series).map(([date, ohlc]) => ({
      time: Math.floor(Date.parse(date + "T00:00:00Z") / 1000),
      open: Number(ohlc["1. open"]),
      high: Number(ohlc["2. high"]),
      low: Number(ohlc["3. low"]),
      close: Number(ohlc["4. close"]),
      volume: Number(ohlc["5. volume"]),
    }));
    return normalizeCandles(candles);
  },

  async fetchQuote(symbol: string, apiKey?: string): Promise<Quote> {
    if (!apiKey) throw new DataError("Alpha Vantage requires an API key");
    const sym = symbol.trim().toUpperCase();
    const url = new URL("https://www.alphavantage.co/query");
    url.searchParams.set("function", "GLOBAL_QUOTE");
    url.searchParams.set("symbol", sym);
    url.searchParams.set("apikey", apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) throw new DataError(`Alpha Vantage HTTP ${res.status}`);
    const json: Record<string, unknown> = await res.json();

    if (json["Error Message"]) throw new DataError(`Unknown symbol "${symbol}"`);
    if (json["Note"] || json["Information"])
      throw new DataError(String(json["Note"] ?? json["Information"]));

    const q = json["Global Quote"] as Record<string, string> | undefined;
    if (!q || q["05. price"] === undefined)
      throw new DataError(`No quote for "${symbol}"`);

    const price = Number(q["05. price"]);
    const prevClose = Number(q["08. previous close"]);
    // Prefer the provider's own change-percent; fall back to computing it.
    const rawPct = q["10. change percent"];
    let changePct = rawPct ? Number(String(rawPct).replace("%", "")) / 100 : NaN;
    if (!Number.isFinite(changePct))
      changePct = prevClose > 0 ? (price - prevClose) / prevClose : 0;

    if (!Number.isFinite(price)) throw new DataError(`Bad quote for "${symbol}"`);

    return {
      symbol: sym,
      price,
      prevClose: Number.isFinite(prevClose) ? prevClose : price,
      changePct,
      day: q["07. latest trading day"] || undefined,
    };
  },
};
