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

/** Intraday bar interval used for the live monitor (see parseIntradayQuote). */
const INTRADAY_INTERVAL = "5min";

/**
 * Errors where a second (fallback) request is guaranteed to fail too: the
 * per-minute/per-day budget is exhausted, or the symbol doesn't exist.
 */
const NO_FALLBACK_RE = /rate limit|call frequency|per minute|per day|unknown symbol/i;

/** Today's date (YYYY-MM-DD) in US/Eastern — the calendar Alpha Vantage stamps use. */
export function easternToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

/**
 * Parse a GLOBAL_QUOTE payload into a Quote. Pure so it can be unit-tested and
 * reused as the fallback when intraday data isn't available for a symbol.
 */
export function parseGlobalQuote(
  json: Record<string, unknown>,
  symbol: string,
  todayEt = easternToday(),
): Quote {
  const q = json["Global Quote"] as Record<string, string> | undefined;
  if (!q || q["05. price"] === undefined) throw new DataError(`No quote for "${symbol}"`);

  const price = Number(q["05. price"]);
  const prevClose = Number(q["08. previous close"]);
  const rawPct = q["10. change percent"];
  let changePct = rawPct ? Number(String(rawPct).replace("%", "")) / 100 : NaN;
  if (!Number.isFinite(changePct))
    changePct = prevClose > 0 ? (price - prevClose) / prevClose : 0;
  if (!Number.isFinite(price)) throw new DataError(`Bad quote for "${symbol}"`);

  const day = q["07. latest trading day"] || undefined;
  return {
    symbol: symbol.trim().toUpperCase(),
    price,
    prevClose: Number.isFinite(prevClose) ? prevClose : price,
    changePct,
    day,
    // GLOBAL_QUOTE has no intraday timestamp; it's a live (today's) price
    // exactly when its trading day is the current US/Eastern date.
    asOf: day,
    live: day !== undefined && day === todayEt,
  };
}

/**
 * Parse an intraday time series into a live Quote: newest bar = current price
 * (with its exact timestamp), and the previous session's last bar = prev close
 * for today's % change. Returns null when the series is empty (e.g. a symbol
 * with no intraday feed) so the caller can fall back to GLOBAL_QUOTE.
 *
 * A "compact" 5-minute series is ~100 bars ≈ 8+ hours, so it always spans back
 * into the prior session — which is what makes the previous close available in
 * a single call.
 */
export function parseIntradayQuote(
  json: Record<string, unknown>,
  symbol: string,
  todayEt = easternToday(),
): Quote | null {
  const key = Object.keys(json).find((k) => k.startsWith("Time Series ("));
  const series = key ? (json[key] as Record<string, Record<string, string>>) : undefined;
  if (!series) return null;

  // Timestamps are "YYYY-MM-DD HH:MM"; lexical sort matches chronological order.
  const stamps = Object.keys(series).sort();
  if (stamps.length === 0) return null;

  const latest = stamps[stamps.length - 1];
  const price = Number(series[latest]["4. close"]);
  if (!Number.isFinite(price)) return null;

  const latestDay = latest.slice(0, 10);
  // Previous close = the newest bar dated before the latest bar's day.
  let prevClose = NaN;
  for (let i = stamps.length - 1; i >= 0; i--) {
    if (stamps[i].slice(0, 10) < latestDay) {
      prevClose = Number(series[stamps[i]]["4. close"]);
      break;
    }
  }

  const changePct = prevClose > 0 ? (price - prevClose) / prevClose : NaN;
  return {
    symbol: symbol.trim().toUpperCase(),
    price,
    prevClose: Number.isFinite(prevClose) ? prevClose : price,
    changePct: Number.isFinite(changePct) ? changePct : 0,
    day: latestDay,
    asOf: latest,
    // A weekend/holiday/pre-open fetch returns the prior session's bars — that
    // is NOT a live print, so only claim live when the bar is from today (ET).
    live: latestDay === todayEt,
  };
}

async function avJson(url: URL, symbol: string): Promise<Record<string, unknown>> {
  const res = await fetch(url.toString());
  if (!res.ok) throw new DataError(`Alpha Vantage HTTP ${res.status}`);
  const json: Record<string, unknown> = await res.json();
  if (json["Error Message"]) throw new DataError(`Unknown symbol "${symbol}"`);
  if (json["Note"] || json["Information"])
    throw new DataError(String(json["Note"] ?? json["Information"]));
  return json;
}

/** Alpha Vantage — generous free tier, CORS-enabled, good for daily history. */
export const alphaVantage: DataProvider = {
  id: "alphavantage",
  label: "Alpha Vantage",
  requiresApiKey: true,
  keyUrl: "https://www.alphavantage.co/support/#api-key",
  note: "Free key. Daily history for charts; live intraday quotes for the monitor.",

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

  async fetchQuote(symbol: string, apiKey?: string, pace?: () => Promise<void>): Promise<Quote> {
    if (!apiKey) throw new DataError("Alpha Vantage requires an API key");
    const sym = symbol.trim().toUpperCase();

    // Primary: the latest intraday bar — today's live price, with a timestamp.
    // extended_hours=false keeps the bars on the regular session, so the last
    // bar of the prior day IS the official close (and ~78 bars/day means the
    // compact 100-bar window always reaches back into the prior session).
    const intra = new URL("https://www.alphavantage.co/query");
    intra.searchParams.set("function", "TIME_SERIES_INTRADAY");
    intra.searchParams.set("symbol", sym);
    intra.searchParams.set("interval", INTRADAY_INTERVAL);
    intra.searchParams.set("outputsize", "compact");
    intra.searchParams.set("extended_hours", "false");
    intra.searchParams.set("apikey", apiKey);
    try {
      const quote = parseIntradayQuote(await avJson(intra, sym), sym);
      if (quote) return quote;
    } catch (err) {
      // A rate-limit hit or unknown symbol means the fallback request is
      // guaranteed to fail too — surface it instead of burning another call.
      if (err instanceof DataError && NO_FALLBACK_RE.test(err.message)) throw err;
      // Anything else (e.g. premium-endpoint notice) — fall through.
    }

    // Fallback: GLOBAL_QUOTE (latest price + prior close; day-level freshness).
    // It's a SECOND request, so take a fresh rate-limit slot when the caller
    // paces per call.
    await pace?.();
    const gq = new URL("https://www.alphavantage.co/query");
    gq.searchParams.set("function", "GLOBAL_QUOTE");
    gq.searchParams.set("symbol", sym);
    gq.searchParams.set("apikey", apiKey);
    return parseGlobalQuote(await avJson(gq, sym), sym);
  },
};
