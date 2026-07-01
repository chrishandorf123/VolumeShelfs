import type { AnchoredVolumeProfile, Candle } from "./types";
import { macd, percentRange, rsiLast, slopeOf, smaSeries } from "./indicators";

/**
 * Wujastyk's secondary-confirmation layer — the momentum/oscillator reads he
 * stacks *around* the volume core (shelf + AVWAP + pinch): MACD, RSI, "% range"
 * and the 5/200 SMAs. It also computes his published scanner filter, the
 * "mean-reversion-into-strength" setup:
 *
 *   price above the volume-by-price POC · price below the anchored VWAP ·
 *   price above the 200 SMA · the 5 SMA rising
 *
 * i.e. a healthy long-term trend (above the 200), short-term turning up (5 SMA
 * rising), sitting on a volume floor (above the POC), but still below the
 * anchored average — room to run up to the mean.
 */
export interface Confirmation {
  macd: { value: number; signal: number; hist: number; bullish: boolean; histRising: boolean };
  rsi: { value: number; state: "oversold" | "neutral" | "overbought" };
  /** 0..1 position of the close within its 14-bar range (0 = low, 1 = high). */
  pctRange: number;
  ma5Rising: boolean;
  /** Wujastyk's published mean-reversion-into-strength scanner filter. */
  meanReversionSetup: boolean;
  /** Count of confirming momentum reads (MACD up, RSI not overbought, 5 SMA up). */
  score: number;
  /** Plain-English confirmation reads for the UI. */
  notes: string[];
}

export interface ConfirmationInputs {
  candles: Candle[];
  profile: AnchoredVolumeProfile;
  price: number;
  /** Anchored VWAP value at the key (break-even) anchor. */
  keyAvwap: number;
  ma200: number;
}

export function computeConfirmation(inp: ConfirmationInputs): Confirmation {
  const closes = inp.candles.map((c) => c.close);
  const i = closes.length - 1;

  const m = macd(closes);
  const macdVal = m.macd[i];
  const sig = m.signal[i];
  const hist = m.hist[i];
  const histPrev = m.hist[i - 1];
  const macdBullish = Number.isFinite(macdVal) && Number.isFinite(sig) && macdVal > sig;
  const histRising = Number.isFinite(hist) && Number.isFinite(histPrev) && hist > histPrev;

  const rsi = rsiLast(closes, 14);
  const rsiState: Confirmation["rsi"]["state"] =
    rsi >= 70 ? "overbought" : rsi <= 30 ? "oversold" : "neutral";

  const pct = percentRange(inp.candles, 14);

  const ma5 = smaSeries(closes, 5);
  const ma5Rising = slopeOf(ma5, 3, 0) === "rising";

  const poc = inp.profile.poc.mid;
  const meanReversionSetup =
    inp.price > poc &&
    Number.isFinite(inp.keyAvwap) &&
    inp.price < inp.keyAvwap &&
    Number.isFinite(inp.ma200) &&
    inp.price > inp.ma200 &&
    ma5Rising;

  const score = (macdBullish ? 1 : 0) + (rsiState !== "overbought" ? 1 : 0) + (ma5Rising ? 1 : 0);

  const notes: string[] = [];
  notes.push(
    macdBullish
      ? `MACD is above its signal${histRising ? " and the histogram is expanding" : ""} — momentum is turning up.`
      : `MACD is below its signal${histRising ? " but the histogram is improving" : " and still weak"} — momentum hasn't turned up yet.`,
  );
  notes.push(
    Number.isFinite(rsi)
      ? rsiState === "oversold"
        ? `RSI ${rsi.toFixed(0)} is oversold — stretched to the downside; watch for a snap-back.`
        : rsiState === "overbought"
          ? `RSI ${rsi.toFixed(0)} is overbought — extended; expect resistance.`
          : `RSI ${rsi.toFixed(0)} is neutral — room to move either way.`
      : "RSI — not enough history yet.",
  );
  if (Number.isFinite(pct)) {
    notes.push(
      `Price sits ${(pct * 100).toFixed(0)}% up its 14-bar range${
        pct <= 0.3 ? " (near the low — mean-reversion zone)" : pct >= 0.7 ? " (near the high — extended)" : ""
      }.`,
    );
  }
  notes.push(ma5Rising ? "The 5-day average is rising — the short-term trend has turned up." : "The 5-day average is flat/falling — no short-term thrust yet.");
  if (meanReversionSetup) {
    notes.push(
      "Wujastyk mean-reversion-into-strength: above the POC and 200-day with a rising 5-day, still below the anchored VWAP — room to run up to the mean.",
    );
  }

  return {
    macd: { value: macdVal, signal: sig, hist, bullish: macdBullish, histRising },
    rsi: { value: rsi, state: rsiState },
    pctRange: pct,
    ma5Rising,
    meanReversionSetup,
    score,
    notes,
  };
}
