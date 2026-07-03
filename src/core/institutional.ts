import type { Candle } from "./types";
import { obvSeries } from "./indicators";

/**
 * Institutional footprint: funds can't buy quietly — their size leaves marks
 * in the tape. The classic tells (O'Neil's accumulation/distribution work,
 * up/down volume studies) are all computable from OHLCV:
 *
 *  - accumulation vs distribution days: heavy-volume up-closes vs down-closes
 *  - up/down volume ratio: where the actual shares traded, not the price
 *  - closing range on heavy days: who won the close when the volume showed up
 *  - initiation days: outsized-volume up-days (a desk starting a position)
 *  - OBV trend: cumulative pressure over the window
 *
 * Point-in-time on the last bar. A heuristic read of WHO is active — pair it
 * with the Early Signal (WHEN they're active before the trigger).
 */
export interface InstEvidence {
  id: string;
  label: string;
  /** -1 bearish · 0 neutral · +1 bullish for this piece of evidence. */
  vote: -1 | 0 | 1;
  weight: number;
  detail: string;
}

export interface InstitutionalRead {
  /** 0 (heavy distribution) … 100 (heavy accumulation); 50 = neutral. */
  score: number;
  /** O'Neil-style letter: A/B accumulation · C neutral · D/E distribution. */
  rating: "A" | "B" | "C" | "D" | "E";
  verdict: "accumulating" | "neutral" | "distributing";
  evidence: InstEvidence[];
  headline: string;
}

const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function institutionalRead(candles: Candle[], lookback = 25): InstitutionalRead | null {
  if (candles.length < 60) return null;
  const win = candles.slice(-lookback);
  const vol50 = avg(candles.slice(-50).map((c) => c.volume));
  if (!(vol50 > 0)) return null;
  const evidence: InstEvidence[] = [];

  // 1. Accumulation vs distribution days (heavy-volume closes, net count).
  let accDays = 0;
  let distDays = 0;
  for (const c of win) {
    if (c.volume < vol50 * 1.2) continue;
    if (c.close > c.open) accDays += 1;
    else if (c.close < c.open) distDays += 1;
  }
  const netAD = accDays - distDays;
  evidence.push({
    id: "ad",
    label: "Accumulation vs distribution days",
    vote: netAD >= 2 ? 1 : netAD <= -2 ? -1 : 0,
    weight: 2,
    detail: `${accDays} heavy-volume up days vs ${distDays} down days in ${lookback} bars.`,
  });

  // 2. Up/down volume ratio: where the shares actually traded.
  const upVol = win.filter((c) => c.close > c.open).reduce((a, c) => a + c.volume, 0);
  const downVol = win.filter((c) => c.close < c.open).reduce((a, c) => a + c.volume, 0);
  const udRatio = downVol > 0 ? upVol / downVol : upVol > 0 ? 9 : 1;
  evidence.push({
    id: "ud",
    label: "Up/down volume ratio",
    vote: udRatio >= 1.4 ? 1 : udRatio <= 0.7 ? -1 : 0,
    weight: 2,
    detail: `${udRatio.toFixed(2)} — ${udRatio >= 1.4 ? "demand dominates" : udRatio <= 0.7 ? "supply dominates" : "balanced"}.`,
  });

  // 3. Closing range on heavy-volume days: who won the close when size showed up.
  const heavy = win.filter((c) => c.volume >= vol50 * 1.5 && c.high > c.low);
  const closePos = heavy.length >= 3 ? avg(heavy.map((c) => (c.close - c.low) / (c.high - c.low))) : NaN;
  evidence.push({
    id: "close",
    label: "Heavy-day closing range",
    vote: Number.isFinite(closePos) ? (closePos >= 0.62 ? 1 : closePos <= 0.38 ? -1 : 0) : 0,
    weight: 1.5,
    detail: Number.isFinite(closePos)
      ? `Closes land at ${(closePos * 100).toFixed(0)}% of the range on ${heavy.length} heavy days — ${closePos >= 0.62 ? "buyers own the close" : closePos <= 0.38 ? "sellers own the close" : "contested"}.`
      : "Too few heavy-volume days to read the closes.",
  });

  // 4. Initiation days: outsized volume + a strong up close (a desk starting).
  const initiations = win.filter((c) => c.volume >= vol50 * 2 && c.close >= c.open * 1.01).length;
  const dumps = win.filter((c) => c.volume >= vol50 * 2 && c.close <= c.open * 0.99).length;
  evidence.push({
    id: "init",
    label: "Big-money days",
    vote: initiations > dumps ? 1 : dumps > initiations ? -1 : 0,
    weight: 1.5,
    detail: `${initiations} outsized up days vs ${dumps} outsized down days (≥2× average volume).`,
  });

  // 5. OBV trend across the window: cumulative pressure.
  const obv = obvSeries(candles);
  const obvNow = obv[obv.length - 1];
  const obvThen = obv[obv.length - 1 - lookback] ?? NaN;
  const obvScale = vol50 * lookback;
  const obvChg = obvScale > 0 ? (obvNow - obvThen) / obvScale : NaN;
  evidence.push({
    id: "obv",
    label: "Cumulative volume pressure (OBV)",
    vote: Number.isFinite(obvChg) ? (obvChg > 0.08 ? 1 : obvChg < -0.08 ? -1 : 0) : 0,
    weight: 1.5,
    detail: Number.isFinite(obvChg)
      ? `${obvChg > 0 ? "+" : ""}${(obvChg * 100).toFixed(0)}% of a window's typical turnover flowed ${obvChg >= 0 ? "in" : "out"}.`
      : "Not enough OBV history.",
  });

  const totalWeight = evidence.reduce((a, e) => a + e.weight, 0);
  const net = evidence.reduce((a, e) => a + e.vote * e.weight, 0);
  const score = Math.round(50 + (net / totalWeight) * 50);
  const rating: InstitutionalRead["rating"] =
    score >= 75 ? "A" : score >= 60 ? "B" : score > 40 ? "C" : score > 25 ? "D" : "E";
  const verdict: InstitutionalRead["verdict"] =
    score >= 60 ? "accumulating" : score <= 40 ? "distributing" : "neutral";
  const headline =
    verdict === "accumulating"
      ? "The tape shows institutional buying — heavy-volume days are going to the buyers."
      : verdict === "distributing"
        ? "The tape shows distribution — size is selling into strength. Longs are swimming upstream."
        : "No clear institutional footprint either way right now.";
  return { score, rating, verdict, evidence, headline };
}
