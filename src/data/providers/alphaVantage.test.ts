import { describe, expect, it } from "vitest";
import { easternToday, parseGlobalQuote, parseIntradayQuote } from "./alphaVantage";

describe("easternToday", () => {
  it("formats as YYYY-MM-DD in US/Eastern", () => {
    // 2026-07-02 01:00 UTC is still 2026-07-01 evening in New York (EDT).
    expect(easternToday(new Date("2026-07-02T01:00:00Z"))).toBe("2026-07-01");
    expect(easternToday(new Date("2026-07-02T15:00:00Z"))).toBe("2026-07-02");
  });
});

describe("parseGlobalQuote", () => {
  const payload = {
    "Global Quote": {
      "01. symbol": "AAPL",
      "05. price": "192.50",
      "08. previous close": "190.00",
      "10. change percent": "1.3158%",
      "07. latest trading day": "2026-07-01",
    },
  };

  it("reads price, prev close and change percent", () => {
    const q = parseGlobalQuote(payload, "aapl", "2026-07-01");
    expect(q.symbol).toBe("AAPL");
    expect(q.price).toBe(192.5);
    expect(q.prevClose).toBe(190);
    expect(q.changePct).toBeCloseTo(0.013158, 6);
    expect(q.day).toBe("2026-07-01");
  });

  it("is live only when the trading day is today (ET)", () => {
    expect(parseGlobalQuote(payload, "AAPL", "2026-07-01").live).toBe(true);
    expect(parseGlobalQuote(payload, "AAPL", "2026-07-02").live).toBe(false);
  });

  it("computes change when the provider omits the percent", () => {
    const q = parseGlobalQuote(
      { "Global Quote": { "05. price": "110", "08. previous close": "100" } },
      "TST",
    );
    expect(q.changePct).toBeCloseTo(0.1, 6);
    expect(q.live).toBe(false); // no trading day reported -> never claim live
  });
});

describe("parseIntradayQuote", () => {
  // Two sessions of 5-min bars: prev day's last bar is the previous close.
  const json = {
    "Meta Data": { "2. Symbol": "AAPL" },
    "Time Series (5min)": {
      "2026-06-30 15:55": { "1. open": "188", "2. high": "189", "3. low": "187", "4. close": "188.00", "5. volume": "1000" },
      "2026-07-01 09:35": { "1. open": "189", "2. high": "191", "3. low": "189", "4. close": "190.00", "5. volume": "2000" },
      "2026-07-01 15:55": { "1. open": "194", "2. high": "195", "3. low": "193", "4. close": "193.60", "5. volume": "3000" },
    },
  };

  it("uses the newest bar as the live price with its timestamp", () => {
    const q = parseIntradayQuote(json, "AAPL", "2026-07-01")!;
    expect(q).not.toBeNull();
    expect(q.price).toBe(193.6);
    expect(q.asOf).toBe("2026-07-01 15:55");
    expect(q.day).toBe("2026-07-01");
    expect(q.live).toBe(true);
  });

  it("does not claim live when the newest bar is a prior session (weekend/holiday)", () => {
    const q = parseIntradayQuote(json, "AAPL", "2026-07-04")!;
    expect(q.live).toBe(false);
    expect(q.price).toBe(193.6); // price/asOf still reported honestly
  });

  it("uses the prior session's last bar as the previous close for % change", () => {
    const q = parseIntradayQuote(json, "AAPL", "2026-07-01")!;
    expect(q.prevClose).toBe(188);
    expect(q.changePct).toBeCloseTo((193.6 - 188) / 188, 6);
  });

  it("returns null when there is no intraday series (so caller can fall back)", () => {
    expect(parseIntradayQuote({ "Meta Data": {} }, "AAPL")).toBeNull();
    expect(parseIntradayQuote({ "Time Series (5min)": {} }, "AAPL")).toBeNull();
  });

  it("falls back to the price itself when the window has only one day", () => {
    const oneDay = {
      "Time Series (5min)": {
        "2026-07-01 09:35": { "4. close": "190.00" },
        "2026-07-01 15:55": { "4. close": "193.60" },
      },
    };
    const q = parseIntradayQuote(oneDay, "AAPL", "2026-07-01")!;
    expect(q.price).toBe(193.6);
    expect(q.prevClose).toBe(193.6); // no prior-day bar → change 0, not NaN
    expect(q.changePct).toBe(0);
  });
});
