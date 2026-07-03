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

// ---- asset classes: stocks, crypto pairs, FX pairs -------------------------
// "BTC/USD" or "BTC-USD" → crypto; "EUR/USD" → FX; anything else → stock.
const FIAT = new Set([
  "USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "CNY", "HKD",
  "SEK", "NOK", "DKK", "MXN", "SGD", "KRW", "INR", "BRL", "ZAR", "TRY", "PLN",
]);

export type AssetClass =
  | { kind: "stock"; symbol: string }
  | { kind: "crypto"; base: string; quote: string }
  | { kind: "fx"; from: string; to: string };

/** Classify a user-typed symbol. Pairs split on "/" or "-"; fiat base = FX. */
export function classifyAsset(symbol: string): AssetClass {
  const sym = symbol.trim().toUpperCase();
  const m = sym.match(/^([A-Z0-9]{2,10})[/-]([A-Z]{3})$/);
  if (!m) return { kind: "stock", symbol: sym };
  const [, base, quote] = m;
  if (FIAT.has(base)) return { kind: "fx", from: base, to: quote };
  return { kind: "crypto", base, quote };
}

/**
 * Read an OHLC field from a crypto/FX row across Alpha Vantage's format
 * generations ("1. open", "1a. open (USD)", …).
 */
function pick(row: Record<string, string>, n: number, name: string): number {
  const exact = row[`${n}. ${name}`];
  if (exact !== undefined) return Number(exact);
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith(`${n}`) && k.includes(name)) return Number(v);
  }
  return NaN;
}

/** Parse an FX or crypto daily/weekly/monthly series into candles. FX has no
 * volume, and crypto's may be missing per format — default those bars to 1 so
 * AVWAP degrades to a plain average instead of dividing by zero. */
export function parsePairSeries(json: Record<string, unknown>, seriesPrefix: string): Candle[] {
  const key = Object.keys(json).find((k) => k.startsWith(seriesPrefix));
  const series = key ? (json[key] as Record<string, Record<string, string>>) : undefined;
  if (!series) throw new DataError("Alpha Vantage returned no time series");
  const candles: Candle[] = Object.entries(series).map(([date, row]) => {
    const vol = pick(row, 5, "volume");
    return {
      time: Math.floor(Date.parse(date.slice(0, 10) + "T00:00:00Z") / 1000),
      open: pick(row, 1, "open"),
      high: pick(row, 2, "high"),
      low: pick(row, 3, "low"),
      close: pick(row, 4, "close"),
      volume: Number.isFinite(vol) && vol > 0 ? vol : 1,
    };
  });
  return normalizeCandles(candles);
}

/** Parse CURRENCY_EXCHANGE_RATE into a live Quote (crypto + FX, 24h markets). */
export function parseExchangeRate(json: Record<string, unknown>, symbol: string): Quote {
  const r = json["Realtime Currency Exchange Rate"] as Record<string, string> | undefined;
  const price = r ? Number(r["5. Exchange Rate"]) : NaN;
  if (!r || !Number.isFinite(price)) throw new DataError(`No exchange rate for "${symbol}"`);
  const asOf = r["6. Last Refreshed"] || undefined;
  return {
    symbol: symbol.trim().toUpperCase(),
    price,
    prevClose: price,
    // The endpoint has no prior close; NaN renders as "—" instead of a fake 0%.
    changePct: NaN,
    day: asOf?.slice(0, 10),
    asOf,
    live: true, // 24h markets: the realtime rate IS the live print
  };
}

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

/**
 * Parse Alpha Vantage's LISTING_STATUS CSV (symbol,name,exchange,assetType,
 * ipoDate,delistingDate,status) into a clean ticker list: active common
 * stocks on the major exchanges, pure-letter symbols only. Hyphen/dot symbols
 * (warrants, units, preferreds, share classes) are dropped — they're
 * overwhelmingly illiquid noise that just burns API calls at the liquidity gate.
 */
export function parseListingCsv(csv: string): string[] {
  const out = new Set<string>();
  const lines = csv.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 7) continue;
    const symbol = (cols[0] ?? "").trim().toUpperCase();
    const exchange = (cols[2] ?? "").trim();
    const assetType = (cols[3] ?? "").trim();
    const status = (cols[6] ?? "").trim();
    if (status !== "Active" || assetType !== "Stock") continue;
    if (!/^(NYSE|NASDAQ|AMEX|BATS)/i.test(exchange)) continue;
    if (/^[A-Z]{1,5}$/.test(symbol)) out.add(symbol);
  }
  return [...out].sort();
}

/** Every active US-listed common stock, straight from the exchange listings. */
export async function fetchUsListings(apiKey: string): Promise<string[]> {
  const url = new URL("https://www.alphavantage.co/query");
  url.searchParams.set("function", "LISTING_STATUS");
  url.searchParams.set("apikey", apiKey);
  const res = await fetch(url.toString());
  if (!res.ok) throw new DataError(`Alpha Vantage HTTP ${res.status}`);
  const text = await res.text();
  // Errors/notices come back as JSON where the CSV should be.
  if (text.trimStart().startsWith("{")) {
    throw new DataError("Alpha Vantage didn't return the listings CSV — check the API key / rate limit.");
  }
  const symbols = parseListingCsv(text);
  if (symbols.length === 0) throw new DataError("No active listings parsed from Alpha Vantage.");
  return symbols;
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
  note: "Free key. Stocks + crypto (BTC/USD) + FX (EUR/USD); live quotes for the monitor.",

  async fetchCandles(req: DataRequest, apiKey?: string): Promise<Candle[]> {
    if (!apiKey) throw new DataError("Alpha Vantage requires an API key");
    const asset = classifyAsset(req.symbol);

    // Crypto pairs (BTC/USD) — 24h markets, real volume.
    if (asset.kind === "crypto") {
      const fn = { daily: "DIGITAL_CURRENCY_DAILY", weekly: "DIGITAL_CURRENCY_WEEKLY", monthly: "DIGITAL_CURRENCY_MONTHLY" }[req.interval];
      const url = new URL("https://www.alphavantage.co/query");
      url.searchParams.set("function", fn);
      url.searchParams.set("symbol", asset.base);
      url.searchParams.set("market", asset.quote);
      url.searchParams.set("apikey", apiKey);
      return parsePairSeries(await avJson(url, req.symbol), "Time Series (Digital Currency");
    }

    // FX pairs (EUR/USD) — no volume; profile math degrades to time-based.
    if (asset.kind === "fx") {
      const fn = { daily: "FX_DAILY", weekly: "FX_WEEKLY", monthly: "FX_MONTHLY" }[req.interval];
      const url = new URL("https://www.alphavantage.co/query");
      url.searchParams.set("function", fn);
      url.searchParams.set("from_symbol", asset.from);
      url.searchParams.set("to_symbol", asset.to);
      if (req.interval === "daily") url.searchParams.set("outputsize", "full");
      url.searchParams.set("apikey", apiKey);
      return parsePairSeries(await avJson(url, req.symbol), "Time Series FX");
    }

    const { fn, key } = FUNCTIONS[req.interval];
    const url = new URL("https://www.alphavantage.co/query");
    url.searchParams.set("function", fn);
    url.searchParams.set("symbol", asset.symbol);
    url.searchParams.set("outputsize", "full");
    url.searchParams.set("apikey", apiKey);

    const json = await avJson(url, req.symbol);
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

    // Crypto/FX pairs: one realtime exchange-rate call (24h markets = live).
    const asset = classifyAsset(sym);
    if (asset.kind !== "stock") {
      const url = new URL("https://www.alphavantage.co/query");
      url.searchParams.set("function", "CURRENCY_EXCHANGE_RATE");
      url.searchParams.set("from_currency", asset.kind === "crypto" ? asset.base : asset.from);
      url.searchParams.set("to_currency", asset.kind === "crypto" ? asset.quote : asset.to);
      url.searchParams.set("apikey", apiKey);
      return parseExchangeRate(await avJson(url, sym), sym);
    }

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
