/**
 * Trail tab engine — an open reconstruction of the "trail + signal" style of
 * paid closed-source overlays (e.g. IncomeSharks' invite-only Sharks Stock
 * Trader), built quiet by design: FEWER signals, every rule visible, and the
 * outcomes replayed honestly over the loaded history instead of a cherry-picked
 * screenshot.
 *
 * The whole rulebook (there is nothing else):
 * 1. Two SuperTrends — tight 10/1.5 and loose 11/2.5, the same pair the
 *    Playbooks tab uses for the IncomeSharks confirm — must BOTH sit on the
 *    same side. A signal can only fire when agreement flips to a NEW side
 *    (up→down or down→up) — at the flip bar, or within `graceBars` bars after
 *    it while the gates below catch up. One signal per regime, maximum.
 * 2. The close must be on the signal's side of the 20-bar EMA on the entry bar.
 * 3. OBV's direction over the last 10 bars must not contradict the side
 *    (volume gate — a longer window is blind at V-turns, where the lookback is
 *    still dominated by the old trend).
 * Flips whose gates never pass inside the grace window are counted
 * (`skippedFlips`) — silence is a choice here, not a bug — and no signal fires
 * for that regime.
 *
 * Each signal carries a fixed plan so results are measurable: stop = the loose
 * trail at entry (fallback 2×ATR14), target = entry ± 2R. A trade resolves as
 * a WIN (target first), LOSS (stop first — and stop is checked before target
 * when one bar spans both), or FLIP (agreement flips to the opposite side
 * first; exit at that bar's close). The trail dots on the chart are drawn ONLY
 * while both SuperTrends agree — no dots literally means stand aside.
 */
import type { Candle } from "./types";
import { atrSeries, emaSeries, obvSeries } from "./indicators";
import { supertrendSeries } from "./traderSignals";

export interface TrailConfig {
  tight: { period: number; mult: number };
  loose: { period: number; mult: number };
  emaLength: number;
  /** Bars used for the OBV direction gate. */
  obvWindow: number;
  /** Target distance in R (multiples of the entry→stop risk). */
  targetR: number;
  /** Bars after a flip in which the EMA/OBV gates may still confirm an entry. */
  graceBars: number;
}

export const DEFAULT_TRAIL_CONFIG: TrailConfig = {
  tight: { period: 10, mult: 1.5 },
  loose: { period: 11, mult: 2.5 },
  emaLength: 20,
  obvWindow: 10,
  targetR: 2,
  graceBars: 5,
};

export type TrailOutcomeStatus = "win" | "loss" | "flip" | "open";

export interface TrailOutcome {
  status: TrailOutcomeStatus;
  /** Bar where the trade closed (null while open). */
  exitIndex: number | null;
  exitPrice: number | null;
  /** Realized R for closed trades; mark-to-market R while open. */
  r: number;
}

export interface TrailSignal {
  index: number;
  side: "long" | "short";
  /** Close of the flip bar — the signal is only knowable at that close. */
  entry: number;
  stop: number;
  target: number;
  /** Per-share risk (|entry − stop|). */
  risk: number;
  outcome: TrailOutcome;
}

export interface TrailStats {
  total: number;
  closed: number;
  wins: number;
  losses: number;
  flips: number;
  open: number;
  /** Fraction of CLOSED trades that banked r > 0 (flips count by their sign). */
  winRate: number;
  /** Mean realized R per closed trade — the expectancy. */
  avgR: number;
  totalR: number;
}

export interface TrailRead {
  /** Both trails up / both down / disagreeing (stand aside). */
  state: "up" | "down" | "mixed";
  /** Bar index where the current state began. */
  stateSince: number;
  /** Tight trail while both agree UP; NaN elsewhere (chart dots). */
  dotsUp: number[];
  /** Tight trail while both agree DOWN; NaN elsewhere. */
  dotsDown: number[];
  /** 20-bar EMA (the gate line, worth seeing on the chart). */
  ema: number[];
  signals: TrailSignal[];
  /** Agreement flips where the EMA/OBV gates said no — counted, not hidden. */
  skippedFlips: number;
  /** Replay stats over closed trades; null until at least one closes. */
  stats: TrailStats | null;
  headline: string;
}

/** Direction of xs over the k bars ending at i, normalized by window range. */
function dirAt(xs: number[], i: number, k: number): number {
  if (i < k) return 0;
  let hi = -Infinity;
  let lo = Infinity;
  for (let j = i - k; j <= i; j++) {
    if (xs[j] > hi) hi = xs[j];
    if (xs[j] < lo) lo = xs[j];
  }
  const span = hi - lo;
  return span > 0 ? (xs[i] - xs[i - k]) / span : 0;
}

export function trailRead(candles: Candle[], cfg: TrailConfig = DEFAULT_TRAIL_CONFIG): TrailRead | null {
  const n = candles.length;
  if (n < 40) return null;

  const tight = supertrendSeries(candles, cfg.tight.period, cfg.tight.mult);
  const loose = supertrendSeries(candles, cfg.loose.period, cfg.loose.mult);
  const closes = candles.map((c) => c.close);
  const ema = emaSeries(closes, cfg.emaLength);
  const obv = obvSeries(candles);
  const atr = atrSeries(candles, 14);

  // Agreement per bar: +1 both up, −1 both down, 0 disagreeing/warmup.
  const agree = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (tight.dirs[i] !== 0 && tight.dirs[i] === loose.dirs[i]) agree[i] = tight.dirs[i];
  }

  // Regime flips: every bar where agreement lands on a NEW side. Signals can
  // only fire here, and the opposite flip is every open trade's eject seat.
  const flips: Array<{ index: number; side: 1 | -1 }> = [];
  let lastSide = 0;
  for (let i = 0; i < n; i++) {
    if (agree[i] !== 0 && agree[i] !== lastSide) {
      flips.push({ index: i, side: agree[i] as 1 | -1 });
      lastSide = agree[i];
    }
  }

  const signals: TrailSignal[] = [];
  let skippedFlips = 0;
  for (const flip of flips) {
    const side = flip.side;
    let fired = false;
    // The entry may confirm at the flip bar or within the grace window — but
    // only while agreement still holds; if the trails fall apart first, pass.
    for (let i = flip.index; i <= Math.min(flip.index + cfg.graceBars, n - 1); i++) {
      if (agree[i] !== side) break;
      const entry = closes[i];
      // Gate 2: the close is on the signal's side of the EMA.
      if (!Number.isFinite(ema[i]) || (side === 1 ? entry <= ema[i] : entry >= ema[i])) continue;
      // Gate 3: OBV must not contradict (zero = no objection).
      const obvDir = dirAt(obv, i, cfg.obvWindow);
      if (side === 1 ? obvDir < 0 : obvDir > 0) continue;
      // The stop is the loose trail (the line in the sand); if the warmup or a
      // degenerate band leaves it on the wrong side, fall back to 2×ATR.
      let stop = loose.trail[i];
      if (!Number.isFinite(stop) || (side === 1 ? stop >= entry : stop <= entry)) {
        if (!Number.isFinite(atr[i]) || atr[i] <= 0) continue;
        stop = entry - side * 2 * atr[i];
      }
      const risk = Math.abs(entry - stop);
      if (!(risk > 0)) continue;
      signals.push({
        index: i,
        side: side === 1 ? "long" : "short",
        entry,
        stop,
        target: entry + side * cfg.targetR * risk,
        risk,
        outcome: { status: "open", exitIndex: null, exitPrice: null, r: 0 },
      });
      fired = true;
      break;
    }
    if (!fired) skippedFlips++;
  }

  // Replay each signal forward: stop first (conservative), then target, and
  // the opposite regime flip closes anything still open at that bar's close.
  for (const s of signals) {
    const sign = s.side === "long" ? 1 : -1;
    const flipOut = flips.find((f) => f.index > s.index && f.side !== sign);
    const lastBar = flipOut ? flipOut.index : n - 1;
    let resolved = false;
    for (let j = s.index + 1; j <= lastBar; j++) {
      const bar = candles[j];
      const stopHit = s.side === "long" ? bar.low <= s.stop : bar.high >= s.stop;
      if (stopHit) {
        s.outcome = { status: "loss", exitIndex: j, exitPrice: s.stop, r: -1 };
        resolved = true;
        break;
      }
      const targetHit = s.side === "long" ? bar.high >= s.target : bar.low <= s.target;
      if (targetHit) {
        s.outcome = { status: "win", exitIndex: j, exitPrice: s.target, r: cfg.targetR };
        resolved = true;
        break;
      }
      if (flipOut && j === flipOut.index) {
        const exit = closes[j];
        s.outcome = { status: "flip", exitIndex: j, exitPrice: exit, r: (sign * (exit - s.entry)) / s.risk };
        resolved = true;
        break;
      }
    }
    if (!resolved) {
      s.outcome = { status: "open", exitIndex: null, exitPrice: null, r: (sign * (closes[n - 1] - s.entry)) / s.risk };
    }
  }

  // Stats over closed trades only — an open trade proves nothing yet.
  const closed = signals.filter((s) => s.outcome.status !== "open");
  const wins = closed.filter((s) => s.outcome.status === "win").length;
  const losses = closed.filter((s) => s.outcome.status === "loss").length;
  const flipsN = closed.filter((s) => s.outcome.status === "flip").length;
  const totalR = closed.reduce((sum, s) => sum + s.outcome.r, 0);
  const stats: TrailStats | null = closed.length
    ? {
        total: signals.length,
        closed: closed.length,
        wins,
        losses,
        flips: flipsN,
        open: signals.length - closed.length,
        winRate: closed.filter((s) => s.outcome.r > 0).length / closed.length,
        avgR: totalR / closed.length,
        totalR,
      }
    : null;

  // Current state + where it began.
  const last = agree[n - 1];
  let stateSince = n - 1;
  while (stateSince > 0 && agree[stateSince - 1] === last) stateSince--;
  const state: TrailRead["state"] = last === 1 ? "up" : last === -1 ? "down" : "mixed";
  const barsIn = n - stateSince;
  const headline =
    state === "up"
      ? `Both trails UP for ${barsIn} bar${barsIn === 1 ? "" : "s"} — long side confirmed; the dots are the line in the sand.`
      : state === "down"
        ? `Both trails DOWN for ${barsIn} bar${barsIn === 1 ? "" : "s"} — short side confirmed; the dots cap every bounce.`
        : `The two trails disagree — no confirmed side for ${barsIn} bar${barsIn === 1 ? "" : "s"}. No dots means stand aside.`;

  const dotsUp = new Array<number>(n).fill(NaN);
  const dotsDown = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (agree[i] === 1) dotsUp[i] = tight.trail[i];
    else if (agree[i] === -1) dotsDown[i] = tight.trail[i];
  }

  return { state, stateSince, dotsUp, dotsDown, ema, signals, skippedFlips, stats, headline };
}
