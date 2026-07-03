/**
 * Everything the in-app coach knows: a distilled description of how this app
 * actually works (code-verified), the full plain-English glossary, and a
 * registry of live-context providers so the coach can see what's on screen
 * (regime, scan results, the selected ticker's read, open positions).
 */
import { GLOSSARY } from "../glossary";
import type { ChatTurn } from "./claudeClient";

/** How the app works, end to end — kept in sync with src/core/*. */
export const METHOD_SUMMARY = `
VolumeShelfs is a client-side trading-analysis app (stocks, plus BTC/USD-style crypto and EUR/USD-style FX via Alpha Vantage). Nothing is auto-traded; it ranks setups, builds plans and enforces discipline. It has two tabs:

EXPLORE TAB — deep-dive one symbol. Chart with anchored volume profile (shelves/gaps/POC/value area), AVWAP with ±1σ/±2σ bands, 50/200-day MAs, entry/stop/T1/T2 lines. Controls: data source + API key, symbol, interval (daily/weekly/monthly), anchor mode (auto swing-low, auto swing-high, or manual click), profile range (Anchored = from the anchor forward, the trade read; Full history = every bar ever loaded, so shelves at old highs/lows show what's overhead/underneath), rows, log/linear scale, value-area %, timeframe buttons (1M–All) and a ⛶ Focus mode. The Anchor Coach recommends which swing to anchor from. The sidebar stacks the full decision read (below).

SCANNER TAB — rank a whole universe. Demo universe or a live ticker list (paced to the calls/min budget, default 75 for Alpha Vantage premium). Produces a ranked table: rank, ticker, score (0–100, relative to this scan), confluence grade (10 checks), Early (stealth-accumulation score), Inst (A–E institutional footprint), the 7 gates, price, RS vs benchmark, shelf, main play. Sorting is verdict → gates → confidence → confluence → score. "A+ only" filters to names passing all 7 gates. Also on this tab: the market-regime light (GREEN/YELLOW/RED read from the benchmark's stage + weekly trend), Mission Control stats, a sector-strength board (click a sector to filter), a Daily digest of top picks, a skipped/failures row, auto-rescan (15/30/60 min), CSV export, a live intraday Monitor (distance to each plan's entry/stop/T1, statuses TRIGGERED/APPROACHING/T1/T2/WATCH/STOPPED, sortable column headers — click Status/Ticker/Price/Today/→Entry/→Stop/→T1 to rank highest or lowest, click again to reverse, once more for the default most-actionable order — plus optional browser notifications and price alerts), and the Positions journal.

THE DECISION STACK (per symbol, in order):
1. Seven GATES (pass/fail): liquidity, uptrend (above flat-or-rising 200-day + near 50-day), relative strength vs benchmark, volume shelf at price, active gap play, AVWAP confirmation, contraction.
2. VERDICT: BUY (active gap play) / BUY THE DIP / WAIT FOR RECLAIM (shelf there but below AVWAP) / ON WATCH / AVOID — with a headline naming the exact level, reasoning bullets and confidence (a BUY is floored at medium; a thin scorecard caps non-buys at low). Poor R:R, wide stops, synthetic targets or extension (chasing) downgrade a buy to WATCH.
3. CONFLUENCE SCORECARD: 10 checks across 6 tiers (confluence, trigger candle, volume ≥1.5× average, momentum RSI/MACD, market/RS/weekly alignment, exhaustion + R:R ≥1.5). Also flags Wujastyk's "mean-reversion-into-strength" (above POC & 200-day, 5-day rising, still below AVWAP) and "chasing" (extended above the anchored mean).
4. SHANNON READ (daily bars only): market stage 1–4 (only buy stage 2), weekly/daily multi-timeframe alignment, the AVWAP map (event anchors: year/quarter/month start, 52-week & all-time high/low, biggest gap, highest-volume day, listing day — lines above price = supply, below = support), and the AVWAP handoff trail of rising support.
5. EARLY SIGNAL (stealth accumulation, a heads-up NOT a buy signal): volume dry-up, volatility squeeze, OBV rising while price flat, higher lows under a flat lid, pocket pivot — scored while price is still under the lid. There's also a weekly-timeframe variant and a "signal proof" that replays the signal point-in-time over the symbol's own history (no lookahead) to show how often it preceded real moves.
6. INSTITUTIONAL FOOTPRINT: A–E rating from accumulation/distribution days, up/down volume, closing range on heavy days, initiation days, OBV trend.
7. TAPE CHECK: PREDATORY manipulation (pumps, marked-up prices on no volume, gap-and-reverse traps) blocks the trade; SMART-MONEY GAMES (Wyckoff spring, absorption at lows) are a bullish tell; upthrust/churn at highs = distribution.
8. DISCIPLINE GUARD: risk ≤1% per trade (2% ceiling), portfolio heat ≤6%, ≤5 open positions, no doubling into a held name, sector-concentration warning, no longs in a RED regime (no shorts in GREEN), anti-martingale (halve size after a losing streak), drawdown breaker, R:R ≥1 at T1, tape screen (unscreened = warn + halve).
9. FINAL CALL: one merged decision — GO / GO-HALF / WAIT / NO-GO with a sizeFactor (1 / 0.5 / 0). The STRICTEST signal always wins; vetoes (discipline block, no plan, fighting the stage) are absolute. Confluence gates apply to longs; shorts mirror the logic (stage 4 + weekly down flips the read to a short plan).
10. TRADE PLAN: entry (reclaim trigger), stop (just under the shelf low), T1/T2 with R-multiples, risk-based position sizer (account $ × risk % ÷ per-share risk). IMPORTANT: targets flagged "~3% marker — no level" are synthetic percent markers, not real volume levels — they never green-light a buy. Short plans mirror: entry on breakdown, cover-stop above the shelf.
11. JOURNAL: "Track this trade" logs entry/stop/targets + a context snapshot of the signals firing. Positions are marked to market (side-aware), can be trimmed ½ at T1 (stop moves to break-even) or closed. Stats: win rate, avg win/loss R, expectancy (mean realized R — THE number that must be > 0), total R, equity curve, growth projection and risk-of-ruin. The Edge Breakdown groups closed trades by entry context to show which signals actually paid. CSV export included.

FILTER ADVICE (the app's own guidance): defaults are sane; for highest strictness keep min price ≥ $5, min $vol ≥ 20M, shelf k×mean ≈ 1.5, proximity ≈ 2%, and let the JOURNAL's expectancy be the tuning referee — loosen one dial at a time only with 20+ logged trades.

HONESTY RULES BAKED INTO THE APP: nothing is fool-proof; the regime can be "unknown" (Explore has no benchmark); RS is unknown for a single symbol; stage math needs daily bars; unscreened tape is disclosed, never assumed clean.
`.trim();

// ---- live app context ------------------------------------------------------
type ContextProvider = () => string;
const providers = new Map<string, ContextProvider>();

/** Register (or replace) a named live-context provider (e.g. "scanner"). */
export function registerChatContext(id: string, fn: ContextProvider): void {
  providers.set(id, fn);
}

/** Snapshot every provider; one failing provider never hides the others. */
export function collectLiveContext(): string {
  const parts: string[] = [];
  for (const [id, fn] of providers) {
    try {
      const text = fn().trim();
      if (text) parts.push(text);
    } catch {
      parts.push(`(${id} context unavailable right now)`);
    }
  }
  return parts.join("\n\n");
}

// ---- prompt assembly --------------------------------------------------------
function glossaryBlock(): string {
  return GLOSSARY.map((e) => `${e.term}: ${e.plain} Why it matters: ${e.why}`).join("\n\n");
}

/** Build the coach's full system prompt, embedding the live app state. */
export function buildSystemPrompt(liveContext: string): string {
  return [
    `You are the VolumeShelfs coach — a patient trading tutor built into the VolumeShelfs app. The user asks you questions about trades, terms and the app's decisions to confirm they understand. You know exactly how this app works because its method and live state are below.`,
    ``,
    `HOW TO ANSWER:`,
    `- Plain English, short and concrete. Assume a motivated beginner unless they show expertise.`,
    `- When they ask about a specific ticker or decision, ground your answer in the LIVE APP STATE below — quote the actual verdict, final call, levels and reasons shown on screen. If the state doesn't cover it, say so and tell them where in the app to look.`,
    `- Never override the app's Final Call or discipline guard. If the app says WAIT or NO-GO, explain the binding reason; don't talk them into the trade.`,
    `- Be honest about uncertainty: no signal is fool-proof, backtests aren't guarantees, and the journal's expectancy is the referee.`,
    `- You are educational only — not financial advice, and say so if they ask you to pick trades for real money.`,
    `- If they ask you to confirm their understanding, first say plainly whether they've got it right, then correct any gaps.`,
    ``,
    `HOW THE APP WORKS:`,
    METHOD_SUMMARY,
    ``,
    `GLOSSARY (the app's own plain-English definitions — reuse this wording):`,
    glossaryBlock(),
    ``,
    `LIVE APP STATE RIGHT NOW:`,
    liveContext.trim() || `(Nothing loaded yet — no scan run and no symbol loaded. Guide them: Explore tab to study one symbol, Scanner tab to rank a list.)`,
  ].join("\n");
}

/** Keep the last `max` turns, always starting on a user turn (API requirement). */
export function trimHistory(turns: ChatTurn[], max = 16): ChatTurn[] {
  let kept = turns.slice(-max);
  while (kept.length && kept[0].role !== "user") kept = kept.slice(1);
  return kept;
}
