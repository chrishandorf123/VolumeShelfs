import type { Recommendation, Verdict } from "./recommendation";
import type { TradePlan } from "./tradePlan";

/**
 * The coach turns a recommendation + trade plan into concrete, ordered steps —
 * "what do I actually do next?" — so the app guides the trade instead of just
 * describing it. Pure and deterministic so it can be unit-tested.
 */
export interface CoachStep {
  /** "do" = act now · "wait" = the condition to watch for · "risk" = protection rule. */
  kind: "do" | "wait" | "risk";
  text: string;
}

const money = (v: number): string =>
  Number.isFinite(v) ? `$${v >= 100 ? v.toFixed(0) : v.toFixed(2)}` : "—";

/** Ordered next actions for one name, given its call, plan and current price. */
export function nextSteps(
  reco: Recommendation,
  plan: TradePlan | null,
  price: number,
): CoachStep[] {
  const steps: CoachStep[] = [];
  const v = reco.verdict;

  if (v === "avoid") {
    steps.push({ kind: "do", text: "Skip it — no edge here. Spend your attention on the ranked names above it." });
    steps.push({ kind: "wait", text: "Re-scan tomorrow; setups change when price builds new structure." });
    return steps;
  }

  if ((v === "buy" || v === "buy-dip") && plan) {
    const triggered = price >= plan.entry;
    if (triggered) {
      steps.push({ kind: "do", text: `The ${money(plan.entry)} trigger is live — price is through it. Enter only if today's close holds above it.` });
    } else {
      steps.push({ kind: "wait", text: `Set an alert at ${money(plan.entry)} — the entry trigger. Don't buy early; let price come to you.` });
      steps.push({ kind: "do", text: `On a close above ${money(plan.entry)}, buy with your stop already placed.` });
    }
    steps.push({ kind: "risk", text: `Stop goes at ${money(plan.stop)} (${(plan.riskPct * 100).toFixed(1)}% risk). Size the position with the sizer below — risk a fixed % of the account, not a share count.` });
    steps.push({ kind: "do", text: `Trim at T1 ${money(plan.t1)} (${plan.rMultipleT1.toFixed(1)}R); let the rest work toward T2 ${money(plan.t2)} (${plan.rMultipleT2.toFixed(1)}R) with the stop moved to break-even.` });
    steps.push({ kind: "risk", text: `If it closes below ${money(plan.stop)}, exit — no averaging down, no "one more day".` });
    return steps;
  }

  if (v === "wait") {
    steps.push({ kind: "do", text: "No position yet — the setup is built but the trigger hasn't fired." });
    steps.push({ kind: "wait", text: reco.headline });
    if (plan) steps.push({ kind: "risk", text: `When it triggers, the stop belongs at ${money(plan.stop)} — decide your size from that before the entry, not after.` });
    return steps;
  }

  // watch (or a buy verdict with no plan to act on)
  steps.push({ kind: "do", text: "Watchlist it — don't put money on it yet." });
  steps.push({ kind: "wait", text: reco.headline });
  steps.push({ kind: "risk", text: "If you feel the urge to jump early, remember: the edge is in the level, not the ticker." });
  return steps;
}

/** Minimal fields needed to rank candidates for the "top trades now" digest. */
export interface PickInput {
  ticker: string;
  verdict: Verdict;
  confidence: Recommendation["confidence"];
  /** Scanner rank score (0..100). */
  score: number;
  passedAll: boolean;
  /** Confluence confirmations passed (0..10). */
  confluencePassed: number;
}

const VERDICT_RANK: Record<Verdict, number> = {
  buy: 0,
  "buy-dip": 1,
  wait: 2,
  watch: 3,
  avoid: 4,
};
const CONF_RANK = { high: 0, medium: 1, low: 2 } as const;

/**
 * Rank candidates best-first for the digest: actionable verdicts beat waiting
 * ones, A+ (all gates) beats partial, then confidence, confluence and score.
 */
export function rankPicks(picks: PickInput[]): PickInput[] {
  return [...picks].sort((a, b) => {
    const d = VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict];
    if (d !== 0) return d;
    if (a.passedAll !== b.passedAll) return a.passedAll ? -1 : 1;
    const c = CONF_RANK[a.confidence] - CONF_RANK[b.confidence];
    if (c !== 0) return c;
    if (a.confluencePassed !== b.confluencePassed) return b.confluencePassed - a.confluencePassed;
    return b.score - a.score;
  });
}

/** The digest never shows avoids; an empty result means "nothing actionable". */
export function pickTop(picks: PickInput[], n = 3): PickInput[] {
  return rankPicks(picks.filter((p) => p.verdict !== "avoid")).slice(0, n);
}
