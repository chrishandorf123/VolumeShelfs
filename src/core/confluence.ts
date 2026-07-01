import type { Candle } from "./types";
import { anchoredVwapBands } from "./avwapStrategy";
import { bullishReversalBar, resampleWeekly, slopeOf, smaLast, smaSeries } from "./indicators";

/**
 * Wujastyk's full method as a single scoreable gate — the "confirmation
 * checklist". Ten independent reads across his six tiers (confluence · trigger ·
 * volume · momentum · market/RS · exhaustion). Crucially it is weighted toward
 * his documented edge: reward reversion-into-support *with confirmation*, and
 * warn against momentum-chasing an already-extended name.
 */
export interface ChecklistItem {
  id: string;
  tier: number;
  label: string;
  pass: boolean;
  detail: string;
}

export interface ConfluenceScore {
  items: ChecklistItem[];
  passed: number;
  total: number;
  /** 0..100. */
  score: number;
  grade: "A+" | "A" | "B" | "C";
  /** Jake's edge: uptrend, on a shelf, stretched below the anchored mean. */
  reversionIntoStrength: boolean;
  /** Chase warning: price 2+ SD above the anchored mean. */
  chasing: boolean;
  /** How many standard deviations price sits from the anchored mean (+ = above). */
  distanceSD: number;
  verdict: string;
}

export interface ConfluenceInputs {
  candles: Candle[];
  benchmark: Candle[];
  price: number;
  anchorIndex: number;
  /** Price is at/on a support HVN shelf. */
  onShelf: boolean;
  /** ≥2 anchored VWAPs cluster at price (the pinch). */
  pinchActive: boolean;
  valueAreaLow: number;
  valueAreaHigh: number;
  ma200: number;
  aboveMa200: boolean;
  ma5Rising: boolean;
  rsi: number;
  macdHistRising: boolean;
  avwapReclaim: boolean;
  keyAvwap: number;
  rsOutperform: boolean;
  /** Support-shelf low (stop reference) and the nearest overhead target. */
  supportLow: number | null;
  overheadTarget: number;
}

function meanVolume(candles: Candle[], lookback: number): number {
  const n = candles.length;
  const start = Math.max(0, n - lookback);
  let sum = 0;
  let count = 0;
  for (let i = start; i < n; i++) {
    sum += candles[i].volume;
    count += 1;
  }
  return count > 0 ? sum / count : NaN;
}

/** Higher-timeframe (weekly) uptrend: close above a rising ~10-week average. */
function weeklyUptrend(candles: Candle[]): boolean {
  const wk = resampleWeekly(candles);
  // Need enough weeks that the 10-week MA slope (lookback 4) is actually defined
  // — otherwise slopeOf reads a NaN and returns "unknown", which would slip past
  // a "!= falling" guard even while the MA is genuinely falling.
  if (wk.length < 15) return false;
  const closes = wk.map((c) => c.close);
  const ma = smaLast(closes, 10);
  const slope = slopeOf(smaSeries(closes, 10), 4, 0.003);
  return (
    Number.isFinite(ma) && wk[wk.length - 1].close > ma && (slope === "rising" || slope === "flat")
  );
}

/** The benchmark (SPY/QQQ) is not actively breaking down: above a non-falling 50-MA. */
function benchmarkHealthy(benchmark: Candle[]): boolean {
  const closes = benchmark.map((c) => c.close);
  const ma = smaLast(closes, 50);
  if (!Number.isFinite(ma) || benchmark.length === 0) return false;
  return benchmark[benchmark.length - 1].close > ma && slopeOf(smaSeries(closes, 50), 10, 0.005) !== "falling";
}

export function computeConfluence(inp: ConfluenceInputs): ConfluenceScore {
  const { candles, price } = inp;
  const i = candles.length - 1;

  // ---- exhaustion: how far price sits from the anchored mean, in SD ---------
  const bands = anchoredVwapBands(candles, inp.anchorIndex, 1);
  const mean = bands.vwap[i];
  const sigma = Number.isFinite(bands.upper[i]) ? bands.upper[i] - bands.vwap[i] : NaN;
  // Guard against a degenerate window: when the anchor sits at (or right before)
  // the last bar the variance is ~0, so a float artifact would blow distanceSD up
  // to a nonsense value and trip a false chasing / not-extended read. Require a
  // few bars of history and a meaningfully positive sigma, else treat as neutral.
  const barsFromAnchor = i - inp.anchorIndex;
  const distanceSD =
    barsFromAnchor >= 10 && Number.isFinite(mean) && sigma > price * 5e-4
      ? (price - mean) / sigma
      : 0;

  // ---- volume conviction ----------------------------------------------------
  const avg20 = meanVolume(candles, 20);
  const relVol = Number.isFinite(avg20) && avg20 > 0 ? candles[i].volume / avg20 : 0;

  // ---- trade quality --------------------------------------------------------
  const stop = inp.supportLow ?? price * 0.95;
  const risk = price - stop;
  const riskPct = price > 0 ? risk / price : NaN;
  const rr = risk > 0 ? (inp.overheadTarget - price) / risk : 0;

  const reversal = bullishReversalBar(candles);
  const benchOk = benchmarkHealthy(inp.benchmark);
  const weeklyOk = weeklyUptrend(candles);

  const items: ChecklistItem[] = [
    {
      id: "structure",
      tier: 1,
      label: "On a shelf, above the 200-day, 5-day rising",
      pass: inp.onShelf && inp.aboveMa200 && inp.ma5Rising,
      detail: `${inp.onShelf ? "on shelf" : "not at shelf"} · ${inp.aboveMa200 ? ">200MA" : "<200MA"} · 5MA ${inp.ma5Rising ? "rising" : "flat/down"}`,
    },
    {
      id: "pinch",
      tier: 1,
      label: "≥2 anchored VWAPs cluster here (the pinch)",
      pass: inp.pinchActive,
      detail: inp.pinchActive ? "AVWAP pinch at price" : "no pinch at price",
    },
    {
      id: "value-area",
      tier: 1,
      label: "Holding at/above the value-area low (VAL)",
      pass: Number.isFinite(inp.valueAreaLow) && price >= inp.valueAreaLow,
      detail: `price ${price.toFixed(2)} vs VAL ${inp.valueAreaLow.toFixed(2)}`,
    },
    {
      id: "trigger",
      tier: 2,
      label: "Reversal / AVWAP-reclaim candle on the level",
      pass: reversal || inp.avwapReclaim,
      detail: reversal ? "bullish reversal bar" : inp.avwapReclaim ? "AVWAP reclaim" : "no trigger yet",
    },
    {
      id: "volume",
      tier: 3,
      label: "Reaction volume ≥1.5× the 20-day average",
      pass: relVol >= 1.5,
      detail: Number.isFinite(relVol) ? `${relVol.toFixed(1)}× 20-day vol` : "—",
    },
    {
      id: "momentum",
      tier: 4,
      label: "RSI > 50 and MACD histogram turning up",
      pass: inp.rsi > 50 && inp.macdHistRising,
      detail: `RSI ${Number.isFinite(inp.rsi) ? inp.rsi.toFixed(0) : "—"} · MACD hist ${inp.macdHistRising ? "up" : "down"}`,
    },
    {
      id: "market-rs",
      tier: 5,
      label: "Market not breaking down · name outperforming",
      pass: benchOk && inp.rsOutperform,
      detail: `${benchOk ? "benchmark ok" : "benchmark weak"} · RS ${inp.rsOutperform ? "leader" : "lagging"}`,
    },
    {
      id: "weekly",
      tier: 5,
      label: "Weekly bias aligned with the daily setup",
      pass: weeklyOk,
      detail: weeklyOk ? "weekly uptrend" : "weekly not up",
    },
    {
      id: "not-extended",
      tier: 6,
      label: "Within ~1 SD of the anchored mean (not chasing)",
      pass: distanceSD <= 1,
      detail: `${distanceSD >= 0 ? "+" : ""}${distanceSD.toFixed(1)} SD from mean`,
    },
    {
      id: "risk",
      tier: 6,
      label: "Clean invalidation, R:R ≥ 1.5",
      pass: Number.isFinite(riskPct) && riskPct <= 0.12 && rr >= 1.5,
      detail: Number.isFinite(riskPct) ? `${(riskPct * 100).toFixed(1)}% risk · ${rr.toFixed(1)}R` : "—",
    },
  ];

  const passed = items.filter((it) => it.pass).length;
  const total = items.length;
  const score = Math.round((passed / total) * 100);
  const grade: ConfluenceScore["grade"] = passed >= 8 ? "A+" : passed >= 6 ? "A" : passed >= 4 ? "B" : "C";

  // Jake's edge: an uptrend name on a shelf, stretched at/below its anchored mean
  // (room to run up to it) — reversion INTO strength, not a breakout chase.
  const reversionIntoStrength = inp.aboveMa200 && inp.ma5Rising && inp.onShelf && distanceSD <= 0.5;
  const chasing = distanceSD >= 2;

  let verdict: string;
  if (chasing) {
    verdict = `Extended ${distanceSD.toFixed(1)} SD above the anchored mean — that's a take-profit zone, not an entry. Wait for a pullback toward the mean.`;
  } else if (reversionIntoStrength && passed >= 6) {
    verdict = `Reversion-into-strength: uptrend, on the shelf, sitting ${distanceSD <= 0 ? "below" : "at"} the anchored mean with confirmation building (${passed}/10). This is the edge — buy the support, stop just past the cluster.`;
  } else if (passed >= 6) {
    verdict = `${passed}/10 confirmations at this zone — a workable setup; wait for the trigger and volume before sizing up.`;
  } else if (passed >= 4) {
    verdict = `${passed}/10 — the zone is interesting but unconfirmed. Watchlist it; a level that isn't confirmed by volume and price action is a pass, not a trade.`;
  } else {
    verdict = `Only ${passed}/10 confirmations — no edge here yet. Stand down.`;
  }

  return {
    items,
    passed,
    total,
    score,
    grade,
    reversionIntoStrength,
    chasing,
    distanceSD,
    verdict,
  };
}
