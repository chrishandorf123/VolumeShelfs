import type { Candle } from "./types";
import { atrSeries, obvSeries } from "./indicators";
import { detectSwings } from "./swings";

/**
 * The signal BEFORE the signal. The crowd's trigger is the breakout — by the
 * time it prints, the easy risk/reward is gone. What precedes real breakouts
 * is measurable, and every component here is a documented "early tell":
 *
 *  - volume dry-up: sellers exhausted (the quiet before VCP-style moves)
 *  - volatility contraction: the coiling spring (Minervini's VCP, squeezes)
 *  - OBV accumulation divergence: volume flowing IN while price goes nowhere
 *  - higher lows: buyers raising their bids into a flat ceiling
 *  - pocket pivot: one up-day whose volume swamps every down-day before it
 *    (Kacher/Morales' early-entry tell inside a base)
 *
 * All point-in-time on the last bar. This is a HEURISTIC — it front-runs the
 * obvious trigger, it does not predict; the journal is what proves whether it
 * pays. Score 0–100 with the components itemized so nothing is a black box.
 */
export interface EarlyComponent {
  id: string;
  label: string;
  pass: boolean;
  weight: number;
  detail: string;
}

export interface EarlySignal {
  /** 0–100 weighted score of early-accumulation tells. */
  score: number;
  grade: "LOADING" | "WARMING" | "QUIET";
  components: EarlyComponent[];
  headline: string;
}

const last = (xs: number[]): number => xs[xs.length - 1] ?? NaN;

/** Average of the last `n` values of a series (NaN-safe). */
function tailAvg(xs: number[], n: number): number {
  const t = xs.slice(-n).filter((v) => Number.isFinite(v));
  return t.length ? t.reduce((a, b) => a + b, 0) / t.length : NaN;
}

export function earlySignal(candles: Candle[]): EarlySignal | null {
  if (candles.length < 60) return null;
  const closes = candles.map((c) => c.close);
  const vols = candles.map((c) => c.volume);
  const components: EarlyComponent[] = [];

  // 1. Volume dry-up: 10-day average volume well under the 50-day.
  const v10 = tailAvg(vols, 10);
  const v50 = tailAvg(vols, 50);
  const dryRatio = v50 > 0 ? v10 / v50 : NaN;
  components.push({
    id: "dryup",
    label: "Volume dry-up",
    pass: Number.isFinite(dryRatio) && dryRatio <= 0.7,
    weight: 2,
    detail: Number.isFinite(dryRatio)
      ? `10-day volume is ${(dryRatio * 100).toFixed(0)}% of the 50-day — ${dryRatio <= 0.7 ? "sellers are exhausted" : "still plenty of turnover"}.`
      : "Not enough volume history.",
  });

  // 2. Volatility contraction: 10-day ATR% vs 50-day ATR% (the coiling spring).
  const atr = atrSeries(candles, 14);
  const price = last(closes);
  const atr10 = tailAvg(atr, 10) / price;
  const atr50 = tailAvg(atr, 50) / price;
  const squeeze = atr50 > 0 ? atr10 / atr50 : NaN;
  components.push({
    id: "squeeze",
    label: "Volatility squeeze",
    pass: Number.isFinite(squeeze) && squeeze <= 0.75,
    weight: 2,
    detail: Number.isFinite(squeeze)
      ? `Recent range is ${(squeeze * 100).toFixed(0)}% of its 50-day norm — ${squeeze <= 0.75 ? "coiled" : "not compressed"}.`
      : "Not enough range history.",
  });

  // 3. OBV accumulation divergence: OBV rising over 20 bars while price is
  //    flat or down — volume flowing in while the chart looks like nothing.
  const obv = obvSeries(candles);
  const obvThen = obv[obv.length - 21] ?? NaN;
  const obvNow = last(obv);
  const priceThen = closes[closes.length - 21] ?? NaN;
  const priceChg = priceThen > 0 ? price / priceThen - 1 : NaN;
  const obvScale = tailAvg(vols, 20) * 20; // normalize OBV change by typical turnover
  const obvChg = obvScale > 0 ? (obvNow - obvThen) / obvScale : NaN;
  const obvAccum = Number.isFinite(obvChg) && Number.isFinite(priceChg) && obvChg > 0.05 && priceChg < 0.04;
  components.push({
    id: "obv",
    label: "Quiet accumulation (OBV)",
    pass: obvAccum,
    weight: 2,
    detail: obvAccum
      ? `OBV climbed while price moved ${(priceChg * 100).toFixed(1)}% — someone is buying without moving the tape.`
      : "OBV isn't diverging from price right now.",
  });

  // 4. Higher lows: the last three swing lows stepping up (bids rising).
  const lows = detectSwings(candles, 3).filter((s) => s.kind === "low").slice(-3);
  const higherLows = lows.length >= 2 && lows.every((s, i) => i === 0 || s.price > lows[i - 1].price);
  components.push({
    id: "hl",
    label: "Higher lows",
    pass: higherLows,
    weight: 1.5,
    detail: higherLows
      ? `${lows.length} rising swing lows — buyers keep stepping up earlier.`
      : "Swing lows aren't stacking upward yet.",
  });

  // 5. Pocket pivot: within the last 5 bars, an UP day whose volume exceeds
  //    the highest DOWN-day volume of the prior 10 bars.
  let pocket = false;
  let pocketDetail = "No up-day has swamped the recent down-day volume.";
  const n = candles.length;
  for (let i = Math.max(11, n - 5); i < n; i++) {
    const bar = candles[i];
    if (bar.close <= bar.open) continue;
    let maxDown = 0;
    for (let j = i - 10; j < i; j++) {
      if (candles[j].close < candles[j].open) maxDown = Math.max(maxDown, candles[j].volume);
    }
    if (maxDown > 0 && bar.volume > maxDown) {
      pocket = true;
      pocketDetail = `Up-day volume beat every down-day of the prior 10 bars — an institutional footprint inside the base.`;
      break;
    }
  }
  components.push({ id: "pocket", label: "Pocket pivot", pass: pocket, weight: 1.5, detail: pocketDetail });

  // 6. Still under the lid: price within 12% of its 50-bar high but NOT
  //    breaking out yet — early means before the trigger, not after it.
  const hi50 = Math.max(...candles.slice(-50).map((c) => c.high));
  const nearLid = price >= hi50 * 0.88 && price < hi50 * 0.995;
  components.push({
    id: "lid",
    label: "Under the lid",
    pass: nearLid,
    weight: 1,
    detail: nearLid
      ? `Price is ${((1 - price / hi50) * 100).toFixed(1)}% under the ${hi50.toFixed(2)} lid — the crowd's trigger hasn't fired.`
      : price >= hi50 * 0.995
        ? "Already at/through the lid — this is the crowd's signal, not the early one."
        : "Too far below the recent high to be basing under it.",
  });

  const totalWeight = components.reduce((a, c) => a + c.weight, 0);
  const passed = components.filter((c) => c.pass).reduce((a, c) => a + c.weight, 0);
  const score = Math.round((passed / totalWeight) * 100);
  const grade: EarlySignal["grade"] = score >= 70 ? "LOADING" : score >= 45 ? "WARMING" : "QUIET";
  const top = components.filter((c) => c.pass).map((c) => c.label.toLowerCase());
  const headline =
    grade === "QUIET"
      ? "No stealth tells — nothing loading here yet."
      : `${top.slice(0, 3).join(" + ")} while the breakout trigger is still unfired — the tape is loading before the crowd's signal.`;
  return { score, grade, components, headline };
}
