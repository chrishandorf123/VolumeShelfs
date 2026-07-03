import type { Recommendation } from "./recommendation";
import type { MarketStage, MtfAlignment } from "./shannon";
import type { DisciplineReport } from "./discipline";
import type { TradePlan } from "./tradePlan";

/**
 * THE decision. Every signal in the app — the plain-English verdict, the
 * Shannon stage and timeframe alignment, the confluence scorecard, and the
 * discipline guard — is merged into one answer with the binding constraint
 * named. Vetoes are absolute: the strictest signal always wins, because the
 * one rule that survives every market book is "the veto is never optional".
 */
export type Call = "GO" | "GO-HALF" | "WAIT" | "NO-GO";

export interface FinalCall {
  call: Call;
  side: "long" | "short";
  /** One line: the decision and the single reason that binds it. */
  headline: string;
  /** Every veto/downgrade that fired, strictest first. */
  reasons: string[];
  /** Position-size multiplier (0, 0.5 or 1). */
  sizeFactor: number;
}

export interface FinalCallInput {
  side: "long" | "short";
  reco: Recommendation;
  plan: TradePlan | null;
  stage: MarketStage | null;
  mtf: MtfAlignment;
  confluencePassed: number;
  chasing: boolean;
  discipline: DisciplineReport;
}

export function finalCall(input: FinalCallInput): FinalCall {
  const { side, reco, plan, stage, mtf, discipline } = input;
  const reasons: string[] = [];
  const long = side === "long";

  // --- absolute vetoes (any one of these is a NO-GO) -----------------------
  if (discipline.verdict === "blocked") {
    const bind = discipline.checks.find((c) => c.level === "fail");
    reasons.push(`Discipline: ${bind?.message ?? "a survival rule failed"}`);
  }
  if (!plan) reasons.push("No plan — there is no level to define the risk, so there is no trade.");
  if (long && reco.verdict === "avoid") reasons.push(`The setup itself is an AVOID: ${reco.headline}`);
  if (long && stage?.stage === 4) reasons.push("Stage-4 decline — longs fight both the trend and time.");
  if (!long && stage?.stage === 2) reasons.push("Stage-2 markup — shorting a confirmed uptrend is the fastest way to get squeezed.");
  if (reasons.length > 0) {
    return {
      call: "NO-GO",
      side,
      headline: `NO-GO — ${reasons[0]}`,
      reasons,
      sizeFactor: 0,
    };
  }

  // --- wait conditions (setup real, trigger not earned yet) ----------------
  const waits: string[] = [];
  if (long) {
    if (reco.verdict === "wait" || reco.verdict === "watch") waits.push(reco.headline);
    if (input.chasing) waits.push("Price is extended above its anchored mean — that's the take-profit zone, not the entry zone.");
    if (mtf.weekly === "down") waits.push("The weekly timeframe points down — wait for it to turn before pressing longs.");
    // The confluence scorecard counts BULLISH confirmations — it only gates longs.
    if (input.confluencePassed <= 2) waits.push(`Only ${input.confluencePassed}/10 confluence checks pass — not enough independent confirmation.`);
  } else {
    if (mtf.weekly === "up") waits.push("The weekly timeframe still points up — wait for it to roll over before pressing shorts.");
    if (stage !== null && stage.stage !== 4 && stage.stage !== 3) waits.push(`${stage.name} — shorts want stage 3/4, not a base or markup.`);
  }
  if (waits.length > 0) {
    return {
      call: "WAIT",
      side,
      headline: `WAIT — ${waits[0]}`,
      reasons: waits,
      sizeFactor: 0,
    };
  }

  // --- go (full or half, per the discipline guard's size factor) -----------
  const half = discipline.sizeFactor < 1;
  if (half) {
    const why = discipline.checks.find((c) => c.level === "warn" && ["streak", "dd", "regime"].includes(c.id));
    reasons.push(why?.message ?? "Caution flags — take half size.");
  }
  const planLine = plan
    ? ` ${long ? "Buy" : "Short"} the ${plan.entry.toFixed(2)} trigger, stop ${plan.stop.toFixed(2)}, first target ${plan.t1.toFixed(2)}.`
    : "";
  return {
    call: half ? "GO-HALF" : "GO",
    side,
    headline: `${half ? "GO (half size)" : "GO"} —${planLine}`,
    reasons,
    sizeFactor: discipline.sizeFactor,
  };
}
