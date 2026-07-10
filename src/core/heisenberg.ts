import type { Candle } from "./types";
import { rsiSeries, smaLast } from "./indicators";

/**
 * "Would Heisenberg take this trade?" — a rule-based reconstruction of the
 * @Mr_Derivatives playbook, built from the 64,865-tweet corpus documented in
 * docs/MR_DERIVATIVES.md. Every trigger below is his, quoted with date.
 *
 * He is a contrarian mean-reversion trader at classical price levels — NOT a
 * volume-profile trader — so this module deliberately reads raw OHLCV only:
 * streaks, RSI extremes, 50/200dma magnets, price gaps, round numbers, prior
 * breakout points, Bollinger coils, candles. Calibrated for DAILY bars.
 *
 * His own caveat applies to every output: "I bat .500 … it's about risk
 * management" (2021-08-20). His "works 80% of the times" numbers are folk
 * probabilities, not backtests.
 */

// ---- public types -----------------------------------------------------------

export type HeisenbergCall = "TAKE-LONG" | "TAKE-SHORT" | "STRANGLE" | "WAIT" | "PASS";

export interface HbCheck {
  label: string;
  pass: boolean;
  detail: string;
}

export interface HbQuote {
  text: string;
  date: string;
}

export interface HbSetup {
  key: string;
  name: string;
  side: "long" | "short" | "neutral";
  triggered: boolean;
  /** 0..1 — fraction of the setup's triggers that fired (weighted). */
  score: number;
  checks: HbCheck[];
  quote: HbQuote;
}

export interface HbLevel {
  kind:
    | "gap-fill"
    | "round-number"
    | "50dma"
    | "200dma"
    | "prior-breakout"
    | "prior-high"
    | "prior-low"
    | "bollinger";
  price: number;
  label: string;
}

export interface HbPlan {
  side: "long" | "short";
  entry: number;
  stop: number;
  /** Level sequence in his style: gap fills → round numbers → MAs → prior extremes. */
  targets: HbLevel[];
  rrT1: number | null;
}

export interface HbRsiAnalog {
  /** Bounce (long) or pullback (short) % over the next `horizon` bars. */
  movePct: number;
  /** Bar index of the episode start. */
  index: number;
}

export interface HbSignals {
  price: number;
  redStreak: number;
  greenStreak: number;
  rsi: number;
  /** His "the last N times RSI was this oversold/overbought…" stat. */
  rsiAnalogs: HbRsiAnalog[];
  dropFrom20dHighPct: number;
  gainFrom20dLowPct: number;
  ma50: number;
  ma200: number;
  distToMa50Pct: number;
  distToMa200Pct: number;
  aboveMa200Pct: number;
  failed200Test: boolean;
  roundNumber: { level: number; distPct: number };
  nearestGapAbove: HbLevel | null;
  nearestGapBelow: HbLevel | null;
  openingGapPct: number;
  bollingerSqueeze: boolean;
  closedBelowLowerBand: boolean;
  closedAboveUpperBand: boolean;
  hammer: boolean;
  redToGreen: boolean;
  bullishEngulfing: boolean;
  parabolic: boolean;
  roundtrip: { level: number; runupPct: number } | null;
  /** Support (long) confluences stacked within 2% of price. */
  supportConfluences: HbLevel[];
  /** Resistance confluences within 2% above price. */
  resistanceConfluences: HbLevel[];
}

export interface HbVixGate {
  vix: number;
  zone: string;
  note: string;
  /** True when the zone outright argues against the chosen side. */
  blocksCall: boolean;
}

export interface HeisenbergRead {
  call: HeisenbergCall;
  headline: string;
  sizing: string;
  best: HbSetup | null;
  setups: HbSetup[];
  plan: HbPlan | null;
  signals: HbSignals;
  vixGate: HbVixGate | null;
  /** The "DARING SOULS" intraday note when today opened on a big gap. */
  daringSouls: string | null;
  caveat: string;
}

export interface HeisenbergOptions {
  /** Latest VIX close, if the caller has it — gates the call per his dial. */
  vix?: number;
}

export const HB_CAVEAT =
  'His own disclaimer, not ours: "I bat .500 … it\'s about risk management. Some luck too." (2021-08-20). ' +
  'His "works 80% of the times" figures are asserted, never backtested.';

// ---- signal computation ------------------------------------------------------

function closeStreak(candles: Candle[]): { red: number; green: number } {
  let red = 0;
  let green = 0;
  for (let i = candles.length - 1; i > 0; i--) {
    if (candles[i].close < candles[i - 1].close) red++;
    else break;
  }
  for (let i = candles.length - 1; i > 0; i--) {
    if (candles[i].close > candles[i - 1].close) green++;
    else break;
  }
  return { red, green };
}

/**
 * His signature stat: "The last 4 times the daily RSI has been this oversold,
 * the stock rallied 76%, 18%, 21%, and 50% respectively. We are due!"
 * ($SOFI, 2021-07-08). An episode = the RSI series crossing the current level
 * (from the neutral side); the move is the best excursion over `horizon` bars.
 */
export function rsiAnalogs(
  candles: Candle[],
  rsi: number[],
  side: "oversold" | "overbought",
  horizon = 15,
  maxEpisodes = 4,
): HbRsiAnalog[] {
  const n = candles.length;
  // "This oversold" in his usage is approximate — allow ±4 RSI points so a
  // slightly-shallower historical episode still counts as an analog.
  const level = rsi[n - 1] + (side === "oversold" ? 4 : -4);
  if (!Number.isFinite(level)) return [];
  const out: HbRsiAnalog[] = [];
  // Walk backwards, skipping the episode we are currently inside.
  let i = n - 2;
  while (i > 0 && Number.isFinite(rsi[i]) && (side === "oversold" ? rsi[i] <= level : rsi[i] >= level)) i--;
  for (; i > 15 && out.length < maxEpisodes; i--) {
    const inZone = side === "oversold" ? rsi[i] <= level : rsi[i] >= level;
    const prevOut = side === "oversold" ? rsi[i - 1] > level : rsi[i - 1] < level;
    if (!Number.isFinite(rsi[i]) || !inZone || !prevOut) continue;
    // His stat is trough-to-bounce ("the stock rallied 76%"): find the episode's
    // extreme close within `horizon` bars of the crossing, then the best
    // excursion over the `horizon` bars after that extreme.
    let t = i;
    for (let j = i; j < Math.min(n, i + horizon); j++) {
      const deeper = side === "oversold" ? candles[j].close < candles[t].close : candles[j].close > candles[t].close;
      if (deeper) t = j;
    }
    const from = candles[t].close;
    let best = 0;
    for (let j = t + 1; j < Math.min(n, t + 1 + horizon); j++) {
      const move = side === "oversold" ? candles[j].high / from - 1 : 1 - candles[j].low / from;
      if (move > best) best = move;
    }
    out.push({ movePct: best, index: t });
    // Skip the rest of this episode so clusters count once.
    while (i > 1 && (side === "oversold" ? rsi[i - 1] <= level : rsi[i - 1] >= level)) i--;
  }
  return out;
}

interface PriceGap {
  /** "up" = gap-up day (fill level below), "down" = gap-down day (fill level above). */
  dir: "up" | "down";
  index: number;
  /** The quoted "gap fill" price: prior day's high (up gap) or low (down gap). */
  fillLevel: number;
}

/** Unfilled full-body daily price gaps — his "gap fill magnets 🧲". */
export function unfilledGaps(candles: Candle[], lookback = 500): PriceGap[] {
  const start = Math.max(1, candles.length - lookback);
  const gaps: PriceGap[] = [];
  for (let i = start; i < candles.length; i++) {
    const prev = candles[i - 1];
    const cur = candles[i];
    if (cur.low > prev.high) gaps.push({ dir: "up", index: i, fillLevel: prev.high });
    else if (cur.high < prev.low) gaps.push({ dir: "down", index: i, fillLevel: prev.low });
  }
  return gaps.filter((g) => {
    for (let j = g.index; j < candles.length; j++) {
      if (g.dir === "up" && candles[j].low <= g.fillLevel) return false;
      if (g.dir === "down" && candles[j].high >= g.fillLevel) return false;
    }
    return true;
  });
}

/**
 * Nearest psychological round number — "big names love gravitating towards
 * nice round numbers.. Self fulfilling prophecy." (2021-12-09).
 */
export function nearestRoundNumber(price: number): { level: number; distPct: number } {
  const steps = [0.5, 1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000, 5000];
  let step = steps[0];
  for (const s of steps) if (price / s >= 4) step = s;
  const level = Math.round(price / step) * step;
  return { level, distPct: level > 0 ? Math.abs(price - level) / price : 1 };
}

/**
 * Roundtrip detection — "when a stock roundtrips its entire recent big up
 * move, it usually finds support at that prior breakout point" (2022-01-07).
 * Breakout level = the pre-run resistance; qualifies when the run cleared it
 * by ≥8% and price is now back within 3% of the level.
 */
export function detectRoundtrip(
  candles: Candle[],
): { level: number; runupPct: number } | null {
  const n = candles.length;
  if (n < 90) return null;
  const price = candles[n - 1].close;
  // Resistance formed in the "base" window, broken during the "run" window.
  const baseLo = Math.max(0, n - 180);
  const baseHi = n - 45;
  let resistance = -Infinity;
  for (let i = baseLo; i < baseHi; i++) resistance = Math.max(resistance, candles[i].high);
  if (!Number.isFinite(resistance) || resistance <= 0) return null;
  let peak = -Infinity;
  for (let i = baseHi; i < n; i++) peak = Math.max(peak, candles[i].close);
  const brokeOut = peak >= resistance * 1.08;
  const backAtLevel = Math.abs(price - resistance) / resistance <= 0.03;
  if (brokeOut && backAtLevel) return { level: resistance, runupPct: peak / resistance - 1 };
  return null;
}

function bollinger(closes: number[], period = 20, mult = 2) {
  const n = closes.length;
  if (n < period) return null;
  const window = closes.slice(n - period);
  const mid = window.reduce((a, b) => a + b, 0) / period;
  const variance = window.reduce((a, b) => a + (b - mid) * (b - mid), 0) / period;
  const sd = Math.sqrt(variance);
  return { mid, upper: mid + mult * sd, lower: mid - mult * sd, width: mid > 0 ? (2 * mult * sd) / mid : NaN };
}

/** Bollinger-width percentile squeeze — his "coiled spring" trigger. */
function bollingerSqueeze(closes: number[], period = 20, history = 120): boolean {
  const n = closes.length;
  if (n < period + 30) return false;
  const widths: number[] = [];
  const from = Math.max(period, n - history);
  for (let i = from; i <= n; i++) {
    const b = bollinger(closes.slice(0, i), period);
    if (b && Number.isFinite(b.width)) widths.push(b.width);
  }
  if (widths.length < 20) return false;
  const cur = widths[widths.length - 1];
  const rank = widths.filter((w) => w <= cur).length / widths.length;
  return rank <= 0.12;
}

function isHammer(c: Candle): boolean {
  const range = c.high - c.low;
  if (range <= 0) return false;
  const body = Math.abs(c.close - c.open);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const upperWick = c.high - Math.max(c.open, c.close);
  return lowerWick >= 2 * Math.max(body, range * 0.05) && upperWick <= body + range * 0.1 && (c.close - c.low) / range >= 0.6;
}

export function computeSignals(candles: Candle[]): HbSignals {
  const n = candles.length;
  const closes = candles.map((c) => c.close);
  const last = candles[n - 1];
  const prev = candles[n - 2];
  const price = last.close;

  const { red, green } = closeStreak(candles);
  const rsiAll = rsiSeries(closes, 14);
  const rsi = rsiAll[n - 1];

  const win20 = candles.slice(Math.max(0, n - 21), n - 1);
  const high20 = Math.max(...win20.map((c) => c.high), last.high);
  const low20 = Math.min(...win20.map((c) => c.low), last.low);

  const ma50 = smaLast(closes, 50);
  const ma200 = smaLast(closes, 200);

  // Failed 200dma test: approached/touched it from below in the last 6 bars,
  // now closing back under — "hit 200dma but failed to breakout … stay short" (2022-08-21).
  let failed200Test = false;
  if (Number.isFinite(ma200)) {
    const touched = candles.slice(Math.max(0, n - 6)).some((c) => c.high >= ma200 * 0.995);
    failed200Test = touched && price < ma200 * 0.99;
  }

  const gaps = unfilledGaps(candles);
  const above = gaps.filter((g) => g.fillLevel > price * 1.002).sort((a, b) => a.fillLevel - b.fillLevel);
  const below = gaps.filter((g) => g.fillLevel < price * 0.998).sort((a, b) => b.fillLevel - a.fillLevel);
  const gapLevel = (g: PriceGap): HbLevel => ({
    kind: "gap-fill",
    price: g.fillLevel,
    label: `gap fill ${g.fillLevel.toFixed(2)} (${g.dir === "down" ? "gap-down" : "gap-up"} day ${new Date(candles[g.index].time * 1000).toISOString().slice(0, 10)})`,
  });

  const bb = bollinger(closes);
  const roundNumber = nearestRoundNumber(price);
  const roundtrip = detectRoundtrip(candles);

  // Confluences within 2% — his entries always stack "3 confluences of support
  // right here right now" (2024-11-28).
  const near = (level: number) => Number.isFinite(level) && Math.abs(level - price) / price <= 0.02;
  const supportConfluences: HbLevel[] = [];
  const resistanceConfluences: HbLevel[] = [];
  const push = (arr: HbLevel[], kind: HbLevel["kind"], level: number, label: string) => {
    if (near(level)) arr.push({ kind, price: level, label });
  };
  push(price >= ma50 ? supportConfluences : resistanceConfluences, "50dma", ma50, `50dma ${Number.isFinite(ma50) ? ma50.toFixed(2) : "n/a"}`);
  push(price >= ma200 ? supportConfluences : resistanceConfluences, "200dma", ma200, `200dma ${Number.isFinite(ma200) ? ma200.toFixed(2) : "n/a"}`);
  push(price >= roundNumber.level ? supportConfluences : resistanceConfluences, "round-number", roundNumber.level, `round number ${roundNumber.level}`);
  if (roundtrip) push(supportConfluences, "prior-breakout", roundtrip.level, `prior breakout ${roundtrip.level.toFixed(2)}`);
  if (below[0] && near(below[0].fillLevel)) supportConfluences.push(gapLevel(below[0]));
  if (above[0] && near(above[0].fillLevel)) resistanceConfluences.push(gapLevel(above[0]));
  if (bb && near(bb.lower) && price >= bb.lower) supportConfluences.push({ kind: "bollinger", price: bb.lower, label: `lower Bollinger ${bb.lower.toFixed(2)}` });

  const openingGapPct = prev ? (last.open - prev.close) / prev.close : 0;

  const gain10 = n > 11 ? price / candles[n - 11].close - 1 : 0;

  return {
    price,
    redStreak: red,
    greenStreak: green,
    rsi,
    rsiAnalogs: rsiAnalogs(candles, rsiAll, rsi <= 50 ? "oversold" : "overbought"),
    dropFrom20dHighPct: high20 > 0 ? 1 - price / high20 : 0,
    gainFrom20dLowPct: low20 > 0 ? price / low20 - 1 : 0,
    ma50,
    ma200,
    distToMa50Pct: Number.isFinite(ma50) ? (price - ma50) / ma50 : NaN,
    distToMa200Pct: Number.isFinite(ma200) ? (price - ma200) / ma200 : NaN,
    aboveMa200Pct: Number.isFinite(ma200) ? price / ma200 - 1 : NaN,
    failed200Test,
    roundNumber,
    nearestGapAbove: above[0] ? gapLevel(above[0]) : null,
    nearestGapBelow: below[0] ? gapLevel(below[0]) : null,
    openingGapPct,
    bollingerSqueeze: bollingerSqueeze(closes),
    closedBelowLowerBand: !!bb && price < bb.lower,
    closedAboveUpperBand: !!bb && price > bb.upper,
    hammer: isHammer(last),
    redToGreen: !!prev && last.open < prev.close * 0.997 && last.close > prev.close,
    bullishEngulfing:
      !!prev &&
      prev.close < prev.open &&
      last.close > last.open &&
      last.close >= prev.open &&
      last.open <= prev.close,
    parabolic: green >= 7 || (gain10 >= 0.25 && rsi >= 75),
    roundtrip,
    supportConfluences,
    resistanceConfluences,
  };
}

// ---- setup evaluation --------------------------------------------------------

const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;

function evalOversoldBounce(s: HbSignals): HbSetup {
  const checks: HbCheck[] = [
    {
      label: "Down-days streak",
      pass: s.redStreak >= 4,
      detail: s.redStreak >= 1 ? `down ${s.redStreak} day${s.redStreak > 1 ? "s" : ""} in a row (wants ≥4)` : "no red streak",
    },
    {
      label: "Daily RSI oversold",
      pass: s.rsi < 32,
      detail: Number.isFinite(s.rsi) ? `RSI ${s.rsi.toFixed(0)} (wants <30, extreme <20)` : "RSI unavailable",
    },
    {
      label: "Washed out from highs",
      pass: s.dropFrom20dHighPct >= 0.1,
      detail: `${pct(s.dropFrom20dHighPct)} off the 20-day high (wants ≥10%)`,
    },
    {
      label: "Support confluence stacked",
      pass: s.supportConfluences.length >= 2,
      detail: s.supportConfluences.length
        ? `${s.supportConfluences.length} within 2%: ${s.supportConfluences.map((c) => c.label).join(", ")}`
        : "no support within 2%",
    },
    {
      label: "Reversal confirmation",
      pass: s.hammer || s.redToGreen || s.bullishEngulfing,
      detail:
        [s.hammer && "hammer", s.redToGreen && "red-to-green", s.bullishEngulfing && "bullish engulfing"]
          .filter(Boolean)
          .join(" + ") || "none yet — he waits for the hammer/red-to-green",
    },
  ];
  const core = checks.slice(0, 4).filter((c) => c.pass).length;
  return {
    key: "oversold-bounce",
    name: "Oversold bounce / dead cat 💀🐱🏀",
    side: "long",
    triggered: core >= 2 && (s.rsi < 40 || s.redStreak >= 4),
    score: checks.filter((c) => c.pass).length / checks.length,
    checks,
    quote: {
      text: "The last 4 times the daily RSI has been this oversold, the stock rallied 76%, 18%, 21%, and 50% respectively. We are due!",
      date: "2021-07-08",
    },
  };
}

function evalFallingKnife(s: HbSignals): HbSetup {
  const checks: HbCheck[] = [
    { label: "Brutal streak", pass: s.redStreak >= 7, detail: `down ${s.redStreak} in a row (wants ≥7)` },
    { label: "RSI extreme", pass: s.rsi < 22, detail: `RSI ${Number.isFinite(s.rsi) ? s.rsi.toFixed(0) : "n/a"} (wants <20-ish)` },
    {
      label: "Major level underfoot",
      pass: s.supportConfluences.length >= 1,
      detail: s.supportConfluences.map((c) => c.label).join(", ") || "none within 2%",
    },
  ];
  return {
    key: "falling-knife",
    name: "Falling-knife catch (subway sandwich only)",
    side: "long",
    triggered: checks[0].pass || checks[1].pass,
    score: checks.filter((c) => c.pass).length / checks.length,
    checks,
    quote: {
      text: "$LMT -Down 9 days in a row. -Sitting right near the 200dma. -Retesting prior resistance turned support breakout point. -Daily RSI one of the lowest ever. … Time to buy for a bounce? I think so.",
      date: "2026-04-26",
    },
  };
}

function evalRoundtrip(s: HbSignals): HbSetup {
  const rt = s.roundtrip;
  const checks: HbCheck[] = [
    {
      label: "Round-tripped a big run",
      pass: !!rt,
      detail: rt ? `ran +${pct(rt.runupPct)} above ${rt.level.toFixed(2)}, now back at it` : "no completed roundtrip to a prior breakout",
    },
    {
      label: "At the prior breakout point",
      pass: !!rt,
      detail: rt ? `price within 3% of ${rt.level.toFixed(2)}` : "—",
    },
  ];
  return {
    key: "roundtrip",
    name: "Roundtrip to prior breakout support",
    side: "long",
    triggered: !!rt,
    score: rt ? 1 : 0,
    checks,
    quote: {
      text: "Pro Tip: when a stock roundtrips its entire recent big up move, it usually finds support at that prior breakout point. Play those for a cheap quicky 5-10% bounces. Works about 80% of the times.",
      date: "2022-01-07",
    },
  };
}

function evalMaMagnet(s: HbSignals): HbSetup {
  const at50 = Number.isFinite(s.distToMa50Pct) && Math.abs(s.distToMa50Pct) <= 0.015;
  const at200 = Number.isFinite(s.distToMa200Pct) && Math.abs(s.distToMa200Pct) <= 0.015;
  const checks: HbCheck[] = [
    { label: "At the 50dma", pass: at50, detail: Number.isFinite(s.distToMa50Pct) ? `${pct(s.distToMa50Pct, 1)} away` : "not enough history" },
    { label: "At the 200dma", pass: at200, detail: Number.isFinite(s.distToMa200Pct) ? `${pct(s.distToMa200Pct, 1)} away` : "not enough history" },
    { label: "Arriving oversold (buy) not overbought", pass: s.rsi < 45, detail: `RSI ${Number.isFinite(s.rsi) ? s.rsi.toFixed(0) : "n/a"}` },
  ];
  return {
    key: "ma-magnet",
    name: "50/200dma magnet touch",
    side: "long",
    triggered: (at50 || at200) && s.rsi < 50,
    score: checks.filter((c) => c.pass).length / checks.length,
    checks,
    quote: { text: "50 and 200 day moving averages always ALWAYS acts as magnets.", date: "2022-07-19" },
  };
}

function evalOverboughtFade(s: HbSignals): HbSetup {
  const checks: HbCheck[] = [
    { label: "Up-days streak", pass: s.greenStreak >= 6, detail: `up ${s.greenStreak} in a row (wants ≥6-8)` },
    { label: "Daily RSI overbought", pass: s.rsi > 72, detail: `RSI ${Number.isFinite(s.rsi) ? s.rsi.toFixed(0) : "n/a"} (wants >70, extreme >80)` },
    {
      label: "Parabolic / too far too fast",
      pass: s.parabolic || s.gainFrom20dLowPct >= 0.35,
      detail: s.parabolic ? "parabolic move flagged" : `+${pct(s.gainFrom20dLowPct)} off the 20-day low`,
    },
    {
      label: "Stretched over the 200dma",
      pass: Number.isFinite(s.aboveMa200Pct) && s.aboveMa200Pct >= 0.5,
      detail: Number.isFinite(s.aboveMa200Pct) ? `${pct(s.aboveMa200Pct)} above the 200dma (his Finviz mania screen: ≥50-100%)` : "not enough history",
    },
    { label: "Failed 200dma test (bear case)", pass: s.failed200Test, detail: s.failed200Test ? "touched and rejected the 200dma" : "no failed test" },
  ];
  const fired = checks.filter((c) => c.pass).length;
  return {
    key: "overbought-fade",
    name: "Overbought fade / short into strength",
    side: "short",
    triggered: fired >= 2 || s.failed200Test,
    score: fired / checks.length,
    checks,
    quote: {
      text: "don't short into weakness, rather short into strength. … You don't ever short anything with size. Subway sandwich amounts only.",
      date: "2022-03-14 / 2026-04-25",
    },
  };
}

function evalCoil(s: HbSignals): HbSetup {
  const checks: HbCheck[] = [
    { label: "Bollinger squeeze", pass: s.bollingerSqueeze, detail: s.bollingerSqueeze ? "band width in the tightest ~decile of the last 6 months" : "bands not unusually tight" },
    { label: "Not already extended", pass: s.rsi > 35 && s.rsi < 65, detail: `RSI ${Number.isFinite(s.rsi) ? s.rsi.toFixed(0) : "n/a"} (wants mid-range)` },
  ];
  return {
    key: "coil",
    name: "Coiled spring (strangle it)",
    side: "neutral",
    triggered: checks.every((c) => c.pass),
    score: checks.filter((c) => c.pass).length / checks.length,
    checks,
    quote: {
      text: "It's coiling so hard for a big move. … Don't guess the direction. Just play the volatility.",
      date: "2024-06-07",
    },
  };
}

// ---- verdict assembly --------------------------------------------------------

function vixGate(vix: number | undefined, side: "long" | "short" | "neutral" | null): HbVixGate | null {
  if (vix === undefined || !Number.isFinite(vix)) return null;
  let zone: string;
  if (vix < 15) zone = "<15 — “selling hands over fist” zone";
  else if (vix < 20) zone = "15–19 — trim/sell zone";
  else if (vix < 25) zone = "20–25 — nibble longs";
  else if (vix < 30) zone = "25–30 — “hammer the buy button”";
  else if (vix < 40) zone = "30–40 — buy aggressively, do NOT start shorts";
  else zone = "40+ — “go all in” (and short the vol spike)";
  let note = `VIX ${vix.toFixed(1)}: ${zone}.`;
  let blocks = false;
  if (side === "short" && vix >= 30) {
    note += " His rule: never start shorts into an elevated VIX (“Where were you 7-10% ago?!”).";
    blocks = true;
  }
  if (side === "long" && vix < 15) {
    note += " Fresh longs at a depressed VIX are against his dial — trim, don't chase.";
  }
  return { vix, zone, note, blocksCall: blocks };
}

function buildPlan(s: HbSignals, side: "long" | "short"): HbPlan | null {
  const price = s.price;
  const targets: HbLevel[] = [];
  const seen = new Set<string>();
  const add = (lv: HbLevel | null | undefined) => {
    if (!lv || !Number.isFinite(lv.price)) return;
    const ok = side === "long" ? lv.price > price * 1.005 : lv.price < price * 0.995;
    const key = `${lv.kind}:${lv.price.toFixed(2)}`;
    if (ok && !seen.has(key)) {
      seen.add(key);
      targets.push(lv);
    }
  };

  if (side === "long") {
    add(s.nearestGapAbove);
    const nextRound = s.roundNumber.level > price ? s.roundNumber.level : s.roundNumber.level + (s.roundNumber.level - nearestRoundNumber(price * 0.8).level || s.roundNumber.level * 0.05);
    add({ kind: "round-number", price: nextRound, label: `round number ${nextRound}` });
    if (Number.isFinite(s.ma50) && s.ma50 > price) add({ kind: "50dma", price: s.ma50, label: `50dma ${s.ma50.toFixed(2)}` });
    if (Number.isFinite(s.ma200) && s.ma200 > price) add({ kind: "200dma", price: s.ma200, label: `200dma ${s.ma200.toFixed(2)}` });
  } else {
    add(s.nearestGapBelow);
    const nextRound = s.roundNumber.level < price ? s.roundNumber.level : s.roundNumber.level * 0.95;
    add({ kind: "round-number", price: nextRound, label: `round number ${nextRound}` });
    if (Number.isFinite(s.ma50) && s.ma50 < price) add({ kind: "50dma", price: s.ma50, label: `50dma ${s.ma50.toFixed(2)}` });
    if (Number.isFinite(s.ma200) && s.ma200 < price) add({ kind: "200dma", price: s.ma200, label: `200dma ${s.ma200.toFixed(2)}` });
  }
  targets.sort((a, b) => (side === "long" ? a.price - b.price : b.price - a.price));
  const top3 = targets.slice(0, 3);

  // Structural stop just past the level in play — "Buy to 1,050. Stop loss 1,000ish."
  let stop: number;
  if (side === "long") {
    const sup = s.supportConfluences.map((c) => c.price).filter((p) => p <= price * 1.001);
    stop = (sup.length ? Math.min(...sup) : price * 0.985) * 0.99;
  } else {
    const res = s.resistanceConfluences.map((c) => c.price).filter((p) => p >= price * 0.999);
    stop = (res.length ? Math.max(...res) : price * 1.015) * 1.01;
  }
  const t1 = top3[0]?.price;
  const risk = Math.abs(price - stop);
  const rrT1 = t1 !== undefined && risk > 0 ? Math.abs(t1 - price) / risk : null;
  if (!top3.length) return null;
  return { side, entry: price, stop, targets: top3, rrT1 };
}

function sizingFor(best: HbSetup, s: HbSignals): string {
  if (best.side === "short")
    return "Subway sandwich only — he caps shorts at 2–5% of the account and shorts into strength, never with size (2026-04-25).";
  if (best.key === "falling-knife")
    return "Subway sandwich (≤0.5–2%) — “Not even the 12 inch variety, but the 6 inch.” (2025-09-10).";
  if (best.key === "coil")
    return "Small strangle, defined risk — lotto-tier sizing, expect to lose the debit.";
  const strong = s.supportConfluences.length >= 3 && (s.hammer || s.redToGreen || s.bullishEngulfing);
  return strong
    ? "His tier 2 (4–6% of account) — multi-confluence with reversal confirmation (journal rules, 2024-01-08)."
    : "His tier 1 (1–3% of account); scale in thirds — “Average in 1/3 segments in case it drops a little lower.” (2021-08-19).";
}

/**
 * The verdict: would Heisenberg take this trade, on these daily candles?
 * Requires ≥60 daily bars; 200dma-based checks activate with ≥200.
 */
export function heisenbergRead(candles: Candle[], opts: HeisenbergOptions = {}): HeisenbergRead {
  if (candles.length < 60) throw new Error(`heisenbergRead needs ≥60 daily bars, got ${candles.length}`);
  const s = computeSignals(candles);

  const setups = [
    evalOversoldBounce(s),
    evalFallingKnife(s),
    evalRoundtrip(s),
    evalMaMagnet(s),
    evalOverboughtFade(s),
    evalCoil(s),
  ];

  const triggered = setups.filter((x) => x.triggered).sort((a, b) => b.score - a.score);
  // Long setups outrank the coil; the coil outranks nothing else firing.
  const best =
    triggered.find((x) => x.side === "long") ??
    triggered.find((x) => x.side === "short") ??
    triggered.find((x) => x.side === "neutral") ??
    null;

  const gate = vixGate(opts.vix, best?.side ?? null);

  let call: HeisenbergCall;
  let headline: string;
  const confirmed = s.hammer || s.redToGreen || s.bullishEngulfing;

  if (!best) {
    const midRange = s.rsi >= 40 && s.rsi <= 60;
    call = "PASS";
    headline = midRange
      ? "No man's land — “When you believe the market is too overbought or oversold. Never when it's in the middle.” (2021-10-13)"
      : "Nothing in his playbook fires here. He'd scroll past this chart.";
  } else if (best.side === "neutral") {
    call = "STRANGLE";
    headline = "Coiled spring: he wouldn't pick a direction — he'd buy the move itself (small strangle).";
  } else if (best.side === "short") {
    call = gate?.blocksCall ? "WAIT" : "TAKE-SHORT";
    headline = gate?.blocksCall
      ? "The fade set up, but his VIX rule blocks fresh shorts into elevated vol."
      : "Too far, too fast — he'd fade this into strength, small, expecting a “healthy 5-10% pullback.”";
  } else {
    // Long setups: he waits for the reversal candle on knives/bounces.
    if (best.key === "oversold-bounce" && !confirmed && s.redStreak >= 4) {
      call = "WAIT";
      headline =
        "The bounce is loading but unconfirmed — he'd watch for the hammer / red-to-green close first (“See how it closes first..” 2021-08-10).";
    } else {
      call = "TAKE-LONG";
      headline =
        best.key === "roundtrip"
          ? "Round-tripped to the prior breakout point — his “cheap quicky 5-10% bounce” play."
          : best.key === "falling-knife"
            ? "He'd catch this knife — but strictly subway-sandwich size, and only for a dead cat."
            : "Oversold at stacked support — he'd take the bounce “right here right now.”";
    }
  }

  const plan = best && best.side !== "neutral" ? buildPlan(s, best.side) : null;

  const daringSouls =
    Math.abs(s.openingGapPct) >= 0.015
      ? `Today opened on a ${pct(Math.abs(s.openingGapPct), 1)} gap ${s.openingGapPct > 0 ? "up" : "down"} — his “DARING SOULS” intraday play is to ${s.openingGapPct > 0 ? "fade it short" : "buy it"} for the gap-fill attempt (2022-07-12). Quick-hit trade, not a swing.`
      : null;

  return {
    call,
    headline,
    sizing: best ? sizingFor(best, s) : "No position — “Cash is a position.” (2022-05-06)",
    best,
    setups,
    plan,
    signals: s,
    vixGate: gate,
    daringSouls,
    caveat: HB_CAVEAT,
  };
}
