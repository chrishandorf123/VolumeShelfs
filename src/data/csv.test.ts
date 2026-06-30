import { describe, expect, it } from "vitest";
import { parseCsv, parseDate } from "./csv";

describe("parseDate", () => {
  it("parses ISO dates to epoch seconds", () => {
    expect(parseDate("2023-01-31")).toBe(Math.floor(Date.parse("2023-01-31") / 1000));
  });
  it("treats large integers as millis and small as seconds", () => {
    expect(parseDate("1700000000")).toBe(1700000000);
    expect(parseDate("1700000000000")).toBe(1700000000);
  });
});

describe("parseCsv", () => {
  it("parses a headered comma file and sorts ascending", () => {
    const csv = [
      "Date,Open,High,Low,Close,Volume",
      "2023-01-03,11,12,10,11.5,1000",
      "2023-01-02,10,11,9,10.5,2000",
    ].join("\n");
    const candles = parseCsv(csv);
    expect(candles).toHaveLength(2);
    expect(candles[0].time).toBeLessThan(candles[1].time);
    expect(candles[0].close).toBe(10.5);
    expect(candles[1].volume).toBe(1000);
  });

  it("handles headerless positional rows", () => {
    const csv = "2023-01-02,10,11,9,10.5,2000\n2023-01-03,11,12,10,11.5,1000";
    const candles = parseCsv(csv);
    expect(candles).toHaveLength(2);
    expect(candles[0].high).toBe(11);
  });

  it("matches columns by header name regardless of order", () => {
    const csv = "Volume;Close;Low;High;Open;Date\n500;10.5;9;11;10;2023-01-02";
    const candles = parseCsv(csv);
    expect(candles[0].close).toBe(10.5);
    expect(candles[0].volume).toBe(500);
    expect(candles[0].open).toBe(10);
  });

  it("rejects a file with no usable rows", () => {
    expect(() => parseCsv("not,a,price,file\nfoo,bar,baz,qux")).toThrow();
  });
});
