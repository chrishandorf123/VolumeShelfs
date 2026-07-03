import type { Position } from "./journal";
import { journalStats, realizedR } from "./journal";
import type { MarketRegime } from "./regime";
import type { AnomalyReport } from "./anomaly";

/**
 * The discipline guard: the account-survival rules that professional risk
 * practice prescribes, enforced BEFORE every trade. Each check cites a rule
 * the trading literature agrees on (see docs/RESEARCH.md):
 *  - risk ≤1% of account per trade (2% absolute ceiling)
 *  - total portfolio heat ≤6% (warn above 4%)
 *  - ≤5 concurrent positions
 *  - no doubling into a symbol already held
 *  - no new longs in a red (stage-4) market regime
 *  - anti-martingale: cold streak → cut size, never increase it
 *  - drawdown circuit-breaker: deep journal drawdown → halve size
 *  - never take a trade whose first target pays less than its risk
 */
export interface DisciplineCheck {
  id: string;
  label: string;
  level: "pass" | "warn" | "fail";
  message: string;
}

export type DisciplineVerdict = "go" | "caution" | "blocked";

export interface DisciplineReport {
  verdict: DisciplineVerdict;
  checks: DisciplineCheck[];
  /** Position-size multiplier the rules suggest (1 = full, 0.5 = half, 0 = none). */
  sizeFactor: number;
}

export interface DisciplineInput {
  accountSize: number;
  /** Intended risk for THIS trade as a fraction of the account (e.g. 0.01). */
  tradeRiskFrac: number;
  symbol: string;
  /** long entries are vetoed in a red regime; shorts in a green one. */
  side: "long" | "short";
  /** Plan reward-to-risk at the first target. */
  rMultipleT1: number | null;
  positions: Position[];
  regime: MarketRegime;
  /** Tape character from the manipulation scan (omit when unavailable). */
  tape?: Pick<AnomalyReport, "level" | "character">;
  /** Open positions already in the candidate's sector (omit when unknown). */
  sectorExposure?: { sector: string; openInSector: number };
}

const check = (id: string, label: string, level: DisciplineCheck["level"], message: string): DisciplineCheck => ({
  id,
  label,
  level,
  message,
});

/** Peak-to-now drawdown of cumulative realized R across closed trades. */
export function journalDrawdownR(positions: Position[]): number {
  let cum = 0;
  let peak = 0;
  let dd = 0;
  for (const p of positions.filter((x) => x.status === "closed")) {
    const r = realizedR(p);
    if (r === null || !Number.isFinite(r)) continue;
    cum += r;
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
  }
  return dd;
}

/** Longest current losing streak (consecutive most-recent closed losses). */
export function currentLossStreak(positions: Position[]): number {
  const closed = positions
    .filter((p) => p.status === "closed")
    .sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));
  let streak = 0;
  for (let i = closed.length - 1; i >= 0; i--) {
    const r = realizedR(closed[i]);
    if (r !== null && r < -0.05) streak += 1;
    else break;
  }
  return streak;
}

export function checkDiscipline(input: DisciplineInput): DisciplineReport {
  const checks: DisciplineCheck[] = [];
  const { accountSize, tradeRiskFrac, positions, regime, side } = input;
  const open = positions.filter((p) => p.status === "open");
  const stats = journalStats(positions);

  // 1. Per-trade risk: 1% is the professional standard; 2% the hard ceiling.
  if (!(tradeRiskFrac > 0)) {
    checks.push(check("risk", "Risk per trade", "warn", "Set a risk % in the sizer — size from risk, not conviction."));
  } else if (tradeRiskFrac <= 0.01) {
    checks.push(check("risk", "Risk per trade", "pass", `${(tradeRiskFrac * 100).toFixed(2)}% — inside the 1% professional standard.`));
  } else if (tradeRiskFrac <= 0.02) {
    checks.push(check("risk", "Risk per trade", "warn", `${(tradeRiskFrac * 100).toFixed(2)}% — above the 1% standard; only OK with a proven edge.`));
  } else {
    checks.push(check("risk", "Risk per trade", "fail", `${(tradeRiskFrac * 100).toFixed(2)}% — over the 2% ceiling. Ten losses in a row would take >20% of the account.`));
  }

  // 2. Portfolio heat: open risk + this trade, as a fraction of the account.
  const heat = accountSize > 0 ? (stats.openRisk + tradeRiskFrac * accountSize) / accountSize : 0;
  if (heat <= 0.04) {
    checks.push(check("heat", "Portfolio heat", "pass", `${(heat * 100).toFixed(1)}% total open risk after this trade — comfortably under the 4–6% cap.`));
  } else if (heat <= 0.06) {
    checks.push(check("heat", "Portfolio heat", "warn", `${(heat * 100).toFixed(1)}% total open risk — near the 6% ceiling; one bad macro day hits every position at once.`));
  } else {
    checks.push(check("heat", "Portfolio heat", "fail", `${(heat * 100).toFixed(1)}% total open risk — over the 6% ceiling. Close or trim something first.`));
  }

  // 3. Concurrent positions.
  if (open.length < 5) {
    checks.push(check("count", "Open positions", "pass", `${open.length} open — within the 5-position focus limit.`));
  } else if (open.length < 8) {
    checks.push(check("count", "Open positions", "warn", `${open.length} open — more names than most traders can genuinely follow intraday.`));
  } else {
    checks.push(check("count", "Open positions", "fail", `${open.length} open — this is a portfolio, not a watch. No new positions.`));
  }

  // 4. No doubling into the same symbol.
  const dup = open.some((p) => p.symbol === input.symbol.toUpperCase());
  checks.push(
    dup
      ? check("dup", "Already holding", "fail", `You already have an open ${input.symbol.toUpperCase()} position — adding is averaging, not a new idea.`)
      : check("dup", "Already holding", "pass", "No existing position in this symbol."),
  );

  // 5. Market regime filter (direction-aware).
  if (regime.light === "unknown") {
    checks.push(check("regime", "Market regime", "warn", regime.detail));
  } else if (side === "long") {
    if (regime.light === "green") checks.push(check("regime", "Market regime", "pass", regime.detail));
    else if (regime.light === "yellow") checks.push(check("regime", "Market regime", "warn", regime.detail));
    else checks.push(check("regime", "Market regime", "fail", regime.detail));
  } else {
    // Shorts want a red market; a green stage-2 tape squeezes shorts.
    if (regime.light === "red") checks.push(check("regime", "Market regime", "pass", "Bear regime — shorts trade with the market's wind."));
    else if (regime.light === "yellow") checks.push(check("regime", "Market regime", "warn", "Mixed regime — shorts need extra confirmation here."));
    else checks.push(check("regime", "Market regime", "fail", "Stage-2 bull regime — shorting strength is how accounts get squeezed."));
  }

  // 6. Anti-martingale: cold streak or negative recent expectancy → cut size.
  const streak = currentLossStreak(positions);
  const recent = positions
    .filter((p) => p.status === "closed")
    .sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0))
    .slice(-10);
  const recentRs = recent.map((p) => realizedR(p)).filter((r): r is number => r !== null && Number.isFinite(r));
  const recentExp = recentRs.length >= 5 ? recentRs.reduce((a, b) => a + b, 0) / recentRs.length : NaN;
  if (streak >= 3 || (Number.isFinite(recentExp) && recentExp < 0)) {
    checks.push(
      check(
        "streak",
        "Recent form",
        "warn",
        streak >= 3
          ? `${streak} losses in a row — anti-martingale says cut size in half until a winner prints. Never size UP to get it back.`
          : `Expectancy over your last ${recentRs.length} trades is negative — halve size until the process proves itself again.`,
      ),
    );
  } else {
    checks.push(check("streak", "Recent form", "pass", streak > 0 ? `${streak} recent loss${streak > 1 ? "es" : ""} — normal variance.` : "No active losing streak."));
  }

  // 7. Drawdown circuit-breaker on the journal equity curve.
  const dd = journalDrawdownR(positions);
  if (dd >= 5) {
    checks.push(check("dd", "Drawdown", "warn", `Journal is ${dd.toFixed(1)}R off its peak — halve size and slow down until the curve turns.`));
  } else {
    checks.push(check("dd", "Drawdown", "pass", dd > 0 ? `${dd.toFixed(1)}R off the peak — within normal give-back.` : "Equity curve at its peak."));
  }

  // 7b. Sector concentration: three semis are one bet wearing three tickers.
  if (input.sectorExposure && input.sectorExposure.sector !== "Other") {
    const { sector, openInSector } = input.sectorExposure;
    if (openInSector >= 3) {
      checks.push(check("sector", "Sector concentration", "fail", `${openInSector} open positions already in ${sector} — this add is correlation, not diversification.`));
    } else if (openInSector === 2) {
      checks.push(check("sector", "Sector concentration", "warn", `2 open positions already in ${sector} — a third makes the group your whole book on a bad sector day.`));
    } else {
      checks.push(check("sector", "Sector concentration", "pass", openInSector === 1 ? `1 open position in ${sector} — room for one more.` : `No open exposure in ${sector}.`));
    }
  }

  // 8. Tape quality: predatory manipulation blocks; smart-money games CAN be
  //    a tell in your favor — when they point the same way as your trade.
  if (input.tape) {
    const { level, character } = input.tape;
    const gamesFavor = (side === "long" && character === "games-accumulation") || (side === "short" && character === "games-distribution");
    const gamesAgainst = (side === "long" && character === "games-distribution") || (side === "short" && character === "games-accumulation");
    if (character === "predatory" || (level === "SKETCHY" && !gamesFavor)) {
      checks.push(check("tape", "Tape quality", "fail", "Predatory tape (pump / thin mark-ups / traps) — levels are unreliable; someone needs your fill to exit."));
    } else if (gamesAgainst) {
      checks.push(check("tape", "Tape quality", "warn", `Smart-money games point AGAINST this ${side} — you'd be the exit liquidity.`));
    } else if (gamesFavor) {
      checks.push(check("tape", "Tape quality", "pass", `Games detected in your favor — stops swept/supply ${side === "long" ? "absorbed" : "distributed"} by bigger hands.`));
    } else if (level === "WATCH") {
      checks.push(check("tape", "Tape quality", "warn", "Tape oddities — trust the levels less and size down."));
    } else {
      checks.push(check("tape", "Tape quality", "pass", "Tape is clean — moves carry volume and gaps behave."));
    }
  }

  // 9. The trade itself must pay: first target ≥ 1R.
  if (input.rMultipleT1 !== null && Number.isFinite(input.rMultipleT1)) {
    if (input.rMultipleT1 >= 1.5) checks.push(check("rr", "Reward : risk", "pass", `${input.rMultipleT1.toFixed(1)}R to the first target.`));
    else if (input.rMultipleT1 >= 1.0) checks.push(check("rr", "Reward : risk", "warn", `${input.rMultipleT1.toFixed(1)}R to T1 — thin; you need a high win rate to make this pay.`));
    else checks.push(check("rr", "Reward : risk", "fail", `${input.rMultipleT1.toFixed(1)}R to T1 — the first target pays less than the risk. Skip.`));
  }

  const anyFail = checks.some((c) => c.level === "fail");
  const warns = checks.filter((c) => c.level === "warn").length;
  const verdict: DisciplineVerdict = anyFail ? "blocked" : warns > 0 ? "caution" : "go";
  const halve = checks.some((c) => ["streak", "dd", "regime", "tape"].includes(c.id) && c.level === "warn");
  const sizeFactor = anyFail ? 0 : halve ? 0.5 : 1;
  return { verdict, checks, sizeFactor };
}
