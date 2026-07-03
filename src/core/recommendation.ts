import type { ScanResult } from "./scanner";
import type { TradePlan } from "./tradePlan";

/**
 * A plain-English trade call so the app is usable without knowing the jargon.
 * It layers the same discipline a discretionary trader uses: don't fight
 * liquidity, don't fight the trend, buy support only when the AVWAP confirms,
 * otherwise wait for the reclaim.
 */
export type Verdict = "buy" | "buy-dip" | "wait" | "watch" | "avoid";

export interface RecoContext {
  price: number;
  liquidityOk: boolean;
  /** Above a flat-to-rising 200-day MA (and near/above the 50-day). */
  trendOk: boolean;
  /** Outperforming the market. null when unknown (no benchmark, e.g. Explore). */
  rsOk: boolean | null;
  /** Price above a rising long-side AVWAP. */
  avwapBullish: boolean;
  /** A fresh AVWAP reclaim. */
  avwapReclaim: boolean;
  /** The key AVWAP level price must hold/reclaim (for messaging). */
  avwapValue: number;
  /** The 200-day moving average — the overhead level to reclaim in a downtrend. */
  ma200: number;
  /** The 50-day moving average (the intermediate-trend line). */
  ma50: number;
  /** The 200-day is rising or flat (i.e. the long trend has turned up, not down). */
  ma200Rising: boolean;
  /** Price is at/above the 50-day (within the near-50 tolerance). */
  near50ma: boolean;
  /** A fat volume shelf sits at price (support). */
  hasShelfAtPrice: boolean;
  idealScore: number;
  /** An active volume-gap play (price at the shelf, air pocket above). */
  gapActive: boolean;
  /** Confluence confirmations passed (0..10); undefined when unknown. */
  confluencePassed?: number;
  /** Price is 2+ SD above its anchored mean — extended, so don't chase it. */
  chasing?: boolean;
  /** OBV isn't confirming the up-move (thinning participation). */
  obvDivergence?: boolean;
}

export interface Recommendation {
  verdict: Verdict;
  /** Big label: BUY / BUY THE DIP / WAIT FOR RECLAIM / ON WATCH / AVOID. */
  label: string;
  /** One-line call with the actual levels. */
  headline: string;
  /** Why — plain-English bullets. */
  reasoning: string[];
  confidence: "high" | "medium" | "low";
}

const LABEL: Record<Verdict, string> = {
  buy: "BUY",
  "buy-dip": "BUY THE DIP",
  wait: "WAIT FOR RECLAIM",
  watch: "ON WATCH",
  avoid: "AVOID",
};

function money(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `$${v >= 100 ? v.toFixed(0) : v.toFixed(2)}`;
}

function safe(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

/** Turn the computed context + trade plan into a single, clear call. */
export function recommend(ctx: RecoContext, plan: TradePlan | null): Recommendation {
  const reasoning: string[] = [];
  const structure = ctx.hasShelfAtPrice || ctx.gapActive || ctx.idealScore >= 0.35;
  let verdict: Verdict;

  if (!ctx.liquidityOk) {
    verdict = "avoid";
    reasoning.push("Too thin or too cheap to trade cleanly — you'd get bad fills and the levels aren't reliable.");
  } else if (!ctx.trendOk) {
    // The longer trend hasn't turned up. Explain the ACTUAL reason and only cite
    // levels that are genuinely overhead — never tell the user to "reclaim" a
    // line that price already sits above.
    if (structure) {
      verdict = "watch";
      const belowMa200 = Number.isFinite(ctx.ma200) && ctx.price < ctx.ma200;
      const aboveMa200 = Number.isFinite(ctx.ma200) && ctx.price >= ctx.ma200;
      const belowMa50 = !ctx.near50ma && Number.isFinite(ctx.ma50) && ctx.price < ctx.ma50;

      if (belowMa200) {
        reasoning.push(`It's below its 200-day average (${money(ctx.ma200)}), so the bigger trend is still down — don't try to catch it here.`);
      } else if (aboveMa200 && !ctx.ma200Rising) {
        reasoning.push(`It's back above its 200-day (${money(ctx.ma200)}), but the 200-day is still sloping down — the long-term trend hasn't turned up yet, so don't chase it here.`);
      } else if (belowMa50) {
        reasoning.push(`It's above its 200-day but below its 50-day (${money(ctx.ma50)}) — the intermediate trend has rolled over, so don't try to catch it here.`);
      } else {
        reasoning.push("The larger trend hasn't confirmed an uptrend yet — don't chase it here.");
      }
      reasoning.push("But there's a real volume shelf at price, so it's worth watching.");

      // The trigger: the nearest overhead line that actually has to be reclaimed.
      if (belowMa200) {
        reasoning.push(`Only act once it reclaims the 200-day line (${money(ctx.ma200)}) and the trend turns up.`);
      } else if (belowMa50) {
        reasoning.push(`Only act once it reclaims its 50-day (${money(ctx.ma50)})${ctx.ma200Rising ? "" : " and the 200-day starts to turn up"}.`);
      } else {
        reasoning.push("Only act once the 200-day flattens and turns up — that's when the bigger trend confirms.");
      }
    } else {
      verdict = "avoid";
      reasoning.push("Downtrend with no clear support shelf at price — there's nothing to lean on.");
    }
  } else if (!structure) {
    verdict = "watch";
    reasoning.push("The trend is up, but price isn't at a volume shelf yet — wait for a pullback into support before buying.");
  } else if (ctx.avwapBullish || ctx.avwapReclaim) {
    // Green light candidate: uptrend + support + AVWAP confirmation. But only
    // call a buy if the trade itself is worth taking — a wide stop or a target
    // that's barely above entry is a bad trade even with a great backdrop.
    // Synthetic (percent-marker) targets carry no real reward information —
    // never let an invented +3% line green-light a buy.
    const t1R = plan && !plan.t1Synthetic ? safe(plan.rMultipleT1) : 0;
    const t2R = plan && !plan.t2Synthetic ? safe(plan.rMultipleT2) : 0;
    const bestR = plan ? Math.max(t1R, t2R) : Infinity;
    const riskOk = !plan || !Number.isFinite(plan.riskPct) || plan.riskPct <= 0.12;
    const rrOk = !plan || bestR >= 1.2;
    if (ctx.chasing) {
      // Jake's rule: don't initiate into the upper band — that's a take-profit
      // zone. A bullish backdrop doesn't justify chasing an extended price.
      verdict = "watch";
      reasoning.push("The backdrop is bullish, but price is stretched well above its anchored mean (VWAP) — that's where you take profit, not where you start a position.");
      reasoning.push("Wait for a pullback toward the mean so your risk is small and your entry sits on support.");
    } else if (!riskOk || !rrOk) {
      verdict = "watch";
      reasoning.push("The backdrop is good (uptrend, shelf, AVWAP support), but the trade itself isn't clean right now.");
      if (!riskOk) reasoning.push(`The stop would be far away (${(plan!.riskPct * 100).toFixed(0)}% risk) — wait for price to come back to the shelf so your risk is smaller.`);
      if (!rrOk) reasoning.push("The nearest target is barely above the entry (poor reward-for-risk) — wait for a cleaner setup with room to run.");
    } else {
      verdict = ctx.gapActive ? "buy" : "buy-dip";
      reasoning.push(
        ctx.avwapReclaim
          ? "Price just reclaimed its AVWAP — momentum is turning up."
          : "Price is above a rising AVWAP, so buyers are in control.",
      );
      reasoning.push("It's resting on a fat volume shelf — that's your support and your stop level.");
      if (ctx.gapActive) reasoning.push("There's a low-volume air pocket just above — price can travel fast to the target.");
      if (ctx.rsOk === true) reasoning.push("It's also stronger than the market (good relative strength).");
      else if (ctx.rsOk === false) reasoning.push("Note: it's lagging the market a bit — leaders are cleaner.");
      if (ctx.obvDivergence) reasoning.push("Caution: OBV isn't confirming the up-move (thinning participation) — size smaller or keep the stop tight.");
    }
  } else {
    // Structure is there, but the AVWAP isn't confirming yet.
    verdict = "wait";
    if (Number.isFinite(ctx.avwapValue) && ctx.price < ctx.avwapValue) {
      reasoning.push(`The setup is here (volume shelf${ctx.gapActive ? " + gap" : ""}), but price is still below its key AVWAP (${money(ctx.avwapValue)}).`);
      reasoning.push("Wait for a daily close back above that line before buying — that's the trigger.");
    } else {
      reasoning.push(`The setup is here (volume shelf${ctx.gapActive ? " + gap" : ""}), but the AVWAP isn't confirming yet (it's flat or turning down).`);
      reasoning.push("Wait for price to hold above a rising AVWAP before buying — that's the trigger.");
    }
  }

  const headline = buildHeadline(verdict, ctx, plan);
  let confidence = confidenceOf(ctx);
  // A green-lit BUY has already cleared the hard gates + R:R, so never show it as
  // "low" confidence (self-contradictory); floor it at medium.
  if ((verdict === "buy" || verdict === "buy-dip") && confidence === "low") confidence = "medium";
  return { verdict, label: LABEL[verdict], headline, reasoning, confidence };
}

function buildHeadline(verdict: Verdict, ctx: RecoContext, plan: TradePlan | null): string {
  if ((verdict === "buy" || verdict === "buy-dip") && plan) {
    const risk = Number.isFinite(plan.riskPct) ? ` (risk ${(plan.riskPct * 100).toFixed(1)}%)` : "";
    const r1 = Number.isFinite(plan.rMultipleT1) ? `, ${plan.rMultipleT1.toFixed(1)}R` : "";
    return `Buy near ${money(plan.entry)}, stop ${money(plan.stop)}${risk}, first target ${money(plan.t1)}${r1}.`;
  }
  if (verdict === "wait") {
    // The blocker for a WAIT is the AVWAP. Cite it only when it's overhead;
    // otherwise the trigger is the AVWAP turning up, not a specific price.
    if (Number.isFinite(ctx.avwapValue) && ctx.price < ctx.avwapValue) {
      const stop = plan ? `, then stop ${money(plan.stop)}` : "";
      return `No trade yet. Buy only on a close above its AVWAP (${money(ctx.avwapValue)})${stop}.`;
    }
    return "No trade yet. Wait for price to hold above a rising AVWAP before buying.";
  }
  if (verdict === "watch") {
    const structure = ctx.hasShelfAtPrice || ctx.gapActive || ctx.idealScore >= 0.35;
    if (ctx.chasing && ctx.trendOk)
      return "No trade yet — price is extended above its anchored mean; wait for a pullback toward it.";
    if (!ctx.trendOk) {
      // Cite the nearest line price actually has to reclaim (never one below it).
      if (Number.isFinite(ctx.ma200) && ctx.price < ctx.ma200)
        return `No trade yet — wait for a close back above the 200-day average (${money(ctx.ma200)}).`;
      if (!ctx.near50ma && Number.isFinite(ctx.ma50) && ctx.price < ctx.ma50)
        return `No trade yet — wait for a reclaim of the 50-day (${money(ctx.ma50)}).`;
      return "No trade yet — wait for the 200-day to flatten and turn up.";
    }
    if (!structure) return "No trade yet — wait for a pullback into a volume shelf.";
    if (Number.isFinite(ctx.avwapValue) && ctx.price < ctx.avwapValue)
      return `No trade yet — wait for a close above its AVWAP (${money(ctx.avwapValue)}).`;
    return "No trade yet — wait for a cleaner entry back at the shelf.";
  }
  return "Skip this one — it isn't a clean setup.";
}

function confidenceOf(ctx: RecoContext): Recommendation["confidence"] {
  const greens =
    (ctx.trendOk ? 1 : 0) +
    (ctx.rsOk === true ? 1 : 0) +
    (ctx.avwapBullish || ctx.avwapReclaim ? 1 : 0) +
    (ctx.hasShelfAtPrice || ctx.gapActive ? 1 : 0) +
    (ctx.idealScore >= 0.5 ? 1 : 0);
  if (!ctx.liquidityOk) return "low";
  // Fold in the confluence scorecard when we have it: broad multi-tier
  // confirmation lifts confidence; a nearly-empty scorecard caps it.
  if (typeof ctx.confluencePassed === "number") {
    if (greens >= 4 && ctx.confluencePassed >= 7) return "high";
    if (ctx.confluencePassed <= 2) return "low";
    if (greens >= 4 && ctx.confluencePassed < 5) return "medium";
  }
  if (greens >= 4) return "high";
  if (greens >= 2) return "medium";
  return "low";
}

/** Build the recommendation context from a full scan result. */
export function recoContextFromScan(result: ScanResult): RecoContext {
  return {
    price: result.price,
    liquidityOk: result.gates.liquidity.pass,
    trendOk: result.gates.trend.pass,
    rsOk: result.gates.rs.pass,
    avwapBullish: result.avwap.bullish,
    avwapReclaim: result.avwap.reclaim,
    avwapValue: result.avwap.keyState.value,
    ma200: result.ma200,
    ma50: result.ma50,
    ma200Rising: result.ma200Slope === "rising" || result.ma200Slope === "flat",
    near50ma: result.near50ma,
    hasShelfAtPrice: result.gates.shelf.pass || result.idealScore >= 0.4,
    idealScore: result.idealScore,
    gapActive: result.gates.gap.pass,
    confluencePassed: result.confluence.passed,
    chasing: result.confluence.chasing,
    obvDivergence: result.confirmation.obv.bearishDivergence,
  };
}
