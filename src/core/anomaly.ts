import type { Candle } from "./types";
import { atrSeries } from "./indicators";

/**
 * Manipulation / anomaly scan — with a crucial distinction. "Manipulation"
 * comes in two characters, and they mean OPPOSITE things for a trade:
 *
 *  PREDATORY — pump-shaped parabolas, prices marked up with no participation,
 *  gap traps, thin-and-violent tape. The game is being run ON you; levels are
 *  unreliable and the correct trade is usually none.
 *
 *  SMART-MONEY GAMES — a stop-sweep below support that immediately reclaims
 *  (a Wyckoff spring/shakeout), heavy-volume churn absorbed at the LOWS.
 *  That's institutions clearing the book before marking price up — the kind
 *  of "manipulation" that is actually a bullish tell. The mirror (an upthrust
 *  above resistance that fails, churn at the highs) is distribution.
 *
 * None of this PROVES anything — it classifies tape character so the
 * discipline guard can block predatory names and the trader can lean in when
 * the games are accumulative.
 */
export interface AnomalyFlag {
  id: string;
  label: string;
  hit: boolean;
  /** 1 = informational · 2 = concerning · 3 = disqualifying-grade. */
  severity: 1 | 2 | 3;
  detail: string;
}

export type TapeCharacter = "predatory" | "games-accumulation" | "games-distribution" | "none";

export interface AnomalyReport {
  /** 0 (clean) … 100 (stay away). */
  score: number;
  level: "CLEAN" | "WATCH" | "SKETCHY";
  /** Who is running the game, if anyone — and which way it points. */
  character: TapeCharacter;
  flags: AnomalyFlag[];
  /** Bullish/bearish game tells (springs, absorption, upthrusts). */
  games: AnomalyFlag[];
  headline: string;
}

const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function anomalyScan(candles: Candle[]): AnomalyReport | null {
  const n = candles.length;
  if (n < 80) return null;
  const flags: AnomalyFlag[] = [];
  const closes = candles.map((c) => c.close);
  const recent = candles.slice(-30);
  const priorVol = avg(candles.slice(-80, -30).map((c) => c.volume));
  const vol50 = avg(candles.slice(-50).map((c) => c.volume));
  const atr = atrSeries(candles, 14);
  const price = closes[n - 1];

  // 1. Pump-shaped parabola: huge 10-bar gain on exploding volume.
  const ret10 = closes[n - 11] > 0 ? price / closes[n - 11] - 1 : 0;
  const vol10 = avg(candles.slice(-10).map((c) => c.volume));
  const pump = ret10 > 0.4 && priorVol > 0 && vol10 / priorVol > 2.5;
  flags.push({
    id: "pump",
    label: "Pump-shaped parabola",
    hit: pump,
    severity: 3,
    detail: pump
      ? `+${(ret10 * 100).toFixed(0)}% in 10 bars on ${(vol10 / priorVol).toFixed(1)}× its normal volume — this is the shape of a pump, and pumps end in dumps.`
      : "No parabolic price/volume explosion.",
  });

  // 2. Thin-tape mark-up: big price moves on abnormally LOW volume.
  const thinMoves = recent.filter(
    (c, i) => i > 0 && Math.abs(c.close / recent[i - 1].close - 1) > 0.05 && c.volume < vol50 * 0.5,
  ).length;
  flags.push({
    id: "thin",
    label: "Moves without participation",
    hit: thinMoves >= 2,
    severity: 3,
    detail:
      thinMoves >= 2
        ? `${thinMoves} bars moved >5% on under half the normal volume — price is being marked around, not traded.`
        : "Big moves are carrying real volume.",
  });

  // 3. Stop-run wicks: repeated long wicks on expanded range and volume.
  let wicks = 0;
  for (const c of candles.slice(-15)) {
    const range = c.high - c.low;
    const body = Math.abs(c.close - c.open);
    const a = atr[n - 1] || 0;
    if (range > 0 && a > 0 && range > 1.8 * a && body / range < 0.35 && c.volume > vol50 * 1.3) wicks += 1;
  }
  flags.push({
    id: "wicks",
    label: "Stop-run wicks",
    hit: wicks >= 2,
    severity: 2,
    detail:
      wicks >= 2
        ? `${wicks} wide-range, small-body, high-volume bars in 15 — someone is sweeping the stops both sides of the book.`
        : "No repeated liquidity-sweep bars.",
  });

  // 4. Gap-and-reverse traps.
  let traps = 0;
  for (let i = n - 20; i < n; i++) {
    const prev = candles[i - 1];
    const bar = candles[i];
    if (!prev || prev.close <= 0) continue;
    const gap = bar.open / prev.close - 1;
    if (gap > 0.03 && bar.close < prev.close) traps += 1; // bull trap
    if (gap < -0.03 && bar.close > prev.close) traps += 1; // bear trap
  }
  flags.push({
    id: "traps",
    label: "Gap-and-reverse traps",
    hit: traps >= 2,
    severity: 2,
    detail:
      traps >= 2
        ? `${traps} gaps in 20 bars fully reversed the same day — breakout entries here are being farmed.`
        : "Gaps are mostly holding their direction.",
  });

  // 5. Churn: outsized volume that goes nowhere. WHERE it happens decides what
  //    it means — at the lows it's absorption (bullish game); at the highs
  //    after a run it's distribution; scattered it's just suspicious turnover.
  const rangeLow = Math.min(...candles.slice(-30).map((c) => c.low));
  const rangeHigh = Math.max(...candles.slice(-30).map((c) => c.high));
  const rangeSpan = Math.max(1e-9, rangeHigh - rangeLow);
  const churnBars = recent.filter(
    (c, i) => i > 0 && c.volume > vol50 * 2 && Math.abs(c.close / recent[i - 1].close - 1) < 0.005,
  );
  const churnLow = churnBars.filter((c) => (c.close - rangeLow) / rangeSpan <= 0.4).length;
  const churnHigh = churnBars.filter((c) => (c.close - rangeLow) / rangeSpan >= 0.7).length;
  const ranUp30 = closes[n - 31] > 0 && price / closes[n - 31] - 1 > 0.25;
  flags.push({
    id: "churn",
    label: "High-volume churn at the highs",
    hit: churnHigh >= 2 && ranUp30,
    severity: 2,
    detail:
      churnHigh >= 2 && ranUp30
        ? `${churnHigh} huge-volume days going nowhere at the top of a +25% run — size is quietly leaving.`
        : "No distribution-shaped churn at the highs.",
  });

  // 6. Manipulable tape: illiquid AND violently moving.
  const dollarVol = avg(candles.slice(-20).map((c) => c.close * c.volume));
  const violent = candles.slice(-20).some((c, i, arr) => i > 0 && Math.abs(c.close / arr[i - 1].close - 1) > 0.08);
  const thinAndWild = dollarVol < 2_000_000 && violent;
  flags.push({
    id: "illiquid",
    label: "Thin and violent",
    hit: thinAndWild,
    severity: 2,
    detail: thinAndWild
      ? `~$${(dollarVol / 1e6).toFixed(1)}M/day trading with >8% swings — small money can push this around; levels mean little.`
      : "Liquidity is adequate for the moves it makes.",
  });

  // 7. Statistical outliers: returns far outside the name's own history.
  const rets: number[] = [];
  for (let i = Math.max(1, n - 100); i < n - 15; i++) rets.push(closes[i] / closes[i - 1] - 1);
  const mu = avg(rets);
  const sd = Math.sqrt(avg(rets.map((r) => (r - mu) * (r - mu))));
  let outliers = 0;
  for (let i = n - 15; i < n; i++) {
    const r = closes[i] / closes[i - 1] - 1;
    if (sd > 0 && Math.abs((r - mu) / sd) > 4.5) outliers += 1;
  }
  flags.push({
    id: "outlier",
    label: "Moves that don't make statistical sense",
    hit: outliers >= 1,
    severity: 1,
    detail:
      outliers >= 1
        ? `${outliers} daily move(s) beyond 4.5σ of this name's own history in 15 bars — news, or nonsense; treat backtested levels as suspect either way.`
        : "Recent moves are inside the name's own statistics.",
  });

  // ---- smart-money games: the "manipulation" worth JOINING ----------------
  const games: AnomalyFlag[] = [];

  // Spring / shakeout: a bar sweeps below the prior 20-bar low and price
  // reclaims that low within two bars — stops cleared, then marked back up.
  let spring = false;
  let springDetail = "No stop-sweep-and-reclaim below support.";
  for (let i = n - 10; i < n; i++) {
    const priorLow = Math.min(...candles.slice(i - 20, i).map((c) => c.low));
    const bar = candles[i];
    if (bar.low < priorLow * 0.995) {
      const reclaimed =
        bar.close > priorLow ||
        (candles[i + 1] && candles[i + 1].close > priorLow) ||
        (candles[i + 2] && candles[i + 2].close > priorLow);
      if (reclaimed && price > priorLow) {
        spring = true;
        springDetail = `Swept the ${priorLow.toFixed(2)} low and reclaimed it within two bars — a Wyckoff spring: weak hands shaken out before markup.`;
        break;
      }
    }
  }
  games.push({ id: "spring", label: "Spring (bullish shakeout)", hit: spring, severity: 2, detail: springDetail });

  // Absorption: heavy-volume churn sitting at the LOWS — someone is catching
  // every share the sellers have without letting price break.
  games.push({
    id: "absorb",
    label: "Absorption at the lows",
    hit: churnLow >= 2 && !ranUp30,
    severity: 2,
    detail:
      churnLow >= 2 && !ranUp30
        ? `${churnLow} huge-volume days near the bottom of the range with no breakdown — supply is being absorbed.`
        : "No heavy-volume absorption at the lows.",
  });

  // Upthrust: pokes above the prior 20-bar high and fails back under it —
  // the bearish mirror of the spring (breakout buyers trapped, then sold to).
  let upthrust = false;
  let upthrustDetail = "No failed poke above resistance.";
  for (let i = n - 10; i < n; i++) {
    const priorHigh = Math.max(...candles.slice(i - 20, i).map((c) => c.high));
    const bar = candles[i];
    if (bar.high > priorHigh * 1.005 && bar.close < priorHigh && price < priorHigh) {
      upthrust = true;
      upthrustDetail = `Poked above ${priorHigh.toFixed(2)} and closed back under it — an upthrust: breakout buyers trapped and sold to.`;
      break;
    }
  }
  games.push({ id: "upthrust", label: "Upthrust (bearish trap)", hit: upthrust, severity: 2, detail: upthrustDetail });

  // ---- character + level ----------------------------------------------------
  // Wicks resolved bullishly by a spring are the shakeout, not the threat.
  const scored = flags.map((f) => (f.id === "wicks" && f.hit && spring ? { ...f, severity: 1 as const } : f));
  const predatoryHit = scored.some((f) => f.hit && f.severity === 3);
  const raw = scored.filter((f) => f.hit).reduce((a, f) => a + f.severity, 0);
  const maxRaw = scored.reduce((a, f) => a + f.severity, 0);
  const score = Math.round((raw / maxRaw) * 100);
  const level: AnomalyReport["level"] = raw >= 5 || predatoryHit ? "SKETCHY" : raw >= 2 ? "WATCH" : "CLEAN";

  const character: TapeCharacter = predatoryHit
    ? "predatory"
    : upthrust && !spring
      ? "games-distribution"
      : spring || (churnLow >= 2 && !ranUp30)
        ? "games-accumulation"
        : "none";

  const headline =
    character === "predatory"
      ? "This tape is being pushed around FOR someone else's exit — pumps, thin mark-ups or traps. Levels are unreliable; the best trade here is none."
      : character === "games-accumulation"
        ? "Games detected — and the player is BUYING: stops swept and reclaimed / supply absorbed at the lows. This is the manipulation worth joining once the Final Call fires."
        : character === "games-distribution"
          ? "Games detected — and the player is SELLING: failed pokes above resistance. Longs are the exit liquidity; shorts get the wind."
          : level === "WATCH"
            ? "Some tape oddities — trade smaller and trust the levels less."
            : "Tape looks clean — moves carry volume and gaps behave.";
  return { score, level, character, flags: scored, games, headline };
}
