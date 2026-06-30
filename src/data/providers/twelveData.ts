import type { Candle } from "../../core/types";
import { DataError, normalizeCandles, type DataProvider, type DataRequest } from "../types";

const INTERVALS: Record<DataRequest["interval"], string> = {
  daily: "1day",
  weekly: "1week",
  monthly: "1month",
};

interface TwelveValue {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
}

/** Twelve Data — free tier covers stocks, ETFs, FX and crypto with CORS. */
export const twelveData: DataProvider = {
  id: "twelvedata",
  label: "Twelve Data",
  requiresApiKey: true,
  keyUrl: "https://twelvedata.com/pricing",
  note: "Free key. Stocks/ETF/FX/crypto. 8 req/min, 800/day on the free tier.",

  async fetchCandles(req: DataRequest, apiKey?: string): Promise<Candle[]> {
    if (!apiKey) throw new DataError("Twelve Data requires an API key");
    const url = new URL("https://api.twelvedata.com/time_series");
    url.searchParams.set("symbol", req.symbol.trim().toUpperCase());
    url.searchParams.set("interval", INTERVALS[req.interval]);
    url.searchParams.set("outputsize", "5000");
    url.searchParams.set("apikey", apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) throw new DataError(`Twelve Data HTTP ${res.status}`);
    const json: { status?: string; message?: string; values?: TwelveValue[] } = await res.json();

    if (json.status === "error") throw new DataError(json.message ?? "Twelve Data error");
    if (!json.values?.length) throw new DataError(`No data for "${req.symbol}"`);

    const candles: Candle[] = json.values.map((v) => ({
      time: Math.floor(Date.parse(v.datetime.replace(" ", "T") + "Z") / 1000),
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
      volume: Number(v.volume ?? 0),
    }));
    return normalizeCandles(candles);
  },
};
