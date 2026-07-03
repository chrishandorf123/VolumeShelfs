import type { Candle } from "./types";
import { mtfAlignment, stageOf } from "./shannon";

/**
 * Market regime traffic light, computed on the BENCHMARK (e.g. SPY).
 * The 200-day regime filter is one of the best-documented edges in trend
 * trading: long breakouts succeed far more often above a rising 200-day, and
 * most account-destroying losses happen fighting a bear regime. GREEN = full
 * size, YELLOW = half size / be picky, RED = no new longs (shorts only).
 */
export type RegimeLight = "green" | "yellow" | "red" | "unknown";

export interface MarketRegime {
  light: RegimeLight;
  stage: 1 | 2 | 3 | 4 | null;
  weekly: "up" | "down" | "neutral";
  detail: string;
}

export function marketRegime(benchmark: Candle[]): MarketRegime {
  if (benchmark.length < 260) {
    return {
      light: "unknown",
      stage: null,
      weekly: "neutral",
      detail: "Not enough benchmark history for a regime read — treat as caution.",
    };
  }
  const stage = stageOf(benchmark);
  const mtf = mtfAlignment(benchmark);
  const s = stage?.stage ?? null;

  let light: RegimeLight;
  let detail: string;
  if (s === 2 && mtf.weekly !== "down") {
    light = "green";
    detail = "Benchmark in stage-2 markup with the weekly pointing up — long setups have the market's wind behind them.";
  } else if (s === 4 || (s === null && mtf.weekly === "down")) {
    light = "red";
    detail = "Benchmark in stage-4 decline — most long breakouts fail here. No new longs; short setups and cash are the play.";
  } else {
    light = "yellow";
    detail = "Benchmark between trends (base/top or mixed timeframes) — trade half size and demand A+ setups only.";
  }
  return { light, stage: s, weekly: mtf.weekly, detail };
}
