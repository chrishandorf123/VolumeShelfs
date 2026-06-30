import type { Candle } from "../core/types";
import { DataError, normalizeCandles } from "./types";

/**
 * Parse OHLCV CSV text. Tolerant of common export formats from TradingView,
 * Stooq, Yahoo and most brokers:
 *   - header row optional; columns matched by name when present
 *   - date column may be ISO (2023-01-31), epoch seconds, or epoch millis
 *   - delimiter auto-detected (comma, semicolon or tab)
 */
export function parseCsv(text: string): Candle[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) throw new DataError("CSV is empty");

  const delimiter = detectDelimiter(lines[0]);
  const firstCols = lines[0].split(delimiter);
  const hasHeader = firstCols.some((c) => /[a-z]/i.test(c) && !/^\s*-?\d/.test(c));
  const header = hasHeader ? firstCols.map((c) => c.trim().toLowerCase()) : null;

  const idx = resolveColumns(header, firstCols.length);
  const rows = hasHeader ? lines.slice(1) : lines;

  const candles: Candle[] = [];
  for (const line of rows) {
    const cols = line.split(delimiter);
    if (cols.length <= idx.close) continue;
    const time = parseDate(cols[idx.time]);
    const open = Number(cols[idx.open]);
    const high = Number(cols[idx.high]);
    const low = Number(cols[idx.low]);
    const close = Number(cols[idx.close]);
    const volume = idx.volume >= 0 ? Number(cols[idx.volume]) : 0;
    if (!Number.isFinite(time)) continue;
    candles.push({ time, open, high, low, close, volume });
  }
  const normalized = normalizeCandles(candles);
  if (normalized.length === 0) throw new DataError("No valid OHLCV rows found in CSV");
  return normalized;
}

function detectDelimiter(line: string): string {
  for (const d of [",", ";", "\t"]) if (line.includes(d)) return d;
  return ",";
}

interface ColumnMap {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function resolveColumns(header: string[] | null, count: number): ColumnMap {
  if (header) {
    const find = (...names: string[]) =>
      header.findIndex((h) => names.some((n) => h === n || h.includes(n)));
    const map: ColumnMap = {
      time: find("date", "time", "timestamp"),
      open: find("open"),
      high: find("high"),
      low: find("low"),
      close: find("close", "adj close", "last"),
      volume: find("volume", "vol"),
    };
    if (map.time >= 0 && map.open >= 0 && map.high >= 0 && map.low >= 0 && map.close >= 0)
      return map;
  }
  // Positional fallback: Date,Open,High,Low,Close,Volume
  return {
    time: 0,
    open: 1,
    high: 2,
    low: 3,
    close: 4,
    volume: count > 5 ? 5 : -1,
  };
}

/** Parse a date cell into epoch seconds. */
export function parseDate(raw: string): number {
  const s = raw?.trim();
  if (!s) return NaN;
  if (/^-?\d+$/.test(s)) {
    const n = Number(s);
    // Heuristic: > 1e12 => millis, otherwise seconds.
    return n > 1e12 ? Math.floor(n / 1000) : n;
  }
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? NaN : Math.floor(ms / 1000);
}
