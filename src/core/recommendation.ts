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
  /** A fat volume shelf sits at price (support). */
  hasShelfAtPrice: boolean;
  idealScore: number;
  /** An active volume-gap play (price at the shelf, air pocket above). */
  gapActive: boolean;
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
    // Below the 200-day average — the bigger trend is down.
    if (structure) {
      verdict = "watch";
      reasoning.push("It's below its 200-day average, so the bigger trend is still down — don't try to catch it here.");
      reasoning.push("But there's a real volume shelf at price, so it's worth watching.");
      reasoning.push(`Only act if it climbs back above the 200-day line AND closes above its AVWAP (${money(ctx.avwapValue)}).`);
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
    const bestR = plan ? Math.max(safe(plan.rMultipleT1), safe(plan.rMultipleT2)) : Infinity;
    const riskOk = !plan || !Number.isFinite(plan.riskPct) || plan.riskPct <= 0.12;
    const rrOk = !plan || bestR >= 1.2;
    if (!riskOk || !rrOk) {
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
    }
  } else {
    // Structure is there, but price is below its AVWAP — not yet confirmed.
    verdict = "wait";
    reasoning.push(`The setup is here (volume shelf${ctx.gapActive ? " + gap" : ""}), but price is still below its key AVWAP (${money(ctx.avwapValue)}).`);
    reasoning.push("Wait for a daily close back above that line before buying — that's the trigger.");
  }

  const headline = buildHeadline(verdict, ctx, plan);
  return { verdict, label: LABEL[verdict], headline, reasoning, confidence: confidenceOf(ctx) };
}

function buildHeadline(verdict: Verdict, ctx: RecoContext, plan: TradePlan | null): string {
  if ((verdict === "buy" || verdict === "buy-dip") && plan) {
    const risk = Number.isFinite(plan.riskPct) ? ` (risk ${(plan.riskPct * 100).toFixed(1)}%)` : "";
    const r1 = Number.isFinite(plan.rMultipleT1) ? `, ${plan.rMultipleT1.toFixed(1)}R` : "";
    return `Buy near ${money(plan.entry)}, stop ${money(plan.stop)}${risk}, first target ${money(plan.t1)}${r1}.`;
  }
  if (verdict === "wait") {
    const trigger = plan ? money(plan.entry) : money(ctx.avwapValue);
    const stop = plan ? `, then stop ${money(plan.stop)}` : "";
    return `No trade yet. Buy only on a close above ${trigger}${stop}.`;
  }
  if (verdict === "watch") return `No trade yet. Add to a watchlist and wait for it to reclaim ${money(ctx.avwapValue)}.`;
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
    hasShelfAtPrice: result.gates.shelf.pass || result.idealScore >= 0.4,
    idealScore: result.idealScore,
    gapActive: result.gates.gap.pass,
  };
}
