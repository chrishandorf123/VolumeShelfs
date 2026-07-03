import { describe, expect, it } from "vitest";
import { DOW_30, NASDAQ_100, SP500, universeOf } from "./marketUniverse";
import { parseListingCsv } from "./providers/alphaVantage";

describe("index universes", () => {
  it("carries the real membership sizes", () => {
    expect(SP500.length).toBeGreaterThanOrEqual(500); // 503 with share classes
    expect(NASDAQ_100.length).toBeGreaterThanOrEqual(100);
    expect(DOW_30).toHaveLength(30);
  });

  it("uses Alpha Vantage share-class format (hyphens, never dots)", () => {
    for (const t of [...SP500, ...NASDAQ_100, ...DOW_30]) {
      expect(t).toMatch(/^[A-Z]+(-[A-Z])?$/);
    }
    expect(SP500).toContain("BRK-B");
  });

  it("dedupes the combined universe (indexes overlap heavily)", () => {
    const all = universeOf("everything");
    expect(new Set(all).size).toBe(all.length);
    // The union must cover each part.
    for (const t of DOW_30) expect(all).toContain(t);
    expect(all.length).toBeGreaterThan(SP500.length); // ETFs + non-index movers add names
  });

  it("every universe id resolves to a non-empty deduped list", () => {
    for (const id of ["liquid", "sp500", "ndx", "dow", "everything"] as const) {
      const u = universeOf(id);
      expect(u.length).toBeGreaterThan(0);
      expect(new Set(u).size).toBe(u.length);
    }
  });
});

describe("parseListingCsv (LISTING_STATUS → every US stock)", () => {
  const csv = [
    "symbol,name,exchange,assetType,ipoDate,delistingDate,status",
    "AAPL,Apple Inc,NASDAQ,Stock,1980-12-12,null,Active",
    "IBM,International Business Machines,NYSE,Stock,1962-01-02,null,Active",
    "SPY,SPDR S&P 500 ETF,NYSE ARCA,ETF,1993-01-22,null,Active", // ETF: dropped
    "ACME-WS,Acme warrants,NYSE,Stock,2021-01-01,null,Active", // warrant: dropped
    "BRK-B,Berkshire Hathaway B,NYSE,Stock,1996-05-09,null,Active", // share class: dropped
    "DEADQ,Delisted Corp,NYSE,Stock,2000-01-01,2024-05-01,Delisted", // dropped
    "ZZZZZZ,Too Long Corp,NYSE,Stock,2020-01-01,null,Active", // >5 letters: dropped
    "TINY,Tiny Co,NYSE MKT,Stock,2019-03-04,null,Active",
    "aapl,lowercase dupe,NASDAQ,Stock,1980-12-12,null,Active", // dedupes with AAPL
  ].join("\n");

  it("keeps active pure-letter common stocks and drops everything else", () => {
    expect(parseListingCsv(csv)).toEqual(["AAPL", "IBM", "TINY"]);
  });

  it("tolerates CRLF and blank trailing lines", () => {
    expect(parseListingCsv(csv.replace(/\n/g, "\r\n") + "\r\n\r\n")).toEqual(["AAPL", "IBM", "TINY"]);
  });

  it("returns empty on a header-only file", () => {
    expect(parseListingCsv("symbol,name,exchange,assetType,ipoDate,delistingDate,status\n")).toEqual([]);
  });
});
